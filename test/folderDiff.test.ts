import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffFolder, type WatchedDocument } from '../src/main/services/ingestion/folderDiff.ts'
import type { ScannedFile } from '../src/main/services/ingestion/folderScan.ts'

/**
 * The decision table behind watching a folder (#158).
 *
 * This is the part that must not be guessed: a document is re-indexed only when
 * its file's mtime actually changed, and a document is only marked `missing` when
 * its file is really gone. Everything downstream (re-index, mark missing) is a
 * consequence of this diff.
 */

const file = (path: string, mtimeMs: number): ScannedFile => ({ path, relativePath: path, mtimeMs })

const doc = (
  path: string,
  mtimeMs: number | null,
  sourceState: WatchedDocument['sourceState'] = 'available'
): WatchedDocument => ({
  documentId: `doc_${path}`,
  sourceUri: path,
  sourceMtimeMs: mtimeMs,
  sourceState
})

test('a file with no document is added', () => {
  const diff = diffFolder([file('/p/a.pdf', 100)], [])
  assert.deepEqual(
    diff.added.map((f) => f.path),
    ['/p/a.pdf']
  )
  assert.equal(diff.changed.length + diff.missing.length + diff.restored.length, 0)
})

test('an mtime change is changed, not added', () => {
  const diff = diffFolder([file('/p/a.pdf', 200)], [doc('/p/a.pdf', 100)])
  assert.deepEqual(
    diff.changed.map((f) => f.path),
    ['/p/a.pdf']
  )
  assert.equal(diff.added.length, 0)
})

test('an unchanged file is neither added nor changed', () => {
  const diff = diffFolder([file('/p/a.pdf', 100)], [doc('/p/a.pdf', 100)])
  assert.equal(
    diff.added.length + diff.changed.length + diff.missing.length + diff.restored.length,
    0
  )
})

test('a document with no mtime recorded counts as changed, not as current', () => {
  // An older row has no mtime; the first reconcile after the upgrade must treat it
  // as out of date rather than assume it is current.
  const diff = diffFolder([file('/p/a.pdf', 100)], [doc('/p/a.pdf', null)])
  assert.deepEqual(
    diff.changed.map((f) => f.path),
    ['/p/a.pdf']
  )
})

test('a document whose file is gone is missing', () => {
  const diff = diffFolder([], [doc('/p/gone.pdf', 100)])
  assert.deepEqual(
    diff.missing.map((d) => d.sourceUri),
    ['/p/gone.pdf']
  )
  assert.equal(diff.added.length + diff.changed.length, 0)
})

test('a missing document whose file is back and unchanged is restored', () => {
  const diff = diffFolder([file('/p/a.pdf', 100)], [doc('/p/a.pdf', 100, 'missing')])
  assert.deepEqual(
    diff.restored.map((d) => d.sourceUri),
    ['/p/a.pdf']
  )
  assert.equal(diff.changed.length, 0)
})

test('a missing document whose file is back but changed is re-indexed', () => {
  const diff = diffFolder([file('/p/a.pdf', 300)], [doc('/p/a.pdf', 100, 'missing')])
  assert.deepEqual(
    diff.changed.map((f) => f.path),
    ['/p/a.pdf']
  )
  assert.equal(diff.restored.length, 0)
})

test('added, changed and missing are computed together', () => {
  const diff = diffFolder(
    [file('/p/new.pdf', 10), file('/p/edited.pdf', 20), file('/p/same.pdf', 30)],
    [doc('/p/edited.pdf', 5), doc('/p/same.pdf', 30), doc('/p/deleted.pdf', 40)]
  )

  assert.deepEqual(
    diff.added.map((f) => f.path),
    ['/p/new.pdf']
  )
  assert.deepEqual(
    diff.changed.map((f) => f.path),
    ['/p/edited.pdf']
  )
  assert.deepEqual(
    diff.missing.map((d) => d.sourceUri),
    ['/p/deleted.pdf']
  )
})
