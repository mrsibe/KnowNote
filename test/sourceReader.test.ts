import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  blockAtPoint,
  blockContainingOffset,
  blockRect,
  blockById,
  resolveSelection
} from '../src/renderer/src/components/notebook/source/reader/anchor.ts'
import { DOCUMENT_SCHEME, documentUrl, parseDocumentUrl } from '../src/shared/utils/documentUrl.ts'
import type { SourceBlock } from '../src/shared/types/source.ts'

/**
 * The reader contract (#71) is what #72 (citation jump) and #73 (excerpt to note)
 * are built on, so the mapping from a DOM selection to a source location is pinned
 * here rather than left to a component that can only be checked by eye.
 */

const block = (over: Partial<SourceBlock> = {}): SourceBlock => ({
  id: 'b1',
  kind: 'paragraph',
  order: 0,
  page: 1,
  level: null,
  text: 'The quick brown fox',
  startOffset: 100,
  endOffset: 119,
  bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.05 },
  ...over
})

test('documentUrl round-trips through parseDocumentUrl', () => {
  const url = documentUrl('doc_123_abc')
  assert.equal(url, `${DOCUMENT_SCHEME}://docs/doc_123_abc`)
  assert.equal(parseDocumentUrl(url), 'doc_123_abc')
})

test('parseDocumentUrl rejects anything that is not a document URL', () => {
  for (const url of [
    'https://example.com/docs/x',
    'file:///etc/passwd',
    `${DOCUMENT_SCHEME}://docs/`,
    `${DOCUMENT_SCHEME}://docs/a/b`,
    `${DOCUMENT_SCHEME}://`,
    'not a url'
  ]) {
    assert.equal(parseDocumentUrl(url), null, url)
  }
})

test('blockContainingOffset finds the block whose span holds the offset', () => {
  const blocks = [block(), block({ id: 'b2', startOffset: 200, endOffset: 210 })]
  assert.equal(blockContainingOffset(blocks, 105)?.id, 'b1')
  assert.equal(blockContainingOffset(blocks, 205)?.id, 'b2')
  assert.equal(blockContainingOffset(blocks, 500), null)
})

test('blockAtPoint filters by page and picks the smallest containing block', () => {
  const blocks = [
    block({ id: 'outer', bbox: { x: 0, y: 0, w: 1, h: 1 } }),
    block({ id: 'inner', bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.03 } }),
    block({ id: 'other-page', page: 2, bbox: { x: 0, y: 0, w: 1, h: 1 } })
  ]

  assert.equal(blockAtPoint(blocks, 1, { x: 0.2, y: 0.21 })?.id, 'inner')
  assert.equal(blockAtPoint(blocks, 2, { x: 0.2, y: 0.21 })?.id, 'other-page')
  assert.equal(blockAtPoint(blocks, 1, { x: 0.9, y: 0.9 })?.id, 'outer')
  assert.equal(blockAtPoint(blocks, 3, { x: 0.2, y: 0.21 }), null)
})

test('resolveSelection returns a grounded anchor when the block is known', () => {
  const selection = resolveSelection('doc_1', 'quick brown', [block()], null, 105)

  assert.equal(selection?.documentId, 'doc_1')
  assert.equal(selection?.blockId, 'b1')
  assert.equal(selection?.page, 1)
  assert.equal(selection?.startOffset, 104)
  assert.equal(selection?.endOffset, 115)
})

test('resolveSelection locates a block from a normalized point', () => {
  const selection = resolveSelection(
    'doc_1',
    'quick brown',
    [block()],
    { page: 1, normalized: { x: 0.2, y: 0.21 } },
    null
  )
  assert.equal(selection?.blockId, 'b1')
})

test('resolveSelection keeps text without inventing offsets when nothing matches', () => {
  const selection = resolveSelection('doc_1', 'a phrase from nowhere', [], null, null)
  assert.equal(selection?.text, 'a phrase from nowhere')
  assert.equal(selection?.blockId, undefined)
  assert.equal(selection?.startOffset, undefined)
})

test('resolveSelection ignores a blank selection', () => {
  assert.equal(resolveSelection('doc_1', '   ', [block()], null, 100), null)
})

test('blockRect converts a normalized bbox into page pixels', () => {
  assert.deepEqual(blockRect(block(), 500, 800), {
    left: 50,
    top: 160,
    width: 250,
    height: 40
  })
  assert.equal(blockRect(block({ bbox: null }), 500, 800), null)
})

test('blockById is null-safe', () => {
  assert.equal(blockById([block()], 'b1')?.id, 'b1')
  assert.equal(blockById([block()], null), null)
  assert.equal(blockById([block()], 'missing'), null)
})
