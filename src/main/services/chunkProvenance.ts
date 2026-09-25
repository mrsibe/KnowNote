/**
 * chunkProvenance
 * chunk ↔ block 映射的写入与解析。
 *
 * 检索结果只带 chunk id；引用要落到"哪一页、哪一段"，必须凭映射一路查回块。
 * `resolveChunkProvenance()` 一次 join 同时拿到有序块区间与反规范化的页码区间。
 */

import { eq, inArray } from 'drizzle-orm'
import { chunks, documentBlocks, chunkBlocks } from '../db/schema'
import type { getDatabase } from '../db'
import type { ChunkBlockSpan } from './ChunkingService'
import type { BlockKind } from './blocks/documentBlocks'
import type { NormalizedBox } from './loaders/types'

/** drizzle 实例类型（与 `getDatabase()` 的返回一致）。 */
type Db = ReturnType<typeof getDatabase>

/** 解析结果里的单个块。 */
export interface ChunkProvenanceBlock {
  blockId: string
  kind: BlockKind
  level: number | null
  page: number | null
  /** 归一化页面坐标（仅分页格式）；引用要高亮到段落就需要它。 */
  bbox: NormalizedBox | null
  text: string
  startOffset: number
  endOffset: number
  startInBlock: number
  endInBlock: number
}

export interface ChunkProvenance {
  chunkId: string
  documentId: string
  pageStart: number | null
  pageEnd: number | null
  blocks: ChunkProvenanceBlock[]
}

/** join 出来的原始行，`order` 用于排序，不进入结果。 */
export interface ChunkProvenanceRow extends ChunkProvenanceBlock {
  order: number
}

/** 把 join 行排序并投影成解析结果。纯函数，便于单测。 */
export function projectChunkProvenance(
  chunkId: string,
  documentId: string,
  pageStart: number | null,
  pageEnd: number | null,
  rows: ChunkProvenanceRow[]
): ChunkProvenance {
  const ordered = [...rows].sort((a, b) => a.order - b.order)
  return {
    chunkId,
    documentId,
    pageStart,
    pageEnd,
    blocks: ordered.map((row) => ({
      blockId: row.blockId,
      kind: row.kind,
      level: row.level,
      page: row.page,
      bbox: row.bbox,
      text: row.text,
      startOffset: row.startOffset,
      endOffset: row.endOffset,
      startInBlock: row.startInBlock,
      endInBlock: row.endInBlock
    }))
  }
}

/** 写入一个 chunk 覆盖的全部块区间。 */
export function insertChunkBlocks(db: Db, chunkId: string, spans: ChunkBlockSpan[]): void {
  for (const span of spans) {
    db.insert(chunkBlocks)
      .values({
        chunkId,
        blockId: span.blockId,
        startInBlock: span.startInBlock,
        endInBlock: span.endInBlock
      })
      .run()
  }
}

/**
 * 批量解析多个 chunk 的来源。检索一次返回 topK 个 chunk，逐个调用
 * `resolveChunkProvenance()` 会自然形成 N+1；这里用一次 join 取回全部映射，再在 JS 里
 * 按 chunkId 分组。返回顺序与 `chunkIds` 无关，由 `Map` 承载。
 */
export function resolveChunksProvenance(db: Db, chunkIds: string[]): Map<string, ChunkProvenance> {
  const result = new Map<string, ChunkProvenance>()
  if (chunkIds.length === 0) return result

  const rows = db
    .select({
      chunkId: chunks.id,
      documentId: chunks.documentId,
      pageStart: chunks.pageStart,
      pageEnd: chunks.pageEnd,
      blockId: documentBlocks.id,
      kind: documentBlocks.kind,
      level: documentBlocks.level,
      page: documentBlocks.page,
      bbox: documentBlocks.bbox,
      text: documentBlocks.text,
      startOffset: documentBlocks.startOffset,
      endOffset: documentBlocks.endOffset,
      order: documentBlocks.order,
      startInBlock: chunkBlocks.startInBlock,
      endInBlock: chunkBlocks.endInBlock
    })
    .from(chunks)
    .leftJoin(chunkBlocks, eq(chunkBlocks.chunkId, chunks.id))
    .leftJoin(documentBlocks, eq(chunkBlocks.blockId, documentBlocks.id))
    .where(inArray(chunks.id, chunkIds))
    .all()

  const grouped = new Map<
    string,
    {
      documentId: string
      pageStart: number | null
      pageEnd: number | null
      rows: ChunkProvenanceRow[]
    }
  >()

  for (const row of rows) {
    let entry = grouped.get(row.chunkId)
    if (!entry) {
      entry = {
        documentId: row.documentId,
        pageStart: row.pageStart,
        pageEnd: row.pageEnd,
        rows: []
      }
      grouped.set(row.chunkId, entry)
    }

    // 没有映射的 chunk 仍然解析（blocks 为空），左连接因此会给出一个全 NULL 块
    if (row.blockId === null || row.order === null) continue

    entry.rows.push({
      blockId: row.blockId,
      kind: row.kind as BlockKind,
      level: row.level,
      page: row.page,
      bbox: row.bbox,
      text: row.text ?? '',
      startOffset: row.startOffset ?? 0,
      endOffset: row.endOffset ?? 0,
      order: row.order,
      startInBlock: row.startInBlock ?? 0,
      endInBlock: row.endInBlock ?? 0
    })
  }

  for (const [chunkId, entry] of grouped) {
    result.set(
      chunkId,
      projectChunkProvenance(chunkId, entry.documentId, entry.pageStart, entry.pageEnd, entry.rows)
    )
  }

  return result
}

/**
 * 解析一个 chunk 的来源：文档 id、页码区间，以及按文档顺序排列的块区间。
 * 一次 join chunks → chunk_blocks → document_blocks。chunk 不存在时返回 undefined。
 */
export function resolveChunkProvenance(db: Db, chunkId: string): ChunkProvenance | undefined {
  return resolveChunksProvenance(db, [chunkId]).get(chunkId)
}
