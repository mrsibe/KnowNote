import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import {
  createVectorTableSql,
  knnQuerySql,
  upsertVectorsSql
} from '../src/main/vectorstore/vectorTableSql.ts'
import {
  attachLibrarySource,
  countMemberships,
  deleteLibrarySource,
  insertLibrarySource,
  listLibrarySources,
  planSnapshotWrite,
  updateLibrarySource,
  type EmbeddingSpaceIdentity,
  type VectorTableAccess
} from '../src/main/services/librarySources.ts'

/**
 * 库来源复用边界（#99）的行为，跑在真实 SQLite + sqlite-vec 上。
 *
 * 这一层不 import Electron：`librarySources.ts` 只拿一个 raw better-sqlite3 连接，所以
 * 可以真的建 vec0 表、真的复制向量，而不是只断言 SQL 字符串。这里盯住 ADR 的硬要求：
 * 挂载不调用 embedding、只在 space/维度匹配时复制向量、page/offset 原样保留、donor 与
 * 目标互不影响、未确认或仍被挂载的库来源不能删。
 */

const DIMENSIONS = 4
const SPACE_ID = 'space_test'
const NOW = new Date('2026-01-01T00:00:00Z')
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000)

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE notebooks (id TEXT PRIMARY KEY, title TEXT, description TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE library_sources (
      id TEXT PRIMARY KEY,
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
    );
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      source_uri TEXT,
      local_file_path TEXT,
      source_note_id TEXT,
      source_id TEXT,
      content TEXT,
      structure TEXT,
      content_hash TEXT,
      mime_type TEXT,
      file_size INTEGER,
      metadata TEXT,
      status TEXT NOT NULL,
      source_state TEXT NOT NULL,
      source_mtime_ms INTEGER,
      error_message TEXT,
      chunk_count INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE notebook_embedding_spaces (
      notebook_id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      backend TEXT NOT NULL,
      model TEXT NOT NULL,
      revision TEXT NOT NULL DEFAULT '',
      dimensions INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      notebook_id TEXT NOT NULL,
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      start_offset INTEGER,
      end_offset INTEGER,
      page_start INTEGER,
      page_end INTEGER,
      metadata TEXT,
      token_count INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE document_blocks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      page INTEGER,
      level INTEGER,
      text TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      bbox TEXT,
      metadata TEXT
    );
    CREATE TABLE chunk_blocks (
      chunk_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      start_in_block INTEGER NOT NULL,
      end_in_block INTEGER NOT NULL,
      PRIMARY KEY (chunk_id, block_id)
    );
    CREATE TABLE embeddings (
      id TEXT PRIMARY KEY,
      chunk_id TEXT NOT NULL,
      notebook_id TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE vec_metadata (
      notebook_id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      dimensions INTEGER NOT NULL
    );
  `)
}

interface Fixture {
  db: Database.Database
  tables: VectorTableAccess
}

function fixture(): Fixture {
  const db = new Database(':memory:')
  sqliteVec.load(db)
  createSchema(db)

  const tables: VectorTableAccess = {
    read: (notebookId) => {
      const row = db
        .prepare('SELECT table_name, dimensions FROM vec_metadata WHERE notebook_id = ?')
        .get(notebookId) as { table_name: string; dimensions: number } | undefined
      return row ? { tableName: row.table_name, dimensions: row.dimensions } : undefined
    },
    ensure: (notebookId, dimensions) => {
      const tableName = `vec_${notebookId}`
      db.exec(createVectorTableSql(tableName, dimensions))
      db.prepare(
        'INSERT OR REPLACE INTO vec_metadata (notebook_id, table_name, dimensions) VALUES (?, ?, ?)'
      ).run(notebookId, tableName, dimensions)
      return { tableName, dimensions }
    }
  }

  return { db, tables }
}

function addNotebook(db: Database.Database, id: string): void {
  db.prepare('INSERT INTO notebooks VALUES (?, ?, ?, ?, ?)').run(id, id, null, 0, 0)
}

function addSnapshot(
  db: Database.Database,
  id: string,
  overrides: Record<string, unknown> = {}
): void {
  insertLibrarySource(
    db,
    id,
    {
      title: 'Guide',
      type: 'file',
      sourceUri: '/src/guide.pdf',
      localFilePath: `/files/${id}.pdf`,
      content: 'canonical text',
      structure: JSON.stringify({ sections: [] }),
      contentHash: 'hash',
      mimeType: 'application/pdf',
      fileSize: 123,
      metadata: null,
      ...overrides
    } as Parameters<typeof insertLibrarySource>[2],
    NOW
  )
}

/** 一个已索引的 membership：2 块、2 chunk、2 向量，页码分别是 3 和 4。 */
function seedIndexedMembership(
  db: Database.Database,
  params: {
    documentId: string
    notebookId: string
    sourceId: string
    spaceId?: string
    dimensions?: number
  }
): void {
  const { documentId, notebookId, sourceId } = params
  const spaceId = params.spaceId ?? SPACE_ID
  const dimensions = params.dimensions ?? DIMENSIONS

  db.prepare(
    `INSERT INTO documents
       (id, notebook_id, title, type, source_uri, local_file_path, source_id, content,
        structure, content_hash, mime_type, file_size, metadata, status, source_state,
        chunk_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    documentId,
    notebookId,
    'Guide',
    'file',
    '/src/guide.pdf',
    `/files/${sourceId}.pdf`,
    sourceId,
    'canonical text',
    JSON.stringify({ sections: [] }),
    'hash',
    'application/pdf',
    123,
    null,
    'indexed',
    'available',
    2,
    NOW_SECONDS,
    NOW_SECONDS
  )

  db.prepare(
    `INSERT OR REPLACE INTO notebook_embedding_spaces
       (notebook_id, space_id, backend, model, revision, dimensions, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(notebookId, spaceId, 'local', 'model-x', 'rev', dimensions, NOW_SECONDS)

  const block = db.prepare('INSERT INTO document_blocks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  block.run(
    `${documentId}_b1`,
    documentId,
    'paragraph',
    0,
    3,
    null,
    'first paragraph',
    0,
    15,
    null,
    null
  )
  block.run(
    `${documentId}_b2`,
    documentId,
    'paragraph',
    1,
    4,
    null,
    'second paragraph',
    15,
    32,
    null,
    null
  )

  const chunk = db.prepare('INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  chunk.run(
    `${documentId}_c1`,
    documentId,
    notebookId,
    'first paragraph',
    0,
    0,
    15,
    3,
    3,
    null,
    3,
    NOW_SECONDS
  )
  chunk.run(
    `${documentId}_c2`,
    documentId,
    notebookId,
    'second paragraph',
    1,
    15,
    32,
    4,
    4,
    null,
    3,
    NOW_SECONDS
  )

  const mapping = db.prepare('INSERT INTO chunk_blocks VALUES (?, ?, ?, ?)')
  mapping.run(`${documentId}_c1`, `${documentId}_b1`, 0, 15)
  mapping.run(`${documentId}_c2`, `${documentId}_b2`, 0, 16)

  const tableName = `vec_${notebookId}`
  db.exec(createVectorTableSql(tableName, dimensions))
  db.prepare(
    'INSERT OR REPLACE INTO vec_metadata (notebook_id, table_name, dimensions) VALUES (?, ?, ?)'
  ).run(notebookId, tableName, dimensions)

  db.prepare('INSERT INTO embeddings VALUES (?, ?, ?, ?, ?, ?)').run(
    `${documentId}_e1`,
    `${documentId}_c1`,
    notebookId,
    'model-x',
    dimensions,
    NOW_SECONDS
  )
  db.prepare('INSERT INTO embeddings VALUES (?, ?, ?, ?, ?, ?)').run(
    `${documentId}_e2`,
    `${documentId}_c2`,
    notebookId,
    'model-x',
    dimensions,
    NOW_SECONDS
  )
  db.prepare(upsertVectorsSql(tableName)).run(
    `${documentId}_e1`,
    `${documentId}_c1`,
    new Float32Array([1, 0, 0, 0])
  )
  db.prepare(upsertVectorsSql(tableName)).run(
    `${documentId}_e2`,
    `${documentId}_c2`,
    new Float32Array([0, 1, 0, 0])
  )
}

const count = (db: Database.Database, sql: string, ...params: unknown[]): number =>
  (db.prepare(sql).get(...params) as { c: number }).c

test('reuse copies the indexed donor into the target notebook without touching the donor', () => {
  const { db, tables } = fixture()
  addNotebook(db, 'nbA')
  addNotebook(db, 'nbB')
  addSnapshot(db, 'lib_1')
  seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })

  const result = attachLibrarySource(db, {
    notebookId: 'nbB',
    sourceId: 'lib_1',
    currentSpace: { id: SPACE_ID, dimensions: DIMENSIONS },
    tables,
    now: NOW
  })

  assert.equal(result.indexed, true)
  assert.notEqual(result.documentId, 'docA')
  assert.equal(result.chunkCount, 2)

  const membership = db
    .prepare('SELECT * FROM documents WHERE id = ?')
    .get(result.documentId) as Record<string, unknown>
  assert.equal(membership.source_id, 'lib_1')
  assert.equal(membership.notebook_id, 'nbB')
  assert.equal(membership.status, 'indexed')
  assert.equal(membership.chunk_count, 2)
  assert.equal(membership.content, 'canonical text')

  // page/span/offset 原样保留，只是换了 membership-local 的 id。
  const donorChunks = db
    .prepare('SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index')
    .all('docA') as Array<Record<string, number | string>>
  const targetChunks = db
    .prepare('SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index')
    .all(result.documentId) as Array<Record<string, number | string>>
  assert.equal(targetChunks.length, 2)
  for (let i = 0; i < donorChunks.length; i++) {
    assert.notEqual(targetChunks[i].id, donorChunks[i].id)
    assert.equal(targetChunks[i].chunk_index, donorChunks[i].chunk_index)
    assert.equal(targetChunks[i].page_start, donorChunks[i].page_start)
    assert.equal(targetChunks[i].page_end, donorChunks[i].page_end)
    assert.equal(targetChunks[i].start_offset, donorChunks[i].start_offset)
    assert.equal(targetChunks[i].end_offset, donorChunks[i].end_offset)
    assert.equal(targetChunks[i].notebook_id, 'nbB')
  }

  // 原 derive 的 chunk→block 页面映射也复制过来了。
  const provenance = db
    .prepare(
      `SELECT b.page, cb.start_in_block, cb.end_in_block
       FROM chunk_blocks cb
       JOIN document_blocks b ON b.id = cb.block_id
       JOIN chunks c ON c.id = cb.chunk_id
       WHERE c.document_id = ?
       ORDER BY c.chunk_index`
    )
    .all(result.documentId) as Array<{ page: number; start_in_block: number; end_in_block: number }>
  assert.deepEqual(
    provenance.map((row) => [row.page, row.start_in_block, row.end_in_block]),
    [
      [3, 0, 15],
      [4, 0, 16]
    ]
  )

  // 目标向量真的可查，且与 donor 的向量一致。
  const targetTable = tables.read('nbB')!.tableName
  const hits = db
    .prepare(knnQuerySql(targetTable))
    .all(new Float32Array([1, 0, 0, 0]), 5) as Array<{
    chunk_id: string
    distance: number
  }>
  assert.equal(hits.length, 2)
  assert.equal(hits[0].distance, 0)

  // donor 一行未动。
  assert.equal(count(db, 'SELECT COUNT(*) c FROM chunks WHERE document_id = ?', 'docA'), 2)
  const donorTable = tables.read('nbA')!.tableName
  assert.equal(count(db, `SELECT COUNT(*) c FROM ${donorTable}`), 2)
})

test('an empty target adopts the donor embedding space', () => {
  const { db, tables } = fixture()
  addNotebook(db, 'nbA')
  addNotebook(db, 'nbB')
  addSnapshot(db, 'lib_1')
  seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })

  attachLibrarySource(db, {
    notebookId: 'nbB',
    sourceId: 'lib_1',
    currentSpace: { id: SPACE_ID, dimensions: DIMENSIONS },
    tables,
    now: NOW
  })

  const adopted = db
    .prepare('SELECT * FROM notebook_embedding_spaces WHERE notebook_id = ?')
    .get('nbB') as { space_id: string; dimensions: number }
  assert.equal(adopted.space_id, SPACE_ID)
  assert.equal(adopted.dimensions, DIMENSIONS)
  assert.equal(tables.read('nbB')?.dimensions, DIMENSIONS)
})

test('a mismatched current space leaves a pending membership and touches no vectors', () => {
  const { db, tables } = fixture()
  addNotebook(db, 'nbA')
  addNotebook(db, 'nbB')
  addSnapshot(db, 'lib_1')
  seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })

  const result = attachLibrarySource(db, {
    notebookId: 'nbB',
    sourceId: 'lib_1',
    currentSpace: { id: 'space_other', dimensions: DIMENSIONS },
    tables,
    now: NOW
  })

  assert.equal(result.indexed, false)
  const membership = db.prepare('SELECT * FROM documents WHERE id = ?').get(result.documentId) as {
    status: string
    chunk_count: number
  }
  assert.equal(membership.status, 'pending')
  assert.equal(membership.chunk_count, 0)
  assert.equal(
    count(db, 'SELECT COUNT(*) c FROM chunks WHERE document_id = ?', result.documentId),
    0
  )
  assert.equal(tables.read('nbB'), undefined)

  // donor 的向量没被清掉。
  const donorTable = tables.read('nbA')!.tableName
  assert.equal(count(db, `SELECT COUNT(*) c FROM ${donorTable}`), 2)
})

test('a target with an incompatible space does not clear its existing vectors', () => {
  const { db, tables } = fixture()
  addNotebook(db, 'nbA')
  addNotebook(db, 'nbB')
  addSnapshot(db, 'lib_1')
  seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })

  // nbB 已经用另一个 space 索引过：宽度相同但 space 身份不同，不能混用。
  seedIndexedMembership(db, {
    documentId: 'docB',
    notebookId: 'nbB',
    sourceId: 'lib_other',
    spaceId: 'space_other'
  })

  const result = attachLibrarySource(db, {
    notebookId: 'nbB',
    sourceId: 'lib_1',
    currentSpace: { id: SPACE_ID, dimensions: DIMENSIONS },
    tables,
    now: NOW
  })

  assert.equal(result.indexed, false)
  const bTable = tables.read('nbB')!.tableName
  assert.equal(
    count(db, `SELECT COUNT(*) c FROM ${bTable}`),
    2,
    'existing target vectors were cleared'
  )
})

test('attaching the same source twice is idempotent', () => {
  const { db, tables } = fixture()
  addNotebook(db, 'nbA')
  addNotebook(db, 'nbB')
  addSnapshot(db, 'lib_1')
  seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })

  const first = attachLibrarySource(db, {
    notebookId: 'nbB',
    sourceId: 'lib_1',
    currentSpace: { id: SPACE_ID, dimensions: DIMENSIONS },
    tables,
    now: NOW
  })
  const second = attachLibrarySource(db, {
    notebookId: 'nbB',
    sourceId: 'lib_1',
    currentSpace: { id: SPACE_ID, dimensions: DIMENSIONS },
    tables,
    now: NOW
  })

  assert.equal(second.documentId, first.documentId)
  assert.equal(second.indexed, true)
  assert.equal(
    count(
      db,
      'SELECT COUNT(*) c FROM documents WHERE notebook_id = ? AND source_id = ?',
      'nbB',
      'lib_1'
    ),
    1
  )
})

test('attach validates that the notebook and the source exist', () => {
  const { db, tables } = fixture()
  addNotebook(db, 'nbA')
  addSnapshot(db, 'lib_1')

  assert.throws(
    () =>
      attachLibrarySource(db, {
        notebookId: 'missing',
        sourceId: 'lib_1',
        currentSpace: { id: SPACE_ID, dimensions: DIMENSIONS },
        tables,
        now: NOW
      }),
    /Notebook missing not found/
  )
  assert.throws(
    () =>
      attachLibrarySource(db, {
        notebookId: 'nbA',
        sourceId: 'missing',
        currentSpace: { id: SPACE_ID, dimensions: DIMENSIONS },
        tables,
        now: NOW
      }),
    /Library source missing not found/
  )
})

test('listLibrarySources hides attached snapshots and reports reuse readiness', () => {
  const { db, tables } = fixture()
  addNotebook(db, 'nbA')
  addNotebook(db, 'nbB')
  addSnapshot(db, 'lib_1')
  seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })

  // nbB 还没挂载 lib_1：可见、membershipCount 1、可复用。
  const forB = listLibrarySources(db, 'nbB', { id: SPACE_ID, dimensions: DIMENSIONS }, tables)
  assert.deepEqual(
    forB.map((s) => s.id),
    ['lib_1']
  )
  assert.equal(forB[0].membershipCount, 1)
  assert.equal(forB[0].canReuseIndex, true)
  assert.equal(forB[0].type, 'file')
  assert.equal(forB[0].mimeType, 'application/pdf')

  // 已挂载的 notebook 看不到它。
  const forA = listLibrarySources(db, 'nbA', { id: SPACE_ID, dimensions: DIMENSIONS }, tables)
  assert.deepEqual(forA, [])

  // 当前模型不同 -> 不可直接复用。
  const mismatched = listLibrarySources(
    db,
    'nbB',
    { id: 'space_other', dimensions: DIMENSIONS },
    tables
  )
  assert.equal(mismatched[0].canReuseIndex, false)
})

test('deleteLibrarySource refuses unconfirmed or attached sources and reports the file', () => {
  const { db, tables } = fixture()
  addNotebook(db, 'nbA')
  addNotebook(db, 'nbB')
  addSnapshot(db, 'lib_1')
  seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })
  attachLibrarySource(db, {
    notebookId: 'nbB',
    sourceId: 'lib_1',
    currentSpace: { id: SPACE_ID, dimensions: DIMENSIONS },
    tables,
    now: NOW
  })

  assert.throws(() => deleteLibrarySource(db, 'lib_1', false), /confirmation/)
  assert.throws(() => deleteLibrarySource(db, 'lib_1', true), /still attached/)

  // 解除两个 membership 后，永久删除才被允许，并交出待 unlink 的文件路径。
  db.prepare('DELETE FROM documents WHERE source_id = ?').run('lib_1')
  const result = deleteLibrarySource(db, 'lib_1', true)
  assert.deepEqual(result, { localFilePath: '/files/lib_1.pdf', deleted: true })
  assert.equal(count(db, 'SELECT COUNT(*) c FROM library_sources WHERE id = ?', 'lib_1'), 0)

  // 已经不存在时是幂等的 no-op。
  assert.deepEqual(deleteLibrarySource(db, 'lib_1', true), { localFilePath: null, deleted: false })
})

test('an unparsed snapshot is visible for cleanup but cannot be reused', () => {
  const { db, tables } = fixture()
  addNotebook(db, 'nbA')
  // 迁移回填一个解析前就失败的来源：content 为 NULL。
  insertLibrarySource(
    db,
    'lib_empty',
    {
      title: 'empty',
      type: 'file',
      sourceUri: '/src/empty.pdf',
      localFilePath: '/files/lib_empty.pdf',
      content: null,
      structure: null,
      contentHash: null,
      mimeType: null,
      fileSize: null,
      metadata: null
    },
    NOW
  )

  const unparsed = listLibrarySources(db, 'nbA', { id: SPACE_ID, dimensions: DIMENSIONS }, tables)
  assert.equal(unparsed[0].id, 'lib_empty')
  assert.equal(unparsed[0].hasContent, false)
  assert.equal(unparsed[0].canReuseIndex, false)
  assert.throws(
    () =>
      attachLibrarySource(db, {
        notebookId: 'nbA',
        sourceId: 'lib_empty',
        currentSpace: { id: SPACE_ID, dimensions: DIMENSIONS },
        tables,
        now: NOW
      }),
    /no parsed content/
  )

  // Retry fills the snapshot and makes it attachable.
  updateLibrarySource(
    db,
    'lib_empty',
    {
      title: 'empty',
      type: 'file',
      sourceUri: '/src/empty.pdf',
      localFilePath: '/files/lib_empty.pdf',
      content: 'now parsed',
      structure: null,
      contentHash: 'h',
      mimeType: 'application/pdf',
      fileSize: 1,
      metadata: null
    },
    NOW
  )
  const listed = listLibrarySources(db, 'nbA', { id: SPACE_ID, dimensions: DIMENSIONS }, tables)
  assert.deepEqual(
    listed.map((s) => s.id),
    ['lib_empty']
  )
  assert.equal(listed[0].hasContent, true)
  assert.equal(listed[0].canReuseIndex, false)
})

test('listLibrarySources and attachLibrarySource make the same reuse decision', () => {
  // UI 从 canReuseIndex 承诺的复用，attach 必须真的能兑现 —— 两边共用同一个判定。
  const check = (
    setup: (db: Database.Database) => {
      notebookId: string
      sourceId: string
      space: EmbeddingSpaceIdentity
    }
  ): void => {
    const { db, tables } = fixture()
    const { notebookId, sourceId, space } = setup(db)

    const listed = listLibrarySources(db, notebookId, space, tables).find((s) => s.id === sourceId)
    assert.ok(listed, `source ${sourceId} should be listed for ${notebookId}`)

    const attached = attachLibrarySource(db, {
      notebookId,
      sourceId,
      currentSpace: space,
      tables,
      now: NOW
    })
    assert.equal(
      attached.indexed,
      listed.canReuseIndex,
      `list canReuseIndex=${listed.canReuseIndex} but attach indexed=${attached.indexed}`
    )
  }

  check((db) => {
    addNotebook(db, 'nbA')
    addNotebook(db, 'nbB')
    addSnapshot(db, 'lib_1')
    seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })
    return { notebookId: 'nbB', sourceId: 'lib_1', space: { id: SPACE_ID, dimensions: DIMENSIONS } }
  })

  check((db) => {
    addNotebook(db, 'nbA')
    addNotebook(db, 'nbB')
    addSnapshot(db, 'lib_1')
    seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })
    // 当前配置的 space 不同：两边都必须是 false。
    return {
      notebookId: 'nbB',
      sourceId: 'lib_1',
      space: { id: 'space_other', dimensions: DIMENSIONS }
    }
  })

  check((db) => {
    addNotebook(db, 'nbA')
    addSnapshot(db, 'lib_1')
    // 没有 donor：两边都必须是 false。
    return { notebookId: 'nbA', sourceId: 'lib_1', space: { id: SPACE_ID, dimensions: DIMENSIONS } }
  })

  check((db) => {
    addNotebook(db, 'nbA')
    addNotebook(db, 'nbB')
    addSnapshot(db, 'lib_1')
    seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })
    // 目标已用不兼容的 space 索引：两边都必须是 false。
    seedIndexedMembership(db, {
      documentId: 'docB',
      notebookId: 'nbB',
      sourceId: 'lib_other',
      spaceId: 'space_b'
    })
    return { notebookId: 'nbB', sourceId: 'lib_1', space: { id: SPACE_ID, dimensions: DIMENSIONS } }
  })
})

test('planSnapshotWrite never mutates a shared or parsed snapshot on retry', () => {
  // 共享（>1 membership）永远新开，绝不为一个 membership 改写别人的快照。
  assert.equal(
    planSnapshotWrite({ refresh: false, hasSourceId: true, hasContent: true, membershipCount: 2 }),
    'new'
  )
  // 刷新永远新开。
  assert.equal(
    planSnapshotWrite({ refresh: true, hasSourceId: true, hasContent: true, membershipCount: 1 }),
    'new'
  )
  // 首次导入新开。
  assert.equal(
    planSnapshotWrite({
      refresh: false,
      hasSourceId: false,
      hasContent: false,
      membershipCount: 0
    }),
    'new'
  )
  // 独占的已解析快照保持不动。
  assert.equal(
    planSnapshotWrite({ refresh: false, hasSourceId: true, hasContent: true, membershipCount: 1 }),
    'keep'
  )
  // 独占但从未解析成功（迁移回填的空快照）才允许原地补齐。
  assert.equal(
    planSnapshotWrite({ refresh: false, hasSourceId: true, hasContent: false, membershipCount: 1 }),
    'fill'
  )
})

test('countMemberships counts every notebook that mounted the snapshot', () => {
  const { db, tables } = fixture()
  addNotebook(db, 'nbA')
  addNotebook(db, 'nbB')
  addSnapshot(db, 'lib_1')
  seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })
  assert.equal(countMemberships(db, 'lib_1'), 1)

  attachLibrarySource(db, {
    notebookId: 'nbB',
    sourceId: 'lib_1',
    currentSpace: { id: SPACE_ID, dimensions: DIMENSIONS },
    tables,
    now: NOW
  })
  assert.equal(countMemberships(db, 'lib_1'), 2)
  assert.equal(countMemberships(db, 'lib_unknown'), 0)
})

test('refresh copy-on-write leaves the shared snapshot and its peers untouched', () => {
  const { db, tables } = fixture()
  addNotebook(db, 'nbA')
  addNotebook(db, 'nbB')
  addSnapshot(db, 'lib_shared')
  seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_shared' })
  // B 也挂载同一 snapshot，所以刷新 A 必须新开 snapshot，不能覆盖共享文件。
  const forB = attachLibrarySource(db, {
    notebookId: 'nbB',
    sourceId: 'lib_shared',
    currentSpace: { id: SPACE_ID, dimensions: DIMENSIONS },
    tables,
    now: NOW
  })

  // 刷新 A：新 snapshot 一行 + 把 A 的 membership 指过去（ingestFile 的 copy-on-write 结果）。
  addSnapshot(db, 'lib_refreshed', {
    content: 'refreshed text',
    localFilePath: '/files/lib_refreshed.pdf'
  })
  db.prepare('UPDATE documents SET source_id = ?, content = ? WHERE id = ?').run(
    'lib_refreshed',
    'refreshed text',
    'docA'
  )

  const peer = db
    .prepare('SELECT source_id, content FROM documents WHERE id = ?')
    .get(forB.documentId) as { source_id: string; content: string }
  assert.equal(peer.source_id, 'lib_shared', 'peers must stay on the old snapshot')
  assert.equal(peer.content, 'canonical text')

  const original = db
    .prepare('SELECT content, local_file_path FROM library_sources WHERE id = ?')
    .get('lib_shared') as { content: string; local_file_path: string }
  assert.equal(original.content, 'canonical text')
  assert.equal(original.local_file_path, '/files/lib_shared.pdf')

  const refreshed = db
    .prepare('SELECT content, local_file_path FROM library_sources WHERE id = ?')
    .get('lib_refreshed') as { content: string; local_file_path: string }
  assert.equal(refreshed.content, 'refreshed text')
  assert.notEqual(refreshed.local_file_path, original.local_file_path)
})

for (const missing of ['vector', 'metadata', 'chunk'] as const) {
  test(`incomplete donor ${missing} coverage creates only a pending membership`, () => {
    const { db, tables } = fixture()
    addNotebook(db, 'nbA')
    addNotebook(db, 'nbB')
    addSnapshot(db, 'lib_1')
    seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })
    if (missing === 'vector')
      db.prepare('DELETE FROM vec_nbA WHERE embedding_id = ?').run('docA_e1')
    if (missing === 'metadata') db.prepare('DELETE FROM embeddings WHERE id = ?').run('docA_e1')
    if (missing === 'chunk') db.prepare('DELETE FROM chunks WHERE id = ?').run('docA_c1')
    const currentSpace = { id: SPACE_ID, dimensions: DIMENSIONS }
    assert.equal(listLibrarySources(db, 'nbB', currentSpace, tables)[0].canReuseIndex, false)
    const result = attachLibrarySource(db, {
      notebookId: 'nbB',
      sourceId: 'lib_1',
      currentSpace,
      tables
    })
    assert.equal(result.indexed, false)
    assert.equal(result.chunkCount, 0)
    assert.equal(tables.read('nbB'), undefined)
    db.close()
  })
}

test('a membership being refreshed is not offered or used as a reusable donor', () => {
  // The refresh window (#99 review): the membership already points at its new
  // snapshot while the old index is still live. It must not be copied.
  const { db, tables } = fixture()
  addNotebook(db, 'nbA')
  addNotebook(db, 'nbB')
  addSnapshot(db, 'lib_1')
  seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })
  db.prepare("UPDATE documents SET status = 'processing' WHERE id = 'docA'").run()

  const currentSpace = { id: SPACE_ID, dimensions: DIMENSIONS }
  assert.equal(listLibrarySources(db, 'nbB', currentSpace, tables)[0].canReuseIndex, false)
  const result = attachLibrarySource(db, {
    notebookId: 'nbB',
    sourceId: 'lib_1',
    currentSpace,
    tables
  })
  assert.equal(result.indexed, false)
  assert.equal(result.chunkCount, 0)
  assert.equal(
    count(db, "SELECT COUNT(*) AS c FROM chunks WHERE notebook_id = 'nbB'"),
    0,
    'a half-refreshed donor leaked its stale index into another notebook'
  )
  db.close()
})

test('remote unknown current width can reuse a complete donor with the exact persisted configuration identity', () => {
  const { db, tables } = fixture()
  addNotebook(db, 'nbA')
  addNotebook(db, 'nbB')
  addSnapshot(db, 'lib_1')
  seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })
  const currentSpace = { id: SPACE_ID, dimensions: 0 }
  assert.equal(listLibrarySources(db, 'nbB', currentSpace, tables)[0].canReuseIndex, true)
  assert.equal(
    attachLibrarySource(db, { notebookId: 'nbB', sourceId: 'lib_1', currentSpace, tables }).indexed,
    true
  )
  db.close()
})

test('clone immediately indexes its chunks for sparse chat and marks attached sources snapshot-only', () => {
  const { db, tables } = fixture()
  addNotebook(db, 'nbA')
  addNotebook(db, 'nbB')
  addSnapshot(db, 'lib_1')
  seedIndexedMembership(db, { documentId: 'docA', notebookId: 'nbA', sourceId: 'lib_1' })
  const result = attachLibrarySource(db, {
    notebookId: 'nbB',
    sourceId: 'lib_1',
    currentSpace: { id: SPACE_ID, dimensions: DIMENSIONS },
    tables
  })
  const hits = db
    .prepare(
      "SELECT document_id FROM chunks_fts WHERE chunks_fts MATCH 'paragraph' AND notebook_id = 'nbB'"
    )
    .all() as Array<{ document_id: string }>
  assert.equal(hits.length, 2)
  assert.ok(hits.every((hit) => hit.document_id === result.documentId))
  const row = db.prepare('SELECT metadata FROM documents WHERE id = ?').get(result.documentId) as {
    metadata: string
  }
  assert.equal(JSON.parse(row.metadata).librarySnapshotOnly, true)
  db.close()
})
