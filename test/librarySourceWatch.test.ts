import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffFolder, type WatchedDocument } from '../src/main/services/ingestion/folderDiff'

test('library attachments never refresh, restore or go missing in a mutable folder watch', () => {
  const source: WatchedDocument = {
    documentId: 'library-membership',
    sourceUri: '/watch/shared.pdf',
    sourceMtimeMs: null,
    sourceState: 'available',
    snapshotOnly: true
  }
  for (const sourceState of ['available', 'missing', 'changed'] as const) {
    assert.deepEqual(
      diffFolder(
        [{ path: source.sourceUri, relativePath: 'shared.pdf', mtimeMs: 100 }],
        [{ ...source, sourceState }]
      ),
      {
        added: [],
        changed: [],
        missing: [],
        restored: []
      }
    )
  }
  assert.deepEqual(diffFolder([], [source]), { added: [], changed: [], missing: [], restored: [] })
  assert.equal(
    diffFolder(
      [{ path: source.sourceUri, relativePath: 'shared.pdf', mtimeMs: 100 }],
      [{ ...source, snapshotOnly: false }]
    ).changed.length,
    1
  )
})
