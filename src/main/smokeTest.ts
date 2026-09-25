/**
 * Packaged-app smoke test, enabled by passing `--smoke-test`.
 *
 * electron-builder succeeding only proves that an artifact was assembled - not
 * that it can start. Two commits in this repo packaged cleanly and still died on
 * the user's machine:
 *
 *   - `Cannot find module 'script-loader!sql.js'` - a require that rollup hoisted
 *     to the top of the bundled main process;
 *   - `ReferenceError: DOMMatrix is not defined` - module-scope code inside the
 *     bundled pdfjs-dist.
 *
 * Both are module-load failures, and neither `npm run build` nor
 * `build:unpack` noticed, because the modules only load when the app actually
 * runs. "It opened on my machine" is therefore not a gate anyone can rely on.
 *
 * Running the packaged executable with `--smoke-test` exercises the things that
 * actually broke - loading every external package the main process needs, the
 * native addons, the app's own vector-store code path and the document importers
 * (PDF, DOCX, HTML) against the fixtures in test/fixtures - and then exits
 * without showing a window, so CI can gate on the exit code. It is driven by
 * `scripts/smoke-packaged.mjs`, which passes `--smoke-fixtures=<dir>`.
 *
 * One check does create a hidden window: a custom scheme's `supportFetchAPI`
 * privilege is only observable from a renderer, and checking it from the main
 * process is what let #135 ship.
 */

import Logger from '../shared/utils/logger'
import { readFile, readdir } from 'fs/promises'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { net, BrowserWindow } from 'electron'
import { eq } from 'drizzle-orm'
import {
  closeDatabase,
  createNotebookVectorTable,
  dropNotebookVectorTable,
  getDatabase,
  getNotebookVectorTable,
  getSqlite,
  initDatabase,
  initVectorStore,
  rebuildNotebookVectorTable,
  runMigrations
} from './db'
import { documents, documentBlocks, chunks, chunkBlocks } from './db/schema'
import type Database from 'better-sqlite3'
import { FileParserService } from './services/FileParserService'
import { WebLoader } from './services/loaders/WebLoader'
import { SQLiteVectorStore } from './vectorstore/SQLiteVectorStore'
import { assignBlockIds, buildDocumentBlocks } from './services/blocks/documentBlocks'
import { ChunkingService } from './services/ChunkingService'
import { insertChunkBlocks, resolveChunkProvenance } from './services/chunkProvenance'
import { KnowledgeService } from './services/KnowledgeService'
import { DenseRetriever } from './services/retrieval'
import { documentUrl } from '../shared/utils/documentUrl'
import { PDFJS_ASSET_DIRS } from '../shared/utils/pdfjsAssets'
import { registerDocumentProtocolHandler } from './protocol/documentProtocol'
import { pdfjsAssetRoot } from './pdfjsAssetPaths'
import type { EmbeddingService } from './services/EmbeddingService'

export const SMOKE_TEST_FLAG = '--smoke-test'

/** Directory holding the test/fixtures documents, passed by the launcher. */
const SMOKE_FIXTURES_PREFIX = '--smoke-fixtures='

/** Text every test/fixtures document contains; see test/fixtures/. */
const IMPORT_MARKER = 'KnowNote Import Test'

export function isSmokeTestRequested(argv: readonly string[] = process.argv): boolean {
  return argv.includes(SMOKE_TEST_FLAG)
}

function readFixtureDir(argv: readonly string[]): string {
  const arg = argv.find((value) => value.startsWith(SMOKE_FIXTURES_PREFIX))
  if (!arg) {
    throw new Error(
      `missing ${SMOKE_FIXTURES_PREFIX}<dir>; run this through \`npm run smoke:packaged\``
    )
  }
  return arg.slice(SMOKE_FIXTURES_PREFIX.length)
}

function excerpt(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}...` : flat
}

/** Width of the vector tables this test creates itself (see seedLegacyVectorTable). */
const EMBEDDING_DIM = 1024

/** Notebook seeded by seedLegacyVectorTable() to exercise the upgrade path. */
const LEGACY_NOTEBOOK = 'smoke-notebook-legacy'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function assertThrows(run: () => unknown, message: string): void {
  try {
    run()
  } catch {
    return
  }
  throw new Error(message)
}

/**
 * Hidden windows created for renderer-side checks. They are deliberately **not**
 * destroyed: destroying the last window fires `window-all-closed`, and this app
 * closes the database (and quits) on that event, which would abort every check
 * after this one. The process exits through `app.exit()` anyway.
 */
const smokeWindows: BrowserWindow[] = []

/**
 * Fetch a custom-scheme URL from a real renderer.
 *
 * `protocol.handle` keeps working in the main process even when its scheme was
 * never registered as privileged, so a `net.fetch` check cannot see a missing
 * privilege. Only the renderer's `fetch` can - and that is exactly what broke
 * when two `registerSchemesAsPrivileged()` calls replaced each other and dropped
 * `knownote-doc`, leaving every PDF unopenable (#135).
 */
async function fetchFromRenderer(
  url: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const window = new BrowserWindow({ show: false })
  smokeWindows.push(window)
  await window.loadURL('data:text/html,<html><body></body></html>')
  return (await window.webContents.executeJavaScript(`(async () => {
    try {
      const response = await fetch(${JSON.stringify(url)});
      return { ok: response.ok, status: response.status, body: await response.text() };
    } catch (error) {
      return { ok: false, status: 0, body: String((error && error.message) || error) };
    }
  })()`)) as { ok: boolean; status: number; body: string }
}

/**
 * A deterministic stand-in for `EmbeddingService` so the smoke test can drive
 * the whole index lifecycle (blocks → chunks → embeddings → vectors) without
 * downloading model weights. Only the methods `KnowledgeService` calls are
 * implemented.
 */
function fakeEmbeddingService(dimensions = 16): EmbeddingService {
  const result = (): { embedding: Float32Array; model: string; dimensions: number } => {
    const embedding = new Float32Array(dimensions)
    embedding[0] = 1
    return { embedding, model: 'smoke-embed', dimensions }
  }

  // SAFETY: only `ensureReady`, `embedBatch` and `getSpace` are reached by the
  // index path; the cast hides the rest of the real service's surface from the
  // compiler on purpose, so a new call site here fails loudly at runtime.
  return {
    ensureReady: async () => undefined,
    embed: async () => result(),
    embedBatch: async (texts: string[]) => texts.map(() => result()),
    getSpace: async () => ({
      id: 'smoke-embed-space',
      backend: 'local',
      model: 'smoke-embed',
      revision: '',
      dimensions,
      pooling: 'mean',
      normalize: true
    })
  } as unknown as EmbeddingService
}

/**
 * Rewinds the database to the old layout: one global vec_embeddings table whose
 * width is fixed at 1024, plus a notebook that owns a vector in it.
 *
 * initVectorStore() is expected to move that row into a per-notebook table and
 * drop the global one. Without the migration, upgrading users keep a table the
 * new code never reads, i.e. their knowledge bases silently stop retrieving.
 */
function seedLegacyVectorTable(database: Database.Database): void {
  const now = Date.now()
  database
    .prepare('INSERT INTO notebooks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(LEGACY_NOTEBOOK, 'Legacy smoke notebook', now, now)

  database.exec(`
    CREATE VIRTUAL TABLE vec_embeddings USING vec0(
      embedding_id TEXT PRIMARY KEY,
      chunk_id TEXT,
      notebook_id TEXT,
      embedding FLOAT[1024] distance_metric=cosine
    );
  `)

  const vector = new Float32Array(EMBEDDING_DIM)
  vector[0] = 1
  database
    .prepare(
      'INSERT INTO vec_embeddings (embedding_id, chunk_id, notebook_id, embedding) VALUES (?, ?, ?, ?)'
    )
    .run('smoke-legacy-embedding', 'smoke-legacy-chunk', LEGACY_NOTEBOOK, vector)
}

/**
 * Runs every check in order and returns the names that passed. Throws on the
 * first failure, which the caller turns into a non-zero exit code.
 */
async function runChecks(): Promise<string[]> {
  const passed: string[] = []
  const pass = (name: string): void => {
    passed.push(name)
    console.log(`[SmokeTest] ok   ${name}`)
  }

  // --- native addons: better-sqlite3 + the sqlite-vec loadable extension -----

  initDatabase()
  pass('better-sqlite3 opened the database and loaded the sqlite-vec extension')

  const database = getSqlite()
  assert(database, 'database handle is missing after initDatabase()')

  runMigrations()
  pass('drizzle migrations applied')

  // --- upgrade path: one global vec_embeddings -> one table per notebook -----
  seedLegacyVectorTable(database)
  initVectorStore()

  const migratedTable = getNotebookVectorTable(LEGACY_NOTEBOOK)
  assert(
    migratedTable?.dimensions === EMBEDDING_DIM,
    `the legacy 1024-dimensional table was not migrated (got ${JSON.stringify(migratedTable)})`
  )
  assert(
    database.prepare("SELECT name FROM sqlite_master WHERE name = 'vec_embeddings'").get() ===
      undefined,
    'the legacy global vec_embeddings table was left behind'
  )

  const migratedStore = new SQLiteVectorStore()
  await migratedStore.initialize({ notebookId: LEGACY_NOTEBOOK })
  assert(
    (await migratedStore.count()) === 1,
    'the migrated notebook lost the vector it had before the upgrade'
  )

  const legacyQuery = new Float32Array(EMBEDDING_DIM)
  legacyQuery[0] = 1
  const migratedHits = await migratedStore.query(legacyQuery, { topK: 1 })
  assert(
    migratedHits[0]?.chunkId === 'smoke-legacy-chunk',
    `the migrated vector is not searchable (got ${JSON.stringify(migratedHits)})`
  )
  pass('legacy global vec_embeddings migrates into a searchable per-notebook table')

  // --- document protocol (#71): bytes by id, never by path -------------------
  // The renderer asks for `knownote-doc://docs/<id>`; only a document that the
  // database actually owns is served. This runs in the real packaged main
  // process, which is the only place `protocol.handle` exists.
  const protocolDir = mkdtempSync(join(tmpdir(), 'knownote-smoke-doc-'))
  const protocolFilePath = join(protocolDir, 'payload.pdf')
  const protocolPayload = 'knownote-protocol-payload'
  const protocolDocumentId = 'smoke-protocol-doc'
  writeFileSync(protocolFilePath, protocolPayload)

  database
    .prepare(
      'INSERT INTO documents (id, notebook_id, title, type, content, local_file_path, status, chunk_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      protocolDocumentId,
      LEGACY_NOTEBOOK,
      'Protocol smoke document',
      'file',
      protocolPayload,
      protocolFilePath,
      'indexed',
      0,
      Date.now(),
      Date.now()
    )

  // Hoisted from the re-index section below so the protocol handler is wired to the
  // real Document-layer query rather than a stand-in: this check is what proves
  // `knownote-doc://` serves bytes *through* that path, and that it 404s when the query
  // answers null (#60).
  const knowledge = new KnowledgeService(fakeEmbeddingService())
  registerDocumentProtocolHandler((documentId) => knowledge.getDocumentLocalFilePath(documentId))
  const served = await net.fetch(documentUrl(protocolDocumentId))
  assert(served.ok, `an owned document did not serve (status ${served.status})`)
  assert((await served.text()) === protocolPayload, 'the document protocol served the wrong bytes')
  const unknown = await net.fetch(documentUrl('smoke-missing-doc'))
  assert(unknown.status === 404, `an unknown document id returned ${unknown.status}, not 404`)

  // And the same URL from a renderer: this is the check whose absence let #135 ship.
  const rendererFetch = await fetchFromRenderer(documentUrl(protocolDocumentId))
  assert(
    rendererFetch.ok && rendererFetch.body === protocolPayload,
    `the renderer could not fetch knownote-doc:// (status ${rendererFetch.status}: ${rendererFetch.body})`
  )

  database.prepare('DELETE FROM documents WHERE id = ?').run(protocolDocumentId)
  rmSync(protocolDir, { recursive: true, force: true })
  pass('knownote-doc:// serves an owned document and 404s an unknown id')
  pass('knownote-doc:// is fetchable from a renderer (scheme privileges registered)')

  const { version } = database.prepare('SELECT vec_version() AS version').get() as {
    version: string
  }
  assert(
    typeof version === 'string' && version.length > 0,
    'vec_version() returned nothing, so the extension did not really load'
  )
  pass(`sqlite-vec reports version ${version}`)

  // #77 wants BM25 / hybrid retrieval, and SQLite's BM25 lives in the FTS5 module:
  // whether it exists is a property of the SQLite that better-sqlite3 bundles, not
  // of anything this app compiles or enables. Asking the *shipped* build is the
  // only answer that means anything - better-sqlite3 is rebuilt against the Electron
  // ABI, so it cannot even be loaded from plain Node to answer this off to the side.
  //
  // The check inserts and ranks rather than only reporting a compile flag: a flag is
  // not proof that MATCH and bm25() work in the build users actually run.
  const sqliteVersion = database.prepare('SELECT sqlite_version() AS version').get() as {
    version: string
  }
  const compileOptions = database.prepare('PRAGMA compile_options').all() as {
    compile_options: string
  }[]
  const fts5Flag = compileOptions.some((row) => /ENABLE_FTS5/i.test(row.compile_options))

  database.exec(`
    CREATE VIRTUAL TABLE fts_smoke USING fts5(body);
    INSERT INTO fts_smoke(body) VALUES ('the quick brown fox'), ('lazy dogs sleeping');
  `)
  const ranked = database
    .prepare(
      'SELECT body, bm25(fts_smoke) AS score FROM fts_smoke WHERE fts_smoke MATCH ? ORDER BY score LIMIT 1'
    )
    .get('brown') as { body: string; score: number } | undefined
  assert(
    ranked?.body === 'the quick brown fox',
    `FTS5 MATCH did not return the expected row (got ${JSON.stringify(ranked)})`
  )
  assert(
    typeof ranked.score === 'number' && Number.isFinite(ranked.score),
    'bm25() did not produce a usable rank, so BM25 retrieval is not available'
  )
  database.exec('DROP TABLE fts_smoke')
  pass(
    `FTS5 is available and ranks: sqlite ${sqliteVersion.version}, ENABLE_FTS5 flag ${fts5Flag ? 'present' : 'absent'}, bm25() = ${ranked.score}`
  )

  // Full round trip through the app's own vector store: loading an extension is
  // not the same as being able to use it.
  const store = new SQLiteVectorStore()
  await store.initialize({ notebookId: 'smoke-notebook', dimensions: EMBEDDING_DIM })

  const direction = new Float32Array(EMBEDDING_DIM)
  direction[0] = 1
  const neighbour = new Float32Array(EMBEDDING_DIM)
  neighbour[0] = 0.99
  neighbour[1] = 0.01

  await store.upsert([
    { id: 'smoke-near', chunkId: 'smoke-chunk-near', vector: direction },
    { id: 'smoke-far', chunkId: 'smoke-chunk-far', vector: neighbour }
  ])
  assert((await store.count()) === 2, 'vector store did not persist both vectors')

  const results = await store.query(direction, { topK: 2 })
  assert(results.length === 2, `expected 2 KNN results, got ${results.length}`)
  assert(results[0].id === 'smoke-near', `nearest neighbour was ${results[0].id}`)
  assert(results[0].score > results[1].score, 'cosine ranking is not ordered by similarity')

  await store.delete(['smoke-near', 'smoke-far'])
  assert((await store.count()) === 0, 'vector store delete left rows behind')
  pass('sqlite-vec upsert + KNN query + delete round trip')

  // --- vector width is a per-notebook decision -------------------------------
  // A vec0 table has a fixed FLOAT[...] width, so notebooks using different
  // embedding models must not share a table. Getting this wrong used to fail the
  // insert; the first attempt at fixing it dropped the whole table instead, which
  // is worse - it destroys user data - so the policy is asserted here.
  const otherModel = new SQLiteVectorStore()
  await otherModel.initialize({ notebookId: 'smoke-notebook-768', dimensions: 768 })
  await otherModel.upsert([
    { id: 'smoke-768', chunkId: 'smoke-chunk-768', vector: new Float32Array(768).fill(0.25) }
  ])
  assert((await otherModel.count()) === 1, 'a 768-dimensional notebook did not store its vector')
  assert((await store.count()) === 0, 'two notebooks are sharing one vector table')

  // A mismatched width must be refused rather than silently dropped
  assertThrows(
    () => createNotebookVectorTable('smoke-notebook-768', 1024),
    'a width change was accepted without a rebuild'
  )
  assert(
    (await otherModel.count()) === 1,
    'a mismatched width silently dropped the notebook vectors'
  )

  // Only an explicit rebuild may replace the table, and it must not look indexed
  rebuildNotebookVectorTable('smoke-notebook-768', 1536)
  const rebuilt = new SQLiteVectorStore()
  await rebuilt.initialize({ notebookId: 'smoke-notebook-768' })
  assert(rebuilt.getDimensions() === 1536, 'the rebuilt table did not take the new width')
  assert((await rebuilt.count()) === 0, 'a rebuilt vector table kept the old rows')

  // A notebook that has never been indexed answers empty instead of throwing
  const neverIndexed = new SQLiteVectorStore()
  await neverIndexed.initialize({ notebookId: 'smoke-notebook-empty' })
  assert(neverIndexed.getDimensions() === null, 'an unindexed notebook reported dimensions')
  assert((await neverIndexed.count()) === 0, 'an unindexed notebook reported vectors')
  assert(
    (await neverIndexed.query(new Float32Array(EMBEDDING_DIM), { topK: 3 })).length === 0,
    'an unindexed notebook returned search results'
  )
  pass('vector width is per notebook, mismatch is refused, rebuild is explicit')

  // Deleting a notebook has to take its vector table with it
  dropNotebookVectorTable('smoke-notebook-768')
  assert(
    getNotebookVectorTable('smoke-notebook-768') === undefined,
    'notebook deletion left the vector metadata behind'
  )
  assert(
    database
      .prepare("SELECT name FROM sqlite_master WHERE name = 'vec_smoke_notebook_768'")
      .get() === undefined,
    'notebook deletion left the vector table behind'
  )
  pass('deleting a notebook drops its vector table')

  // --- packages that have broken packaged startup before ---------------------
  // Imported lazily on purpose: normal startup should not depend on the smoke
  // test, and a failure here should be reported as a failed check rather than
  // taking down the module graph before anything can be printed.

  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<article><h1>KnowNote</h1><p>readable</p></article>')
  assert(
    dom.window.document.querySelector('h1')?.textContent === 'KnowNote',
    'jsdom did not parse the document'
  )
  dom.window.close()
  pass('jsdom parses HTML')

  // Loading this at all is the assertion: pdfjs evaluates `new DOMMatrix()` at
  // module scope and only survives if it can require its optional
  // @napi-rs/canvas peer.
  await import('pdfjs-dist/legacy/build/pdf.mjs')
  pass('pdfjs-dist loads and polyfilled DOMMatrix from @napi-rs/canvas')

  // @huggingface/transformers is loaded dynamically by LocalEmbeddingBackend and
  // brings native onnxruntime-node (plus sharp, which its Node bundle imports at
  // module scope). Loading it here is the packaged assertion: the module graph
  // resolves and the native bindings are unpacked. Weights are downloaded on
  // demand, so real inference is not run in the smoke test.
  const { pipeline: featureExtractionPipeline, env: transformersEnv } =
    await import('@huggingface/transformers')
  assert(
    typeof featureExtractionPipeline === 'function' && typeof transformersEnv === 'object',
    '@huggingface/transformers did not expose pipeline()/env'
  )
  await import('onnxruntime-node')
  pass('@huggingface/transformers and onnxruntime-node load')

  // --- document import: the real loaders, against real files ----------------
  // The fixtures live in test/fixtures and are handed over by
  // scripts/smoke-packaged.mjs. A missing directory is a failure rather than a
  // skip: quietly dropping these checks would make the gate look greener than
  // it is, and the PDF path is exactly where the DOMMatrix crash surfaced.
  const fixtures = readFixtureDir(process.argv)
  const parser = new FileParserService()

  const pdf = await parser.parseFile(join(fixtures, 'sample.pdf'))
  assert(
    pdf.content.includes(IMPORT_MARKER),
    `PDF import lost the fixture text (got "${excerpt(pdf.content)}")`
  )
  pass('PDF import extracts text (pdfjs-dist)')

  // PDF.js fetches CMaps, standard fonts and wasm decoders by filename, and the
  // packaged app serves them from `resources/pdfjs/` (electron-builder
  // `extraResources`). Getting that wrong does not fail `npm run build`; it
  // makes every CJK document die at runtime with "Ensure that the `cMapUrl` API
  // parameter is provided." - the failure #125 found. Assert the files actually
  // shipped, in the real packaged layout.
  const assetRoot = pdfjsAssetRoot()
  for (const dir of PDFJS_ASSET_DIRS) {
    const entries = await readdir(join(assetRoot, dir)).catch(() => [])
    assert(
      entries.length > 0,
      `PDF.js assets missing or empty in the packaged app: ${join(assetRoot, dir)}`
    )
  }
  pass('PDF.js CMap / standard font / wasm assets are packaged')

  const docx = await parser.parseFile(join(fixtures, 'sample.docx'))
  assert(
    docx.content.includes(IMPORT_MARKER),
    `DOCX import lost the fixture text (got "${excerpt(docx.content)}")`
  )
  pass('DOCX import extracts text (mammoth)')

  // WebLoader is called directly on purpose: FileParserService dispatches by
  // extension, and a local .html path reaches loadFromPath(), which is
  // unimplemented by design because WebLoader consumes fetched HTML through
  // loadFromBuffer. This is the jsdom + Readability path that actually runs.
  const html = await new WebLoader().loadFromBuffer(await readFile(join(fixtures, 'sample.html')))
  assert(
    html.content.includes(IMPORT_MARKER),
    `HTML import lost the fixture text (got "${excerpt(html.content)}")`
  )
  pass('HTML import extracts body text (jsdom + Readability)')

  // --- provenance: blocks -> chunk -> chunk_blocks -> resolved page range ----
  // test/blocks.test.ts and test/chunkBlocks.test.ts cover the pure builder and
  // chunker, but only the packaged app has a working better-sqlite3, so the
  // database round trip is asserted here: insert a document, its blocks, a chunk
  // and the mapping, then resolve the chunk back through the real join.
  const provenanceDocId = 'smoke-provenance-doc'
  const provenanceChunkId = 'smoke-provenance-chunk'
  const provenanceBlocks = assignBlockIds(
    provenanceDocId,
    buildDocumentBlocks({ content: pdf.content, structure: pdf.structure })
  )
  const provenanceChunks = new ChunkingService().chunkBlocks(pdf.content, provenanceBlocks)
  assert(provenanceChunks.length > 0, 'chunking the PDF fixture produced no chunks')

  const db = getDatabase()
  const provenanceNow = new Date()
  db.insert(documents)
    .values({
      id: provenanceDocId,
      notebookId: LEGACY_NOTEBOOK,
      title: 'Smoke provenance document',
      type: 'file',
      content: pdf.content,
      status: 'indexed',
      chunkCount: provenanceChunks.length,
      createdAt: provenanceNow,
      updatedAt: provenanceNow
    })
    .run()
  db.insert(documentBlocks)
    .values(
      provenanceBlocks.map((block) => ({
        id: block.id,
        documentId: block.documentId,
        kind: block.kind,
        order: block.order,
        page: block.page,
        level: block.level,
        text: block.text,
        startOffset: block.startOffset,
        endOffset: block.endOffset,
        bbox: block.bbox,
        metadata: block.metadata
      }))
    )
    .run()

  const provenanceChunk = provenanceChunks[0]
  db.insert(chunks)
    .values({
      id: provenanceChunkId,
      documentId: provenanceDocId,
      notebookId: LEGACY_NOTEBOOK,
      content: provenanceChunk.content,
      chunkIndex: provenanceChunk.index,
      startOffset: provenanceChunk.startOffset,
      endOffset: provenanceChunk.endOffset,
      pageStart: provenanceChunk.pageStart,
      pageEnd: provenanceChunk.pageEnd,
      tokenCount: provenanceChunk.tokenCount,
      createdAt: provenanceNow
    })
    .run()
  insertChunkBlocks(db, provenanceChunkId, provenanceChunk.blockSpans)

  const resolved = resolveChunkProvenance(db, provenanceChunkId)
  assert(resolved, 'a chunk with a mapping did not resolve')
  assert(resolved.documentId === provenanceDocId, `resolved document was ${resolved.documentId}`)
  assert(
    resolved.blocks.length === provenanceChunk.blockSpans.length,
    `resolved ${resolved.blocks.length} blocks, expected ${provenanceChunk.blockSpans.length}`
  )
  assert(
    resolved.pageStart === 1 && resolved.pageEnd === 1,
    `resolved page range was ${resolved.pageStart}-${resolved.pageEnd}`
  )
  assert(
    resolved.blocks.every((block) => block.page === 1),
    'a resolved block lost its page'
  )
  pass('document blocks, chunk mapping and page range round trip through the database')

  db.delete(chunkBlocks).where(eq(chunkBlocks.chunkId, provenanceChunkId)).run()
  db.delete(chunks).where(eq(chunks.documentId, provenanceDocId)).run()
  db.delete(documentBlocks).where(eq(documentBlocks.documentId, provenanceDocId)).run()
  db.delete(documents).where(eq(documents.id, provenanceDocId)).run()

  // --- re-index keeps the source identity -----------------------------------
  // The bug this guards: `reindexDocument()` used to call `addDocument()`, which
  // minted a new `documentId` and dropped `localFilePath`. A citation persisted
  // against the old id would then point at a source that no longer exists. This
  // drives the real service end to end with a fake embedding backend.
  const reindexNotebook = 'smoke-notebook-reindex'
  const reindexNow = Date.now()
  database
    .prepare('INSERT INTO notebooks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(reindexNotebook, 'Smoke re-index notebook', reindexNow, reindexNow)

  const reindexDocId = await knowledge.addDocumentFromFile(
    reindexNotebook,
    join(fixtures, 'sample.pdf')
  )

  const before = knowledge.getDocument(reindexDocId)
  assert(before?.status === 'indexed', `imported document status was ${before?.status}`)
  assert(Boolean(before?.localFilePath), 'imported document lost its localFilePath')
  const blocksBefore = knowledge.getDocumentBlocks(reindexDocId)
  assert(blocksBefore.length > 0, 'imported document produced no blocks')

  await knowledge.reindexDocument(reindexDocId)

  const after = knowledge.getDocument(reindexDocId)
  assert(Boolean(after), 'the document disappeared after a re-index')
  assert(after!.status === 'indexed', `re-index left status ${after!.status}`)
  assert(after!.localFilePath === before!.localFilePath, 're-index did not preserve localFilePath')
  assert(
    !knowledge
      .getDocuments(reindexNotebook)
      .some((doc) => doc.id !== reindexDocId && doc.title === before!.title),
    're-index created a second document instead of rebuilding in place'
  )
  assert(
    JSON.stringify(knowledge.getDocumentBlocks(reindexDocId)) === JSON.stringify(blocksBefore),
    're-index rebuilt a different block sequence from the persisted structure'
  )
  const chunksAfter = knowledge.getDocumentChunks(reindexDocId)
  assert(
    chunksAfter.length > 0 && after!.chunkCount === chunksAfter.length,
    're-index left the document without chunks'
  )

  // Retrieval delivers provenance, not a bare chunk (#74). The re-index above
  // just rebuilt chunks, embeddings, vectors and the chunk↔block mapping, so
  // this drives the real DenseRetriever against them.
  const evidence = await new DenseRetriever(fakeEmbeddingService()).search(
    reindexNotebook,
    'sample query'
  )
  assert(evidence.length > 0, 'DenseRetriever returned no evidence for an indexed notebook')
  const first = evidence[0]
  assert(first.documentId === reindexDocId, `evidence came from ${first.documentId}`)
  assert(first.source.title.length > 0, 'evidence lost its source title')
  assert(first.content.length > 0, 'evidence lost its content')
  assert(first.locator.pageStart === 1, `evidence page was ${first.locator.pageStart}`)
  assert(first.locator.blocks.length > 0, 'evidence carried no block locator')
  assert(
    first.locator.blocks.every((block) => block.page === 1),
    'an evidence block lost its page'
  )
  assert(
    first.locator.blocks.some((block) => block.bbox && block.bbox.w > 0 && block.bbox.h > 0),
    'evidence lost the paragraph bbox needed to highlight it (#72)'
  )
  pass('DenseRetriever returns retrieved evidence with a page/block locator')

  // Documents imported before `documents.structure` existed have NULL there.
  // Re-indexing them must recover the structure from the local copy *before*
  // clearing the old index, or one re-index would downgrade a page/paragraph
  // citation to a flat block.
  database.prepare('UPDATE documents SET structure = NULL WHERE id = ?').run(reindexDocId)
  assert(
    knowledge.getDocument(reindexDocId)?.structure == null,
    'could not simulate a legacy document without structure'
  )

  await knowledge.reindexDocument(reindexDocId)

  assert(
    Boolean(knowledge.getDocument(reindexDocId)?.structure),
    'legacy re-index did not backfill the structure'
  )
  const legacyBlocks = knowledge.getDocumentBlocks(reindexDocId)
  assert(legacyBlocks.length > 0, 'legacy re-index produced no blocks')
  assert(
    legacyBlocks.every((block) => block.page === 1),
    'legacy re-index dropped page provenance instead of recovering it'
  )
  pass('re-index recovers structure for documents imported before the column existed')

  await knowledge.deleteDocument(reindexDocId)
  assert(
    knowledge.getDocument(reindexDocId) === undefined,
    'deleting the re-indexed document did not remove it'
  )
  pass('re-index rebuilds the derived index in place and keeps the source identity')

  const { ApkgExporter } = await import('./services/exporters/ApkgExporter')
  const { buffer, summary } = await new ApkgExporter().export(
    [{ id: 'smoke-card', type: 'basic', front: 'front', back: 'back', tags: ['smoke'] }],
    'KnowNote Smoke Test'
  )
  assert(buffer.length > 0, 'apkg export returned an empty buffer')
  assert(summary.exportedCount === 1, `expected 1 exported card, got ${summary.exportedCount}`)
  assert(buffer.subarray(0, 2).toString('latin1') === 'PK', 'apkg export is not a zip archive')
  pass(`anki-apkg-export wrote a ${buffer.length} byte .apkg`)

  return passed
}

/**
 * @returns the process exit code: 0 when every check passed.
 */
export async function runSmokeTest(): Promise<number> {
  console.log('[SmokeTest] running packaged-app checks')
  try {
    const passed = await runChecks()
    console.log(`[SmokeTest] PASS - ${passed.length} checks passed`)
    return 0
  } catch (error) {
    Logger.error('SmokeTest', 'FAIL', error)
    console.error('[SmokeTest] FAIL -', error instanceof Error ? error.message : error)
    return 1
  } finally {
    // Go through the real shutdown path too, so a broken close fails the run.
    closeDatabase()
  }
}
