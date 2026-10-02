import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { KnowledgeSchemas } from '../src/main/ipc/validation'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('library reuse IPC validates identities and requires explicit permanent-delete confirmation', () => {
  assert.equal(
    KnowledgeSchemas.attachLibrarySource.safeParse({ notebookId: 'nb', sourceId: 'src' }).success,
    true
  )
  for (const args of [
    { notebookId: '', sourceId: 'src' },
    { notebookId: 'nb', sourceId: '' }
  ]) {
    assert.equal(KnowledgeSchemas.attachLibrarySource.safeParse(args).success, false)
  }
  for (const confirmed of [undefined, false, 'true']) {
    assert.equal(
      KnowledgeSchemas.deleteLibrarySource.safeParse({ sourceId: 'src', confirmed }).success,
      false
    )
  }
  assert.equal(
    KnowledgeSchemas.deleteLibrarySource.safeParse({ sourceId: 'src', confirmed: true }).success,
    true
  )
})

test('library picker only offers permanent deletion for unused sources and never auto-reindexes', () => {
  const picker = read('src/renderer/src/components/notebook/source/LibrarySourceDialog.tsx')
  assert.match(picker, /disabled=\{busy \|\| !source\.hasContent\}/)
  assert.match(picker, /source\.membershipCount === 0/)
  assert.match(picker, /deleteLibrarySource\(deleting\.id, true\)/)
  assert.match(picker, /ConfirmActionDialog/)
  assert.doesNotMatch(picker, /knowledge\.(?:reindexDocument|retryDocument|addDocument)/)
  const list = read('src/renderer/src/components/notebook/source/DocumentList.tsx')
  assert.match(list, /document\.status === 'indexed' \|\| document\.status === 'pending'/)
  assert.match(list, /libraryIndexRequired/)
})

test('library reuse and removal strings exist in both locales', () => {
  const en = JSON.parse(read('src/renderer/src/locales/en-US/ui.json'))
  const zh = JSON.parse(read('src/renderer/src/locales/zh-CN/ui.json'))
  for (const key of Object.keys(en)
    .filter((key) => key.startsWith('library'))
    .concat([
      'fromLibrary',
      'fromLibraryDesc',
      'removeSource',
      'deleteLibrarySource',
      'confirmDeleteLibrarySource'
    ])) {
    assert.equal(typeof en[key], 'string', key)
    assert.equal(typeof zh[key], 'string', key)
  }
  assert.match(en.confirmDeleteDocument, /other notebooks will be kept/)
})
