import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  citationToSourceAnchor,
  sourceAnchorFromSearchParams,
  sourceAnchorToSearchParams,
  sourceAnchorsEqual,
  withSourceAnchor
} from '../src/shared/utils/sourceAnchor.ts'
import type { Citation } from '../src/shared/types/citation.ts'
import type { SourceAnchor } from '../src/shared/types/source.ts'

/**
 * #72 的引用跳转完全建立在 `SourceAnchor` 上：它既由 citation 快照构造，也由 URL
 * query 恢复。这里钉两件事 —— 快照到定位的映射，以及 URL 的往返与防御式解析。
 * 只要 `decode(encode(anchor)) === anchor` 成立，deep-link 的 reload 恢复就不会失真。
 */

const citation = (over: Partial<Citation> = {}): Citation => ({
  index: 1,
  documentId: 'doc_1',
  documentTitle: 'Attention Is All You Need',
  chunkId: 'chunk_1',
  quote: 'the retrieved passage',
  score: 0.87,
  ...over
})

const anchor = (location: SourceAnchor['location']): SourceAnchor => ({
  documentId: location.documentId,
  location
})

test('citationToSourceAnchor carries every location field the citation recorded', () => {
  const mapped = citationToSourceAnchor(
    citation({ page: 5, blockId: 'block_7', startOffset: 1832, endOffset: 1947 })
  )

  assert.deepEqual(mapped, {
    documentId: 'doc_1',
    location: {
      documentId: 'doc_1',
      page: 5,
      blockId: 'block_7',
      startOffset: 1832,
      endOffset: 1947
    }
  })
})

test('citationToSourceAnchor omits fields the citation never had', () => {
  const mapped = citationToSourceAnchor(citation({ page: 3 }))

  assert.deepEqual(mapped.location, { documentId: 'doc_1', page: 3 })
  assert.equal('blockId' in mapped.location, false)
  assert.equal('startOffset' in mapped.location, false)
})

test('a full anchor round-trips through the URL', () => {
  const original = anchor({
    documentId: 'doc_1',
    page: 5,
    blockId: 'block_7',
    startOffset: 1832,
    endOffset: 1947
  })

  const restored = sourceAnchorFromSearchParams(sourceAnchorToSearchParams(original))
  assert.deepEqual(restored, original)
})

test('a document-only anchor round-trips through the URL', () => {
  const original = anchor({ documentId: 'doc_1' })
  const restored = sourceAnchorFromSearchParams(sourceAnchorToSearchParams(original))
  assert.deepEqual(restored, original)
})

test('the URL encodes an offset anchor without a page, and restores it', () => {
  const original = citationToSourceAnchor(citation({ startOffset: 40, endOffset: 60 }))
  const params = sourceAnchorToSearchParams(original)

  assert.equal(params.get('doc'), 'doc_1')
  assert.equal(params.get('page'), null)
  assert.deepEqual(sourceAnchorFromSearchParams(params), original)
})

test('sourceAnchorFromSearchParams returns null without a document id', () => {
  assert.equal(sourceAnchorFromSearchParams(new URLSearchParams('page=5')), null)
  assert.equal(sourceAnchorFromSearchParams(new URLSearchParams('')), null)
})

test('malformed numbers are dropped field by field, not as a whole', () => {
  const fromBadPage = sourceAnchorFromSearchParams(
    new URLSearchParams('doc=doc_1&page=abc&start=100&end=200')
  )
  assert.deepEqual(fromBadPage, anchor({ documentId: 'doc_1', startOffset: 100, endOffset: 200 }))

  const fromNegativePage = sourceAnchorFromSearchParams(
    new URLSearchParams('doc=doc_1&page=-1&block=block_1')
  )
  assert.deepEqual(fromNegativePage, anchor({ documentId: 'doc_1', blockId: 'block_1' }))

  const fromFloat = sourceAnchorFromSearchParams(new URLSearchParams('doc=doc_1&page=1.5'))
  assert.deepEqual(fromFloat, anchor({ documentId: 'doc_1' }))
})

test('an end before its start is dropped while the start survives', () => {
  const parsed = sourceAnchorFromSearchParams(new URLSearchParams('doc=doc_1&start=200&end=100'))
  assert.deepEqual(parsed, anchor({ documentId: 'doc_1', startOffset: 200 }))
})

test('an end without a start is dropped', () => {
  const parsed = sourceAnchorFromSearchParams(new URLSearchParams('doc=doc_1&end=100'))
  assert.deepEqual(parsed, anchor({ documentId: 'doc_1' }))
})

test('withSourceAnchor preserves unrelated query parameters', () => {
  const params = new URLSearchParams('tab=chat&doc=old&page=1')
  const next = withSourceAnchor(params, anchor({ documentId: 'doc_2', page: 7 }))

  assert.equal(next.get('tab'), 'chat')
  assert.equal(next.get('doc'), 'doc_2')
  assert.equal(next.get('page'), '7')
})

test('withSourceAnchor(null) removes only the source keys', () => {
  const params = new URLSearchParams('tab=chat&doc=doc_1&page=5&start=1&end=2&block=b1')
  const next = withSourceAnchor(params, null)

  assert.equal(next.get('tab'), 'chat')
  for (const key of ['doc', 'page', 'start', 'end', 'block']) {
    assert.equal(next.get(key), null, key)
  }
})

test('sourceAnchorsEqual compares the whole location, not just the document', () => {
  const base = anchor({ documentId: 'doc_1', page: 5 })

  assert.equal(sourceAnchorsEqual(base, anchor({ documentId: 'doc_1', page: 5 })), true)
  assert.equal(sourceAnchorsEqual(base, anchor({ documentId: 'doc_1', page: 6 })), false)
  assert.equal(sourceAnchorsEqual(base, anchor({ documentId: 'doc_2', page: 5 })), false)
  assert.equal(sourceAnchorsEqual(base, null), false)
  assert.equal(sourceAnchorsEqual(null, null), true)
})
