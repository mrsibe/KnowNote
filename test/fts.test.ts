import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  buildFtsMatchQuery,
  createChunksFtsSql,
  deleteChunksFtsSql,
  insertChunksFtsSql,
  searchChunksFtsSql
} from '../src/main/services/ftsSql.ts'

/**
 * The full-text index (#96) is shared by the search surface and, later, BM25 chat
 * retrieval (#77). Two things must hold: user text can never become FTS syntax,
 * and BM25 ordering is real. The second needs the actual FTS5 engine, so this runs
 * against the bundled SQLite rather than asserting on a SQL string.
 */

test('a search query is quoted term by term, never parsed as FTS syntax', () => {
  assert.equal(buildFtsMatchQuery('hello world'), '"hello" OR "world"')
  assert.equal(buildFtsMatchQuery('  spaced   out  '), '"spaced" OR "out"')

  // Operators and unbalanced quotes would be a syntax error if passed through, and
  // a syntax error reads to the user as "no results" rather than "bad query".
  assert.equal(buildFtsMatchQuery('a -b'), '"a" OR "-b"')
  assert.equal(buildFtsMatchQuery('NEAR(a b)'), '"NEAR(a" OR "b)"')
  assert.equal(buildFtsMatchQuery('say "hi"'), '"say" OR """hi"""')
  assert.equal(buildFtsMatchQuery('c*'), '"c*"')

  assert.equal(buildFtsMatchQuery('   '), null)
  assert.equal(buildFtsMatchQuery(''), null)
})

test('terms are ORed, so a full question still matches some chunks', () => {
  // AND made BM25 return nothing for a natural-language question (#77).
  assert.match(buildFtsMatchQuery('what does section 3 say about attention') ?? '', / OR /)
})

test('delete is parameterised by count and refuses an empty list', () => {
  assert.equal(deleteChunksFtsSql('chunk_id', 2), 'DELETE FROM chunks_fts WHERE chunk_id IN (?, ?)')
  assert.match(deleteChunksFtsSql('document_id', 1), /WHERE document_id IN \(\?\)/)
  assert.throws(() => deleteChunksFtsSql('chunk_id', 0))
})

test('the search statement orders by BM25 and filters by notebook', () => {
  const sql = searchChunksFtsSql()
  assert.match(sql, /bm25\(chunks_fts\)/)
  assert.match(sql, /chunks_fts MATCH \? AND notebook_id = \?/)
  assert.match(sql, /ORDER BY score ASC LIMIT \?$/)
  assert.doesNotMatch(sql, /document_id IN/)
})

test('a document filter adds placeholders before the limit', () => {
  const sql = searchChunksFtsSql({ documentCount: 2 })
  assert.match(sql, /notebook_id = \? AND document_id IN \(\?, \?\) ORDER BY score ASC LIMIT \?$/)
})

/**
 * Integration: the real FTS5 engine, the exact SQL the service runs.
 */
function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(createChunksFtsSql())
  return db
}

function index(
  db: DatabaseSync,
  chunkId: string,
  notebookId: string,
  documentId: string,
  content: string
): void {
  db.prepare(insertChunksFtsSql()).run(content, chunkId, notebookId, documentId)
}

const search = (
  db: DatabaseSync,
  notebookId: string,
  query: string,
  limit = 10,
  documentIds: string[] = []
) => {
  const statement = db.prepare(searchChunksFtsSql({ documentCount: documentIds.length }))
  const rows =
    documentIds.length > 0
      ? statement.all(query, notebookId, ...documentIds, limit)
      : statement.all(query, notebookId, limit)
  return (rows as Array<{ chunk_id: string; score: number }>).map((row) => row.chunk_id)
}

test('BM25 ranks the passage with more occurrences first', () => {
  const db = fixture()
  index(db, 'c1', 'nb1', 'doc1', 'photosynthesis converts light into chemical energy')
  index(
    db,
    'c2',
    'nb1',
    'doc1',
    'photosynthesis photosynthesis is the process by which plants convert light'
  )
  index(db, 'c3', 'nb1', 'doc1', 'an unrelated passage about geology')

  const match = buildFtsMatchQuery('photosynthesis')
  assert.ok(match)
  assert.deepEqual(search(db, 'nb1', match), ['c2', 'c1'])
})

test('a notebook only sees its own chunks', () => {
  const db = fixture()
  index(db, 'c1', 'nb1', 'doc1', 'photosynthesis converts light')
  index(db, 'c2', 'nb2', 'doc2', 'photosynthesis converts light')

  const match = buildFtsMatchQuery('photosynthesis')
  assert.ok(match)
  assert.deepEqual(search(db, 'nb1', match), ['c1'])
  assert.deepEqual(search(db, 'nb2', match), ['c2'])
})

test('a document filter restricts results to the scoped sources', () => {
  const db = fixture()
  index(db, 'c1', 'nb1', 'docA', 'photosynthesis in plants')
  index(db, 'c2', 'nb1', 'docB', 'photosynthesis in algae')

  const match = buildFtsMatchQuery('photosynthesis')
  assert.ok(match)
  assert.deepEqual(search(db, 'nb1', match, 10, ['docB']), ['c2'])
})

test('an operator-looking query returns no rows instead of throwing', () => {
  const db = fixture()
  index(db, 'c1', 'nb1', 'doc1', 'photosynthesis converts light')

  for (const raw of ['-', 'NEAR(', '"', 'a AND b', 'col:value', '^']) {
    const match = buildFtsMatchQuery(raw)
    assert.ok(match, `expected a match expression for ${JSON.stringify(raw)}`)
    assert.doesNotThrow(() => search(db, 'nb1', match), `threw for ${JSON.stringify(raw)}`)
  }
})

test('a snippet is available for the matching content column', () => {
  const db = fixture()
  index(db, 'c1', 'nb1', 'doc1', 'photosynthesis converts light into chemical energy')

  const match = buildFtsMatchQuery('chemical')
  assert.ok(match)
  const row = db
    .prepare(
      "SELECT snippet(chunks_fts, 0, '<', '>', '…', 6) AS s FROM chunks_fts WHERE chunks_fts MATCH ?"
    )
    .get(match) as { s: string }

  assert.match(row.s, /<chemical>/)
})
