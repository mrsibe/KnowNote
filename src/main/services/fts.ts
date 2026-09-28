import { getSqlite } from '../db'
import {
  backfillChunksFtsSql,
  buildFtsMatchQuery,
  createChunksFtsSql,
  deleteChunksFtsSql,
  insertChunksFtsSql,
  searchChunksFtsSql
} from './ftsSql'

/**
 * Full-text index over chunks (#96) — the database operations.
 *
 * The SQL lives in `ftsSql.ts` (pure, testable without Electron); this file runs it
 * against the real connection.
 */

export * from './ftsSql'

/**
 * 建表 + 补齐缺失的行。
 *
 * 每次调用都补齐而不是只建一次表：在「chunk 已写入、FTS 行还没写」之间崩溃，或一份
 * 旧库在引入 FTS 之前就已经索引过，都会留下没有 FTS 行的 chunk。补齐让这两种情况
 * 自愈，代价只是一条 INSERT..SELECT。
 */
export function ensureChunksFts(): void {
  const sqlite = getSqlite()
  if (!sqlite) return
  sqlite.exec(createChunksFtsSql())
  sqlite.exec(backfillChunksFtsSql())
}

export interface ChunksFtsRow {
  chunkId: string
  notebookId: string
  documentId: string
  content: string
}

/** 写入刚索引好的 chunk。 */
export function indexChunksFts(rows: readonly ChunksFtsRow[]): void {
  if (rows.length === 0) return
  const sqlite = getSqlite()
  if (!sqlite) return

  const statement = sqlite.prepare(insertChunksFtsSql())
  const insert = sqlite.transaction((items: readonly ChunksFtsRow[]) => {
    for (const item of items) {
      statement.run(item.content, item.chunkId, item.notebookId, item.documentId)
    }
  })
  insert(rows)
}

/** 删除一份文档的全部 FTS 行（重新索引、删除文档时）。 */
export function deleteDocumentChunksFts(documentId: string): void {
  const sqlite = getSqlite()
  if (!sqlite) return
  sqlite.prepare(deleteChunksFtsSql('document_id', 1)).run(documentId)
}

export interface ChunksFtsHit {
  chunkId: string
  /** BM25 转成正数，越大越相关。 */
  score: number
}

/**
 * 字面检索：BM25 排序，可限定来源（#94 的 scope）。
 *
 * 返回的顺序就是 BM25 顺序；命中已被删除的 chunk 由调用方补齐证据时丢弃。
 */
export function searchChunksFts(
  notebookId: string,
  query: string,
  options: { limit?: number; documentIds?: string[] } = {}
): ChunksFtsHit[] {
  const match = buildFtsMatchQuery(query)
  if (!match) return []

  const sqlite = getSqlite()
  if (!sqlite) return []

  const documentIds = options.documentIds ?? []
  const limit = options.limit ?? 20
  const statement = sqlite.prepare(searchChunksFtsSql({ documentCount: documentIds.length }))
  const rows = (
    documentIds.length > 0
      ? statement.all(match, notebookId, ...documentIds, limit)
      : statement.all(match, notebookId, limit)
  ) as Array<{ chunk_id: string; score: number }>

  return rows.map((row) => ({ chunkId: row.chunk_id, score: -row.score }))
}
