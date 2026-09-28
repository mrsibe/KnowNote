/**
 * Full-text index SQL (#96) — pure builders, no database handle.
 *
 * Kept separate from `fts.ts` for the same reason `vectorTableSql.ts` is separate
 * from `SQLiteVectorStore.ts`: the statements and the query sanitiser must be
 * testable against the real FTS5 engine without loading Electron (the db module
 * imports `electron`, which plain Node cannot).
 *
 * Two consumers share this index and must **not** share ranking semantics:
 *
 * - the global search surface presents literal matches as their own signal;
 * - chat retrieval (#77) fuses BM25 with dense into one ranking.
 */

const CHUNKS_FTS_TABLE = 'chunks_fts'

export function createChunksFtsSql(): string {
  // `content` is indexed; the ids are stored but not tokenized, so a result can be
  // joined back to `chunks` without ever parsing the chunk text out of a snippet.
  return (
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${CHUNKS_FTS_TABLE} USING fts5(` +
    'content, chunk_id UNINDEXED, notebook_id UNINDEXED, document_id UNINDEXED)'
  )
}

export function insertChunksFtsSql(): string {
  return `INSERT INTO ${CHUNKS_FTS_TABLE} (content, chunk_id, notebook_id, document_id) VALUES (?, ?, ?, ?)`
}

/** Backfill rows for chunks indexed before the FTS table existed. */
export function backfillChunksFtsSql(): string {
  return (
    `INSERT INTO ${CHUNKS_FTS_TABLE} (content, chunk_id, notebook_id, document_id) ` +
    'SELECT content, id, notebook_id, document_id FROM chunks ' +
    `WHERE id NOT IN (SELECT chunk_id FROM ${CHUNKS_FTS_TABLE})`
  )
}

export function deleteChunksFtsSql(column: 'chunk_id' | 'document_id', count: number): string {
  if (count <= 0) throw new Error('deleteChunksFtsSql needs at least one id')
  const placeholders = Array.from({ length: count }, () => '?').join(', ')
  return `DELETE FROM ${CHUNKS_FTS_TABLE} WHERE ${column} IN (${placeholders})`
}

/**
 * Turn free text from a search box into an FTS5 MATCH expression.
 *
 * Every whitespace-separated term is quoted, so the user's text can never be
 * parsed as FTS operators (`-`, `*`, `:`, `NEAR`, unbalanced quotes) — a query
 * that is a syntax error is a query that returns nothing, which reads as "no
 * results" rather than "your search is malformed".
 *
 * Terms are **ORed**. AND was the first version and it made BM25 useless for chat
 * retrieval (#77): a natural-language question's terms almost never all appear in
 * one chunk, so sparse returned nothing and hybrid silently degenerated to dense.
 * BM25 already ranks a chunk that matches more terms higher, so OR keeps the best
 * passages first while still finding them.
 *
 * Returns null when there is nothing to search for.
 */
export function buildFtsMatchQuery(raw: string): string | null {
  const terms = raw
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0)
  if (terms.length === 0) return null
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ')
}

export interface FtsSearchSqlOptions {
  /** Filter to these documents, e.g. the chat scope from #94. Empty = no filter. */
  documentCount?: number
}

/**
 * BM25-ranked search within one notebook.
 *
 * `bm25()` returns a negative number where more negative is a better match, so the
 * caller orders ascending and negates it for display.
 */
export function searchChunksFtsSql(options: FtsSearchSqlOptions = {}): string {
  const documentCount = options.documentCount ?? 0
  const documentFilter =
    documentCount > 0
      ? ` AND document_id IN (${Array.from({ length: documentCount }, () => '?').join(', ')})`
      : ''

  return (
    `SELECT chunk_id, bm25(${CHUNKS_FTS_TABLE}) AS score ` +
    `FROM ${CHUNKS_FTS_TABLE} ` +
    `WHERE ${CHUNKS_FTS_TABLE} MATCH ? AND notebook_id = ?${documentFilter} ` +
    'ORDER BY score ASC LIMIT ?'
  )
}
