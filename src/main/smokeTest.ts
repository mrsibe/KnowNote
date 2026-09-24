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
 * native addons, and the app's own vector-store code path - and then exits
 * without creating a window, so CI can gate on the exit code. It is driven by
 * `scripts/smoke-packaged.mjs`.
 */

import Logger from '../shared/utils/logger'
import { closeDatabase, getSqlite, initDatabase, initVectorStore, runMigrations } from './db'
import { SQLiteVectorStore } from './vectorstore/SQLiteVectorStore'

export const SMOKE_TEST_FLAG = '--smoke-test'

export function isSmokeTestRequested(argv: readonly string[] = process.argv): boolean {
  return argv.includes(SMOKE_TEST_FLAG)
}

/** Must match the FLOAT[...] width of vec_embeddings in initVectorStore(). */
const EMBEDDING_DIM = 1024

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
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

  runMigrations()
  pass('drizzle migrations applied')

  initVectorStore()
  pass('vec0 virtual table created')

  const database = getSqlite()
  assert(database, 'database handle is missing after initDatabase()')
  const { version } = database.prepare('SELECT vec_version() AS version').get() as {
    version: string
  }
  assert(
    typeof version === 'string' && version.length > 0,
    'vec_version() returned nothing, so the extension did not really load'
  )
  pass(`sqlite-vec reports version ${version}`)

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
