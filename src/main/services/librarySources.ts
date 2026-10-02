/**
 * 库来源复用边界（#99）。
 *
 * 一个来源在库层面只存在一次（`library_sources` 的一行 snapshot）；`documents` 行是
 * 某个 notebook 对它的一次挂载（membership），保留自己的 ID 与派生索引。本模块实现
 * 复用这条边界：
 *
 *   - 列出某个 notebook 还没挂载的 snapshot；
 *   - 挂载一个 snapshot（能复用就复制已索引 donor 的 blocks/chunks/mappings/向量，
 *     绝不调用 embedding）；
 *   - 显式、已确认地删除一个未被挂载的 snapshot。
 *
 * 刻意不 import Electron：入参是 raw better-sqlite3 连接，所以这条边界能在测试里用
 * 真实的 SQLite + sqlite-vec 跑，而不必启动桌面应用。向量表信息通过 `VectorTableAccess`
 * 注入，测试可以自己建真的 vec0 表。
 *
 * 同步性：所有数据库操作都是同步的（better-sqlite3 / node 单线程），函数内部没有
 * await，所以「检查重复 → 写入」之间不会有另一个挂载/删除插进来，挂载与删除天然不会
 * 互相踩到对方的中间状态。
 */

import type Database from 'better-sqlite3'
import type { DocumentType, LibrarySourceSummary } from '../../shared/types/knowledge'
import { safeIdentifier } from '../vectorstore/vectorTableSql'
import { createChunksFtsSql, insertChunksFtsSql } from './ftsSql'

/** 决定向量可比性的最小 space 身份：模型/维度一致才允许复制向量。 */
export interface EmbeddingSpaceIdentity {
  id: string
  dimensions: number
}

export interface VectorTable {
  tableName: string
  dimensions: number
}

/** 注入向量表读写，避免把 Electron 的 db/index 拉进本模块。 */
export interface VectorTableAccess {
  read(notebookId: string): VectorTable | undefined
  ensure(notebookId: string, dimensions: number): VectorTable
}

export interface AttachResult {
  documentId: string
  indexed: boolean
  chunkCount: number
}

/**
 * 一个库 snapshot 的字段。`structure` / `metadata` 已经是 JSON 文本（与 drizzle 的
 * json 模式一致），由调用方序列化。
 */
export interface LibrarySnapshotFields {
  title: string
  type: string
  sourceUri: string | null
  localFilePath: string | null
  content: string | null
  structure: string | null
  contentHash: string | null
  mimeType: string | null
  fileSize: number | null
  metadata: string | null
}

interface LibrarySourceRow {
  id: string
  title: string
  type: string
  source_uri: string | null
  local_file_path: string | null
  content: string | null
  structure: string | null
  content_hash: string | null
  mime_type: string | null
  file_size: number | null
  metadata: string | null
  created_at: number
  updated_at: number
}

interface DonorRow {
  document_id: string
  notebook_id: string
  space_id: string
  dimensions: number
  chunk_count: number
}

const newId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

const epochSeconds = (date: Date): number => Math.floor(date.getTime() / 1000)

/**
 * 写入一份新的库 snapshot。导入与 copy-on-write 刷新共用它：刷新就是新开一行，旧
 * snapshot 一行都不改。
 */
export function insertLibrarySource(
  sqlite: Database.Database,
  id: string,
  fields: LibrarySnapshotFields,
  now = new Date()
): void {
  const nowSec = epochSeconds(now)
  sqlite
    .prepare(
      `INSERT INTO library_sources
         (id, title, type, source_uri, local_file_path, content, structure, content_hash,
          mime_type, file_size, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      fields.title,
      fields.type,
      fields.sourceUri,
      fields.localFilePath,
      fields.content,
      fields.structure,
      fields.contentHash,
      fields.mimeType,
      fields.fileSize,
      fields.metadata,
      nowSec,
      nowSec
    )
}

/**
 * 补齐一份从没有过内容的 snapshot（升级前解析失败、迁移回填时 content 为 NULL）。
 * 共享期间不可变只保护真正有效的快照；一份空快照原地补齐不会被任何 citation 引用。
 */
export function updateLibrarySource(
  sqlite: Database.Database,
  id: string,
  fields: LibrarySnapshotFields,
  now = new Date()
): void {
  sqlite
    .prepare(
      `UPDATE library_sources
         SET title = ?, type = ?, source_uri = ?, local_file_path = ?, content = ?,
             structure = ?, content_hash = ?, mime_type = ?, file_size = ?, metadata = ?,
             updated_at = ?
       WHERE id = ?`
    )
    .run(
      fields.title,
      fields.type,
      fields.sourceUri,
      fields.localFilePath,
      fields.content,
      fields.structure,
      fields.contentHash,
      fields.mimeType,
      fields.fileSize,
      fields.metadata,
      epochSeconds(now),
      id
    )
}

/**
 * 重试/刷新一份来源时 snapshot 该怎么处理。ADR 要求共享期间快照不可变，所以：
 * - refresh：永远新开（copy-on-write），绝不动共享的文件。
 * - 没有 snapshot：新开。
 * - 被多个 membership 共享：新开 —— 绝不为一个 membership 原地改写别人的快照。
 * - 独占、且从未解析成功（content 为空）：原地补齐（空快照没有有效内容可漂移）。
 * - 独占、已解析：保持不动，重试只重建派生索引。
 */
export type SnapshotWritePlan = 'new' | 'fill' | 'keep'

export function planSnapshotWrite(params: {
  refresh: boolean
  hasSourceId: boolean
  hasContent: boolean
  membershipCount: number
}): SnapshotWritePlan {
  if (params.refresh || !params.hasSourceId) return 'new'
  if (params.membershipCount > 1) return 'new'
  if (!params.hasContent) return 'fill'
  return 'keep'
}

/** 一个 snapshot 被多少个 notebook membership 挂载。 */
export function countMemberships(sqlite: Database.Database, sourceId: string): number {
  return (
    sqlite.prepare('SELECT COUNT(*) AS count FROM documents WHERE source_id = ?').get(sourceId) as {
      count: number
    }
  ).count
}

/**
 * 找一个可复用的 donor：同 snapshot、别的 notebook、已索引、且持久化的 space 与当前
 * 配置的 space 完全一致。只用维度不足以证明可比（换模型但维度相同时旧向量不可比）。
 */
function findIndexedDonor(
  sqlite: Database.Database,
  sourceId: string,
  targetNotebookId: string,
  currentSpace: EmbeddingSpaceIdentity,
  tables: VectorTableAccess
): DonorRow | undefined {
  const rows = sqlite
    .prepare(
      `SELECT d.id AS document_id, d.notebook_id, s.space_id, s.dimensions, d.chunk_count
       FROM documents d
       JOIN notebook_embedding_spaces s ON s.notebook_id = d.notebook_id
       WHERE d.source_id = ?
         AND d.notebook_id <> ?
         AND d.status = 'indexed'
         AND d.chunk_count > 0
       ORDER BY d.updated_at DESC`
    )
    .all(sourceId, targetNotebookId) as DonorRow[]

  return rows.find((row) => {
    // Remote configuration can report unknown width (0) without inference. The
    // exact space identity still has to match; validate the measured stored width
    // against both vector tables and every embedding before copying anything.
    if (row.space_id !== currentSpace.id) return false
    if (currentSpace.dimensions !== 0 && row.dimensions !== currentSpace.dimensions) return false
    const table = tables.read(row.notebook_id)
    if (!table || table.dimensions !== row.dimensions) return false
    const coverage = sqlite
      .prepare(
        `SELECT c.id, COUNT(e.id) AS embeddings, COUNT(v.embedding_id) AS vectors,
              SUM(CASE WHEN e.notebook_id = ? AND e.dimensions = ? THEN 1 ELSE 0 END) AS compatible
       FROM chunks c
       LEFT JOIN embeddings e ON e.chunk_id = c.id
       LEFT JOIN ${safeIdentifier(table.tableName)} v ON v.embedding_id = e.id AND v.chunk_id = c.id
       WHERE c.document_id = ?
       GROUP BY c.id`
      )
      .all(row.notebook_id, row.dimensions, row.document_id) as Array<{
      id: string
      embeddings: number
      vectors: number
      compatible: number
    }>
    return (
      coverage.length === row.chunk_count &&
      coverage.every(
        (chunk) => chunk.embeddings === 1 && chunk.vectors === 1 && chunk.compatible === 1
      )
    )
  })
}

/**
 * 目标 notebook 能不能接住 donor 的向量：没有向量表（空目标）就采用 donor 的 space；
 * 已有向量表则维度必须一致，且记录的 space 身份也必须一致。不一致就不可能复用。
 */
function targetAcceptsDonor(
  sqlite: Database.Database,
  targetNotebookId: string,
  donor: DonorRow,
  tables: VectorTableAccess
): boolean {
  const targetTable = tables.read(targetNotebookId)
  if (!targetTable) return true
  if (targetTable.dimensions !== donor.dimensions) return false

  const targetSpace = sqlite
    .prepare('SELECT space_id FROM notebook_embedding_spaces WHERE notebook_id = ?')
    .get(targetNotebookId) as { space_id: string } | undefined
  return targetSpace?.space_id === donor.space_id
}

/**
 * 复用判定只有这一处：`listLibrarySources` 的 `canReuseIndex` 与 `attachLibrarySource`
 * 实际会不会复制向量必须得出同一个答案，否则 UI 会承诺一个 attach 兑现不了的复用。
 */
function resolveReuse(
  sqlite: Database.Database,
  sourceId: string,
  targetNotebookId: string,
  currentSpace: EmbeddingSpaceIdentity,
  tables: VectorTableAccess
): { donor: DonorRow | undefined; reusable: boolean } {
  const donor = findIndexedDonor(sqlite, sourceId, targetNotebookId, currentSpace, tables)
  return {
    donor,
    reusable: donor ? targetAcceptsDonor(sqlite, targetNotebookId, donor, tables) : false
  }
}

/**
 * 某个 notebook 可以挂载的库 snapshot：排除已经挂载到它的那些。`canReuseIndex` 表示
 * 存在一个与当前 space 一致、且目标能接住的已索引 donor。
 */
export function listLibrarySources(
  sqlite: Database.Database,
  notebookId: string,
  currentSpace: EmbeddingSpaceIdentity,
  tables: VectorTableAccess
): LibrarySourceSummary[] {
  const rows = sqlite
    .prepare(
      `SELECT ls.*,
              (SELECT COUNT(*) FROM documents d WHERE d.source_id = ls.id) AS membership_count
       FROM library_sources ls
       WHERE NOT EXISTS (
         SELECT 1 FROM documents d2
         WHERE d2.source_id = ls.id AND d2.notebook_id = ?
       )
       ORDER BY ls.updated_at DESC`
    )
    .all(notebookId) as Array<LibrarySourceRow & { membership_count: number }>

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    type: row.type as DocumentType,
    mimeType: row.mime_type,
    membershipCount: row.membership_count,
    hasContent: row.content !== null,
    canReuseIndex: resolveReuse(sqlite, row.id, notebookId, currentSpace, tables).reusable
  }))
}

const MEMBERSHIP_COLUMNS = `(id, notebook_id, title, type, source_uri, local_file_path,
  content, structure, content_hash, mime_type, file_size, metadata, source_id, status,
  source_state, chunk_count, created_at, updated_at)`

function insertMembership(
  sqlite: Database.Database,
  source: LibrarySourceRow,
  notebookId: string,
  documentId: string,
  status: 'pending' | 'indexed',
  chunkCount: number,
  nowSec: number
): void {
  sqlite
    .prepare(
      `INSERT INTO documents ${MEMBERSHIP_COLUMNS}
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?)`
    )
    .run(
      documentId,
      notebookId,
      source.title,
      source.type,
      source.source_uri,
      source.local_file_path,
      source.content,
      source.structure,
      source.content_hash,
      source.mime_type,
      source.file_size,
      JSON.stringify({
        ...(source.metadata ? JSON.parse(source.metadata) : {}),
        librarySnapshotOnly: true
      }),
      source.id,
      status,
      chunkCount,
      nowSec,
      nowSec
    )
}

/**
 * 把一个库 snapshot 挂载到 notebook。
 *
 * 重复挂载是幂等的：已经挂载过就返回现有 membership，不新建、不改索引。没有可复用
 * donor（或目标不兼容）时落一个 `pending` membership，等用户显式重新索引 —— 这条路径
 * 不碰任何已有向量。可复用时不调用 embedding，只按新 ID 复制派生索引与向量。
 */
export function attachLibrarySource(
  sqlite: Database.Database,
  params: {
    notebookId: string
    sourceId: string
    currentSpace: EmbeddingSpaceIdentity
    tables: VectorTableAccess
    now?: Date
  }
): AttachResult {
  const now = params.now ?? new Date()
  const nowSec = epochSeconds(now)

  const notebook = sqlite.prepare('SELECT id FROM notebooks WHERE id = ?').get(params.notebookId)
  if (!notebook) throw new Error(`Notebook ${params.notebookId} not found`)

  const source = sqlite
    .prepare('SELECT * FROM library_sources WHERE id = ?')
    .get(params.sourceId) as LibrarySourceRow | undefined
  if (!source) throw new Error(`Library source ${params.sourceId} not found`)
  if (source.content === null) {
    throw new Error(
      `Library source ${params.sourceId} has no parsed content and cannot be reused; re-import the file instead`
    )
  }

  const existing = sqlite
    .prepare(
      'SELECT id, status, chunk_count FROM documents WHERE notebook_id = ? AND source_id = ?'
    )
    .get(params.notebookId, params.sourceId) as
    { id: string; status: string; chunk_count: number | null } | undefined
  if (existing) {
    const chunkCount = existing.chunk_count ?? 0
    return {
      documentId: existing.id,
      indexed: existing.status === 'indexed' && chunkCount > 0,
      chunkCount
    }
  }

  const { donor, reusable } = resolveReuse(
    sqlite,
    params.sourceId,
    params.notebookId,
    params.currentSpace,
    params.tables
  )

  const documentId = newId('doc')

  if (!reusable) {
    insertMembership(sqlite, source, params.notebookId, documentId, 'pending', 0, nowSec)
    return { documentId, indexed: false, chunkCount: 0 }
  }

  // 空目标采用 donor 的 space 身份：建一张同宽度的向量表并记录 space，之后复制向量。
  let targetTable = params.tables.read(params.notebookId)
  if (!targetTable) {
    targetTable = params.tables.ensure(params.notebookId, donor!.dimensions)
    const donorSpace = sqlite
      .prepare(
        `SELECT space_id, backend, model, revision, dimensions
         FROM notebook_embedding_spaces WHERE notebook_id = ?`
      )
      .get(donor!.notebook_id) as
      | {
          space_id: string
          backend: string
          model: string
          revision: string
          dimensions: number
        }
      | undefined
    if (donorSpace) {
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO notebook_embedding_spaces
             (notebook_id, space_id, backend, model, revision, dimensions, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          params.notebookId,
          donorSpace.space_id,
          donorSpace.backend,
          donorSpace.model,
          donorSpace.revision,
          donorSpace.dimensions,
          nowSec
        )
    }
  }

  const donorTable = params.tables.read(donor!.notebook_id)
  if (!donorTable) {
    throw new Error(
      `Donor notebook ${donor!.notebook_id} is indexed but has no vector table to copy from`
    )
  }

  const chunkCount = sqlite.transaction(() => {
    insertMembership(sqlite, source, params.notebookId, documentId, 'indexed', 0, nowSec)
    return cloneIndexedMembership(sqlite, {
      donorDocumentId: donor!.document_id,
      targetDocumentId: documentId,
      targetNotebookId: params.notebookId,
      donorVectorTable: donorTable.tableName,
      targetVectorTable: targetTable!.tableName,
      now
    })
  })()

  sqlite.prepare('UPDATE documents SET chunk_count = ? WHERE id = ?').run(chunkCount, documentId)

  return { documentId, indexed: true, chunkCount }
}

/**
 * 复制一份已经索引的 membership 的派生索引：blocks、chunks、chunk↔block 映射、
 * embeddings 元数据，以及 vec0 表里的向量。全部用新 ID，因此 donor 与目标互不影响；
 * page/offset/span 原样复制，历史 citation 的分页与字符区间不变。
 *
 * 纯同步 SQL：向量用 `INSERT ... SELECT embedding FROM donor` 在同一连接里搬，所以
 * 整个过程可以在一个事务里完成，不需要在事务中间 await。
 */
export function cloneIndexedMembership(
  sqlite: Database.Database,
  params: {
    donorDocumentId: string
    targetDocumentId: string
    targetNotebookId: string
    donorVectorTable: string
    targetVectorTable: string
    now: Date
  }
): number {
  const nowSec = epochSeconds(params.now)

  const blocks = sqlite
    .prepare('SELECT * FROM document_blocks WHERE document_id = ? ORDER BY "order"')
    .all(params.donorDocumentId) as Array<Record<string, unknown> & { id: string }>
  const chunks = sqlite
    .prepare('SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index')
    .all(params.donorDocumentId) as Array<Record<string, unknown> & { id: string }>
  const mappings = sqlite
    .prepare(
      `SELECT cb.chunk_id, cb.block_id, cb.start_in_block, cb.end_in_block
       FROM chunk_blocks cb
       JOIN chunks c ON c.id = cb.chunk_id
       WHERE c.document_id = ?`
    )
    .all(params.donorDocumentId) as Array<{
    chunk_id: string
    block_id: string
    start_in_block: number
    end_in_block: number
  }>
  const embeddings = sqlite
    .prepare(
      `SELECT e.id, e.chunk_id, e.model, e.dimensions
       FROM embeddings e
       JOIN chunks c ON c.id = e.chunk_id
       WHERE c.document_id = ?`
    )
    .all(params.donorDocumentId) as Array<{
    id: string
    chunk_id: string
    model: string
    dimensions: number
  }>

  const blockIdMap = new Map<string, string>()
  const chunkIdMap = new Map<string, string>()

  const insertBlock = sqlite.prepare(
    `INSERT INTO document_blocks
       (id, document_id, kind, "order", page, level, text, start_offset, end_offset, bbox, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const block of blocks) {
    const id = newId('block')
    blockIdMap.set(block.id, id)
    insertBlock.run(
      id,
      params.targetDocumentId,
      block.kind,
      block.order,
      block.page,
      block.level,
      block.text,
      block.start_offset,
      block.end_offset,
      block.bbox,
      block.metadata
    )
  }

  sqlite.exec(createChunksFtsSql())
  const insertFts = sqlite.prepare(insertChunksFtsSql())
  const insertChunk = sqlite.prepare(
    `INSERT INTO chunks
       (id, document_id, notebook_id, content, chunk_index, start_offset, end_offset,
        page_start, page_end, metadata, token_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const chunk of chunks) {
    const id = newId('chunk')
    chunkIdMap.set(chunk.id, id)
    insertChunk.run(
      id,
      params.targetDocumentId,
      params.targetNotebookId,
      chunk.content,
      chunk.chunk_index,
      chunk.start_offset,
      chunk.end_offset,
      chunk.page_start,
      chunk.page_end,
      chunk.metadata,
      chunk.token_count,
      nowSec
    )
    insertFts.run(chunk.content, id, params.targetNotebookId, params.targetDocumentId)
  }

  const insertMapping = sqlite.prepare(
    'INSERT INTO chunk_blocks (chunk_id, block_id, start_in_block, end_in_block) VALUES (?, ?, ?, ?)'
  )
  for (const mapping of mappings) {
    const chunkId = chunkIdMap.get(mapping.chunk_id)
    const blockId = blockIdMap.get(mapping.block_id)
    if (!chunkId || !blockId) continue
    insertMapping.run(chunkId, blockId, mapping.start_in_block, mapping.end_in_block)
  }

  const insertEmbedding = sqlite.prepare(
    'INSERT INTO embeddings (id, chunk_id, notebook_id, model, dimensions, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const copyVector = sqlite.prepare(
    `INSERT INTO ${safeIdentifier(params.targetVectorTable)}
       (embedding_id, chunk_id, embedding)
     SELECT ?, ?, embedding FROM ${safeIdentifier(params.donorVectorTable)}
     WHERE embedding_id = ?`
  )
  for (const embedding of embeddings) {
    const chunkId = chunkIdMap.get(embedding.chunk_id)
    if (!chunkId) continue
    const embeddingId = newId('emb')
    insertEmbedding.run(
      embeddingId,
      chunkId,
      params.targetNotebookId,
      embedding.model,
      embedding.dimensions,
      nowSec
    )
    if (copyVector.run(embeddingId, chunkId, embedding.id).changes !== 1) {
      throw new Error(`Missing donor vector for chunk ${embedding.chunk_id}`)
    }
  }

  return chunks.length
}

/**
 * 永久删除一个库 snapshot。未确认或仍被挂载时拒绝；成功时返回本地文件路径，由调用方
 * （持有文件系统权限的 KnowledgeService）决定 unlink。
 */
export function deleteLibrarySource(
  sqlite: Database.Database,
  sourceId: string,
  confirmed: boolean
): { localFilePath: string | null; deleted: boolean } {
  if (!confirmed) {
    throw new Error('Permanent deletion of a library source requires explicit confirmation')
  }

  const source = sqlite
    .prepare('SELECT id, local_file_path FROM library_sources WHERE id = ?')
    .get(sourceId) as { id: string; local_file_path: string | null } | undefined
  if (!source) return { localFilePath: null, deleted: false }

  const attached = sqlite
    .prepare('SELECT COUNT(*) AS count FROM documents WHERE source_id = ?')
    .get(sourceId) as { count: number }
  if (attached.count > 0) {
    throw new Error(
      `Library source ${sourceId} is still attached to ${attached.count} notebook membership(s)`
    )
  }

  sqlite.prepare('DELETE FROM library_sources WHERE id = ?').run(sourceId)
  return { localFilePath: source.local_file_path, deleted: true }
}
