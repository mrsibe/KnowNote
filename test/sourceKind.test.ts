import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sourceKindOf, SOURCE_KIND_LABEL } from '../src/renderer/src/lib/sourceKind.ts'
import type { KnowledgeDocument } from '../src/shared/types/knowledge.ts'

/**
 * `sourceKindOf` decides which icon and which word a library row shows, and it
 * reads fields the ingestion path fills from several different loaders. That makes
 * it worth pinning: `mimeType` is nullable, paths are Windows or POSIX, and a
 * `url` is whatever the user pasted.
 */

const doc = (over: Partial<KnowledgeDocument> = {}): KnowledgeDocument =>
  ({
    id: 'd1',
    notebookId: 'n1',
    title: 'Untitled',
    type: 'file',
    sourceUri: null,
    localFilePath: null,
    mimeType: null,
    ...over
  }) as KnowledgeDocument

test('the type enum wins over the mime type for notes and pasted text', () => {
  assert.equal(sourceKindOf(doc({ type: 'note', mimeType: 'application/pdf' })), 'note')
  assert.equal(sourceKindOf(doc({ type: 'text', mimeType: 'application/pdf' })), 'text')
})

test('a file is read from its mime type first', () => {
  assert.equal(sourceKindOf(doc({ mimeType: 'application/pdf' })), 'pdf')
  assert.equal(sourceKindOf(doc({ mimeType: 'text/markdown' })), 'markdown')
  assert.equal(
    sourceKindOf(
      doc({
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      })
    ),
    'pptx'
  )
  assert.equal(
    sourceKindOf(
      doc({ mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    ),
    'docx'
  )
  assert.equal(sourceKindOf(doc({ mimeType: 'application/msword' })), 'docx')
  assert.equal(sourceKindOf(doc({ mimeType: 'application/vnd.ms-powerpoint' })), 'pptx')
})

test('a missing mime type falls back to the extension, in either path style', () => {
  assert.equal(sourceKindOf(doc({ localFilePath: '/tmp/paper.pdf' })), 'pdf')
  assert.equal(sourceKindOf(doc({ sourceUri: '/tmp/paper.pdf' })), 'pdf')
  assert.equal(sourceKindOf(doc({ localFilePath: 'C:\\Users\\me\\paper.PDF' })), 'pdf')
  assert.equal(sourceKindOf(doc({ localFilePath: '/tmp/notes.md' })), 'markdown')
  assert.equal(sourceKindOf(doc({ localFilePath: '/tmp/notes.markdown' })), 'markdown')
  assert.equal(sourceKindOf(doc({ localFilePath: '/tmp/deck.ppt' })), 'pptx')
  assert.equal(sourceKindOf(doc({ localFilePath: '/tmp/letter.doc' })), 'docx')
  assert.equal(sourceKindOf(doc({ localFilePath: '/tmp/plain.txt' })), 'text')
  assert.equal(sourceKindOf(doc({ localFilePath: '/tmp/page.html' })), 'web')
})

test('a local file path is preferred over the source uri when both are set', () => {
  assert.equal(
    sourceKindOf(doc({ localFilePath: '/tmp/copy.pdf', sourceUri: 'https://example.com/x' })),
    'pdf'
  )
})

test('an extensionless or unknown file is "file", not a guessed "text"', () => {
  assert.equal(sourceKindOf(doc({ localFilePath: '/tmp/README' })), 'file')
  assert.equal(sourceKindOf(doc({ localFilePath: '/tmp/data.parquet' })), 'file')
  assert.equal(sourceKindOf(doc()), 'file')
})

test('a file name is not mistaken for its directory, and a query is not the extension', () => {
  assert.equal(sourceKindOf(doc({ localFilePath: '/tmp/v1.2/report' })), 'file')
  assert.equal(sourceKindOf(doc({ localFilePath: '/tmp/report?download=.pdf' })), 'file')
})

test('a url is a youtube source only on a youtube host', () => {
  assert.equal(
    sourceKindOf(doc({ type: 'url', sourceUri: 'https://youtube.com/watch?v=1' })),
    'youtube'
  )
  assert.equal(
    sourceKindOf(doc({ type: 'url', sourceUri: 'https://www.youtube.com/watch?v=1' })),
    'youtube'
  )
  assert.equal(
    sourceKindOf(doc({ type: 'url', sourceUri: 'https://m.youtube.com/watch?v=1' })),
    'youtube'
  )
  assert.equal(sourceKindOf(doc({ type: 'url', sourceUri: 'https://youtu.be/abc123' })), 'youtube')
})

test('a lookalike host is not youtube', () => {
  assert.equal(sourceKindOf(doc({ type: 'url', sourceUri: 'https://notyoutube.com/x' })), 'web')
  assert.equal(
    sourceKindOf(doc({ type: 'url', sourceUri: 'https://youtube.com.evil.test/x' })),
    'web'
  )
  assert.equal(
    sourceKindOf(doc({ type: 'url', sourceUri: 'https://example.com/paper.pdf' })),
    'web'
  )
})

test('an unparseable or absent url is still a web source, never a video', () => {
  assert.equal(sourceKindOf(doc({ type: 'url', sourceUri: 'not a url' })), 'web')
  assert.equal(sourceKindOf(doc({ type: 'url' })), 'web')
})

test('every kind maps to a label key', () => {
  const kinds = [
    'pdf',
    'docx',
    'pptx',
    'markdown',
    'text',
    'file',
    'web',
    'youtube',
    'note'
  ] as const
  for (const kind of kinds) {
    assert.equal(typeof SOURCE_KIND_LABEL[kind], 'string')
    assert.ok(SOURCE_KIND_LABEL[kind].length > 0)
  }
})
