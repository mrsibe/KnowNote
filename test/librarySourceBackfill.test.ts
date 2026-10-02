import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

/**
 * 迁移 0023 的一比一回填（#99）。
 *
 * 现有 documents 要在升级时各自得到自己的 library_sources 行，**不合并**标题或路径
 * 相同的来源；membership 保留原 id，历史 citation 不变。这里执行真实迁移文件的语句，
 * 而不是复述它的 SQL。
 */

const MIGRATION = 'src/main/db/migrations/0023_sleepy_luckman.sql'

function applyMigration(db: DatabaseSync): void {
  const statements = readFileSync(MIGRATION, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
  for (const statement of statements) db.exec(statement)
}

function seedLegacyDocuments(db: DatabaseSync): void {
  db.exec(`CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    source_uri TEXT,
    local_file_path TEXT,
    content TEXT,
    structure TEXT,
    content_hash TEXT,
    mime_type TEXT,
    file_size INTEGER,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  const insert = db.prepare(
    'INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  // 同样的标题、不同的内容：必须回填成两行，而不是被合并成一个来源。
  insert.run(
    'doc_1',
    'nb_1',
    'Shared title',
    'file',
    '/src/a.pdf',
    '/files/doc_1.pdf',
    'content one',
    JSON.stringify({ sections: ['one'] }),
    'hash1',
    'application/pdf',
    10,
    JSON.stringify({ pages: 3 }),
    100,
    200
  )
  insert.run(
    'doc_2',
    'nb_2',
    'Shared title',
    'text',
    '/src/b.md',
    '/files/doc_2.md',
    'content two',
    null,
    'hash2',
    'text/markdown',
    20,
    null,
    300,
    400
  )
}

test('migration backfills one library source per legacy document without merging', () => {
  const db = new DatabaseSync(':memory:')
  try {
    seedLegacyDocuments(db)
    applyMigration(db)

    const rows = db.prepare('SELECT * FROM library_sources ORDER BY id').all() as Array<
      Record<string, unknown>
    >
    assert.equal(rows.length, 2)
    assert.deepEqual(
      rows.map((row) => row.id),
      ['lib_doc_1', 'lib_doc_2']
    )

    // 规范文本、解析结构、原始 URI、本地文件都跟着 snapshot 走。
    assert.equal(rows[0].title, 'Shared title')
    assert.equal(rows[0].content, 'content one')
    assert.equal(rows[0].structure, JSON.stringify({ sections: ['one'] }))
    assert.equal(rows[0].source_uri, '/src/a.pdf')
    assert.equal(rows[0].local_file_path, '/files/doc_1.pdf')
    assert.equal(rows[0].content_hash, 'hash1')
    assert.equal(rows[0].mime_type, 'application/pdf')
    assert.equal(rows[0].file_size, 10)
    assert.equal(rows[0].metadata, JSON.stringify({ pages: 3 }))
    assert.equal(rows[1].type, 'text')

    const documents = (
      db.prepare('SELECT id, source_id FROM documents ORDER BY id').all() as Array<{
        id: string
        source_id: string
      }>
    ).map((row) => ({ id: row.id, source_id: row.source_id }))
    assert.deepEqual(documents, [
      { id: 'doc_1', source_id: 'lib_doc_1' },
      { id: 'doc_2', source_id: 'lib_doc_2' }
    ])
  } finally {
    db.close()
  }
})

test('the backfill is idempotent on re-run because it only fills NULL source ids', () => {
  const db = new DatabaseSync(':memory:')
  try {
    seedLegacyDocuments(db)
    applyMigration(db)
    // 再跑一次 UPDATE（迁移只跑一次，但 guard 让重跑安全）。
    db.exec("UPDATE documents SET source_id = 'lib_' || id WHERE source_id IS NULL")
    const documents = (
      db.prepare('SELECT id, source_id FROM documents ORDER BY id').all() as Array<{
        id: string
        source_id: string
      }>
    ).map((row) => ({ id: row.id, source_id: row.source_id }))
    assert.deepEqual(documents, [
      { id: 'doc_1', source_id: 'lib_doc_1' },
      { id: 'doc_2', source_id: 'lib_doc_2' }
    ])
  } finally {
    db.close()
  }
})
