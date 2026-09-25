/**
 * chunkProvenance
 * chunk ↔ block 映射的写入与解析。
 *
 * 检索结果只带 chunk id；引用要落到"哪一页、哪一段"，必须凭映射一路查回块。
 * `resolveChunkProvenance()` 一次 join 同时拿到有序块区间与反规范化的页码区间。
 */

import { eq } from 'drizzle-orm'
import { chunks, documentBlocks, chunkBlocks } from '../db/schema'
import type { getDatabase } from '../db'
import type { ChunkBlockSpan } from './ChunkingService'
import type { BlockKind } from './blocks/documentBlocks'

/** drizzle 实例类型（与 `getDatabase()` 的返回一致）。 */
type Db = ReturnType<typeof getDatabase>

/** 解析结果里的单个块。 */
export interface ChunkProvenanceBlock {
  blockId: string
  kind: BlockKind
  level: number | null
  page: number | null
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
 * 解析一个 chunk 的来源：文档 id、页码区间，以及按文档顺序排列的块区间。
 * 一次 join chunks → chunk_blocks → document_blocks。chunk 不存在时返回 undefined。
 */
export function resolveChunkProvenance(db: Db, chunkId: string): ChunkProvenance | undefined {
  const chunk = db.select().from(chunks).where(eq(chunks.id, chunkId)).get()
  if (!chunk) return undefined

  const rows = db
    .select({
      blockId: documentBlocks.id,
      kind: documentBlocks.kind,
      level: documentBlocks.level,
      page: documentBlocks.page,
      text: documentBlocks.text,
      startOffset: documentBlocks.startOffset,
      endOffset: documentBlocks.endOffset,
      order: documentBlocks.order,
      startInBlock: chunkBlocks.startInBlock,
      endInBlock: chunkBlocks.endInBlock
    })
    .from(chunkBlocks)
    .innerJoin(documentBlocks, eq(chunkBlocks.blockId, documentBlocks.id))
    .where(eq(chunkBlocks.chunkId, chunkId))
    .all()

  return projectChunkProvenance(chunkId, chunk.documentId, chunk.pageStart, chunk.pageEnd, rows)
}
