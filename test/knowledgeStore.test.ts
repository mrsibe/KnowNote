import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useKnowledgeStore } from '../src/renderer/src/store/knowledgeStore.ts'

/**
 * A failed import has to leave a trace (#146).
 *
 * Every entry point in `SourcePanel` discards the store's return value — the store
 * reports failure by *returning* `{ success: false, error }` rather than throwing —
 * and the store only reloaded the library when the import had succeeded. So a failed
 * import produced nothing at all: no error, no row, and a panel that still showed its
 * empty state, which reads as "the upload worked and the app is not showing it".
 *
 * The store's half of the fix is what these tests pin: after *any* attempt the
 * library is re-read (a `status: 'failed'` row may already be persisted and is
 * exactly the feedback the reader needs) and the reason is recorded.
 *
 * Importing renderer code means typechecking it, which is why `tsconfig.test.json`
 * also includes `src/preload/index.d.ts` — that is where `window.api` is declared.
 */

interface CallLog {
  getDocuments: number
  getStats: number
}

interface ApiOptions {
  /** What the library contains when re-read. */
  documents?: Array<Record<string, unknown>>
  /** When set, every add resolves with `{ success: false, error }`. */
  failsWith?: string
  /** When set, every add rejects, the way a failed IPC round trip does. */
  rejectsWith?: string
}

function installKnowledgeApi(options: ApiOptions = {}): CallLog {
  const log: CallLog = { getDocuments: 0, getStats: 0 }
  const documents = options.documents ?? []

  const add = async (): Promise<{ success: boolean; documentId?: string; error?: string }> => {
    if (options.rejectsWith) throw new Error(options.rejectsWith)
    if (options.failsWith) return { success: false, error: options.failsWith }
    return { success: true, documentId: 'doc_new' }
  }

  const knowledge = {
    getDocuments: async (): Promise<unknown[]> => {
      log.getDocuments += 1
      return documents
    },
    getStats: async (): Promise<null> => {
      log.getStats += 1
      return null
    },
    addDocument: add,
    addDocumentFromFile: add,
    addDocumentFromUrl: add,
    addNote: add
  }

  ;(globalThis as unknown as { window: unknown }).window = { api: { knowledge } }
  return log
}

const resetStore = (): void => {
  useKnowledgeStore.setState({
    documents: [],
    stats: null,
    error: null,
    isIndexing: false,
    isLoading: false,
    documentsLoaded: false,
    indexProgress: null
  })
}

const state = (): ReturnType<typeof useKnowledgeStore.getState> => useKnowledgeStore.getState()

/** The four ways a source gets in, all of which used to discard their result. */
const entryPoints: Array<{
  name: string
  add: (notebookId: string) => Promise<{ success: boolean; error?: string }>
}> = [
  {
    name: 'pasted text',
    add: (notebookId) =>
      state().addDocument(notebookId, { title: 'notes', type: 'text', content: 'content' })
  },
  {
    name: 'a file',
    add: (notebookId) => state().addDocumentFromFile(notebookId, '/tmp/notes.exe')
  },
  {
    name: 'a URL',
    add: (notebookId) => state().addDocumentFromUrl(notebookId, 'https://example.invalid')
  },
  { name: 'a note', add: (notebookId) => state().addNoteToKnowledge(notebookId, 'note_1') }
]

for (const entry of entryPoints) {
  test(`${entry.name}: a failed import still re-reads the library and records the reason`, async () => {
    resetStore()

    // The row a failure *after* the source row exists leaves behind: this is the
    // feedback the reader needs, and it can only appear if the list is re-read.
    const log = installKnowledgeApi({
      documents: [{ id: 'doc_1', title: 'broken.pdf', status: 'failed' }],
      failsWith: 'Unsupported file type: exe'
    })

    const result = await entry.add('notebook_1')

    assert.equal(result.success, false, 'a failed import reported success')
    assert.equal(state().error, 'Unsupported file type: exe', 'the reason was not recorded')
    assert.equal(
      log.getDocuments,
      1,
      'the library was not re-read, so the failed row stays invisible'
    )
    assert.equal(log.getStats, 1, 'the stats were not re-read')
    assert.equal(state().documents.length, 1, 'the failed row did not reach the list')
    assert.equal(state().documents[0].status, 'failed', 'the row lost its status')
    assert.equal(state().isIndexing, false, 'the panel is still showing the import as running')
  })
}

test('a successful import re-reads the library and clears an earlier failure', async () => {
  resetStore()

  installKnowledgeApi({ failsWith: 'No chunks generated from document' })
  await state().addDocumentFromFile('notebook_1', '/tmp/scanned.pdf')
  assert.equal(state().error, 'No chunks generated from document', 'the failure was not recorded')

  const log = installKnowledgeApi({ documents: [{ id: 'doc_2', status: 'indexed' }] })
  const result = await state().addDocumentFromFile('notebook_1', '/tmp/notes.pdf')

  assert.equal(result.success, true, 'a successful import reported failure')
  assert.equal(state().error, null, 'the previous failure was left behind')
  assert.equal(log.getDocuments, 1, 'the library was not re-read')
  assert.equal(state().documents.length, 1, 'the imported document is not in the list')
})

test('an import whose IPC call rejects is reported and still re-reads the library', async () => {
  resetStore()

  // A rejection can happen after the main process has already written the source
  // row (a reload, an error at the process boundary), so the failure path cannot
  // assume that nothing changed.
  const log = installKnowledgeApi({
    documents: [{ id: 'doc_3', status: 'failed' }],
    rejectsWith: 'An object could not be cloned'
  })

  const result = await state().addDocumentFromFile('notebook_1', '/tmp/notes.pdf')

  assert.equal(result.success, false, 'a rejected import reported success')
  assert.equal(state().error, 'An object could not be cloned', 'the rejection was not recorded')
  assert.equal(log.getDocuments, 1, 'the library was not re-read after a rejection')
  assert.equal(state().documents.length, 1, 'the list did not pick up what really happened')
  assert.equal(state().isIndexing, false, 'the panel is still showing the import as running')
})
