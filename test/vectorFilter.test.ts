import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { getLoadablePath } from 'sqlite-vec'
import {
  createVectorTableSql,
  upsertVectorsSql,
  knnQuerySql
} from '../src/main/vectorstore/vectorTableSql.ts'

/**
 * The scope filter (#94) has to narrow the candidate set **inside** the KNN.
 *
 * If it were applied after retrieval, scoping to a document whose best chunk is
 * outside the global top-k would return nothing: the rows the user asked for were
 * never fetched in the first place. A string assertion cannot prove that, so this
 * runs the real bundled sqlite-vec against an in-memory database with the exact
 * SQL the store executes.
 */

const DIMENSIONS = 4

interface Fixture {
  db: DatabaseSync
  table: string
}

function fixture(): Fixture {
  const db = new DatabaseSync(':memory:', { allowExtension: true })
  db.loadExtension(getLoadablePath())
  db.exec('CREATE TABLE chunks (id TEXT PRIMARY KEY, document_id TEXT)')

  const table = 'vec_test'
  db.exec(createVectorTableSql(table, DIMENSIONS))
  return { db, table }
}

const vector = (...values: number[]): Float32Array => new Float32Array(values)

let seq = 0
function seed(
  db: DatabaseSync,
  table: string,
  chunkId: string,
  documentId: string,
  embedding: Float32Array
): void {
  db.prepare('INSERT INTO chunks (id, document_id) VALUES (?, ?)').run(chunkId, documentId)
  db.prepare(upsertVectorsSql(table)).run(`emb_${seq++}`, chunkId, embedding)
}

const ids = (rows: unknown[]): string[] =>
  (rows as Array<{ chunk_id: string }>).map((row) => row.chunk_id)

test('an unscoped query sees every document', () => {
  const { db, table } = fixture()
  seed(db, table, 'cA1', 'docA', vector(1, 0, 0, 0))
  seed(db, table, 'cB1', 'docB', vector(0, 1, 0, 0))

  const rows = db.prepare(knnQuerySql(table)).all(vector(1, 0, 0, 0), 5)

  assert.deepEqual(ids(rows).sort(), ['cA1', 'cB1'])
})

test('a scoped query returns only the scoped document', () => {
  const { db, table } = fixture()
  seed(db, table, 'cA1', 'docA', vector(1, 0, 0, 0))
  seed(db, table, 'cB1', 'docB', vector(0, 1, 0, 0))

  const rows = db.prepare(knnQuerySql(table, 1)).all('docB', vector(1, 0, 0, 0), 5)

  assert.deepEqual(ids(rows), ['cB1'])
})

test('a scoped query finds a document whose best chunk is outside the unscoped top-k', () => {
  const { db, table } = fixture()

  // Five docA chunks sit closer to the query than any docB chunk.
  for (let i = 0; i < 5; i++) {
    seed(db, table, `cA${i}`, 'docA', vector(1 - i * 0.001, 0, 0, 0))
  }
  seed(db, table, 'cB1', 'docB', vector(0, 1, 0, 0))
  seed(db, table, 'cB2', 'docB', vector(0, 0.9, 0, 0))

  const query = vector(1, 0, 0, 0)

  const unscoped = db.prepare(knnQuerySql(table)).all(query, 5)
  assert.equal(
    ids(unscoped).some((id) => id.startsWith('cB')),
    false,
    'docB should be outside the unscoped top-5 — otherwise this test proves nothing'
  )

  const scoped = db.prepare(knnQuerySql(table, 1)).all('docB', query, 5)
  assert.deepEqual(ids(scoped).sort(), ['cB1', 'cB2'])
})

test('a scope with several documents filters to exactly those documents', () => {
  const { db, table } = fixture()
  seed(db, table, 'cA1', 'docA', vector(1, 0, 0, 0))
  seed(db, table, 'cB1', 'docB', vector(0, 1, 0, 0))
  seed(db, table, 'cC1', 'docC', vector(0, 0, 1, 0))

  const rows = db.prepare(knnQuerySql(table, 2)).all('docB', 'docC', vector(1, 0, 0, 0), 5)

  assert.deepEqual(ids(rows).sort(), ['cB1', 'cC1'])
})
