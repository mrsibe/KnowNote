import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import {
  INTERRUPTED_INDEXING_ERROR,
  markInterruptedIndexingFailed
} from '../src/main/db/interruptedIndexing.ts'

test('startup recovery makes interrupted indexing retryable without touching finished sources', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE documents (
      id TEXT PRIMARY KEY, status TEXT, error_message TEXT, updated_at INTEGER,
      content TEXT, local_file_path TEXT, chunk_count INTEGER
    )`)
    const insert = db.prepare('INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const status of ['pending', 'processing', 'indexed', 'failed']) {
      insert.run(
        status,
        status,
        status === 'failed' ? 'Original failure' : null,
        100,
        'Saved content',
        '/saved/source.pdf',
        3
      )
    }
    const now = new Date('2026-01-01T00:00:00Z')
    assert.equal(markInterruptedIndexingFailed(db, now), 2)
    const rows = db.prepare('SELECT * FROM documents ORDER BY id').all()
    for (const row of rows) {
      assert.equal(row.content, 'Saved content')
      assert.equal(row.local_file_path, '/saved/source.pdf')
      assert.equal(row.chunk_count, 3)
      if (row.id === 'pending' || row.id === 'processing') {
        assert.equal(row.status, 'failed')
        assert.equal(row.error_message, INTERRUPTED_INDEXING_ERROR)
        assert.equal(row.updated_at, now.getTime() / 1000)
      } else {
        assert.equal(row.status, row.id)
        assert.equal(row.updated_at, 100)
        assert.equal(row.error_message, row.id === 'failed' ? 'Original failure' : null)
      }
    }
    assert.equal(markInterruptedIndexingFailed(db, new Date()), 0)
  } finally {
    db.close()
  }
})

test('recovery runs after migrations and before new ingestion can start', () => {
  const source = readFileSync('src/main/index.ts', 'utf8')
  const recovery = source.indexOf('markInterruptedIndexingFailed(sqlite)')
  assert.ok(recovery > source.indexOf('  runMigrations()'))
  assert.ok(recovery < source.indexOf('new KnowledgeService('))
  assert.ok(recovery < source.indexOf('await knowledgeService.reconcileWatchedFolders()'))
})

test('Quiz and Anki Cancel buttons use the same reset path as dismissing the dialog', () => {
  for (const path of ['quiz/QuizStartDialog', 'anki/AnkiConfigDialog']) {
    const source = readFileSync(`src/renderer/src/components/notebook/${path}.tsx`, 'utf8')
    assert.match(source, /variant="outline" onClick=\{\(\) => handleOpenChange\(false\)\}/)
  }
})
