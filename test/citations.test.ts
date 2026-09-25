import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCitations,
  buildRAGContext,
  citationFromSearchResult
} from '../src/main/services/citations.ts'
import { citationDocumentExists, parseCitations } from '../src/shared/utils/citations.ts'
import type { SearchResult } from '../src/main/services/KnowledgeService.ts'

/**
 * A citation is the link between a claim in an answer and the place in the source
 * that supports it (#69). It is assembled from the retriever's locator — never by
 * querying the database again — and read back defensively, because the metadata
 * column is written by whichever version of the app produced the message.
 */

const searchResult = (over: Partial<SearchResult> = {}): SearchResult => ({
  chunkId: 'chunk_1',
  documentId: 'doc_1',
  documentTitle: 'Attention Is All You Need',
  documentType: 'file',
  content: 'the retrieved passage',
  score: 0.87,
  chunkIndex: 4,
  locator: {
    pageStart: 5,
    pageEnd: 5,
    blocks: [
      {
        blockId: 'blk_doc_1_7',
        kind: 'paragraph',
        level: null,
        page: 5,
        bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.05 },
        text: 'the retrieved passage',
        startOffset: 100,
        endOffset: 121,
        startInBlock: 0,
        endInBlock: 21
      }
    ]
  },
  ...over
})

test('a citation carries the page, block and char span of the retrieved chunk', () => {
  const citation = citationFromSearchResult(searchResult(), 2)

  assert.deepEqual(citation, {
    index: 2,
    documentId: 'doc_1',
    documentTitle: 'Attention Is All You Need',
    documentType: 'file',
    page: 5,
    pageEnd: 5,
    blockId: 'blk_doc_1_7',
    chunkId: 'chunk_1',
    startOffset: 100,
    endOffset: 121,
    quote: 'the retrieved passage',
    score: 0.87
  })
})

test('a chunk that starts mid-block keeps the exact span, not the block bounds', () => {
  const citation = citationFromSearchResult(
    searchResult({
      locator: {
        pageStart: 3,
        pageEnd: 3,
        blocks: [
          {
            blockId: 'b1',
            kind: 'paragraph',
            level: null,
            page: 3,
            bbox: null,
            text: 'aaaaaaaaaaaaaaaaaaaa',
            startOffset: 50,
            endOffset: 70,
            startInBlock: 5,
            endInBlock: 12
          }
        ]
      }
    }),
    1
  )

  assert.equal(citation.startOffset, 55)
  assert.equal(citation.endOffset, 62)
})

test('a chunk spanning several blocks anchors on the first and spans to the last', () => {
  const citation = citationFromSearchResult(
    searchResult({
      locator: {
        pageStart: 5,
        pageEnd: 6,
        blocks: [
          {
            blockId: 'b1',
            kind: 'paragraph',
            level: null,
            page: 5,
            bbox: null,
            text: 'first',
            startOffset: 100,
            endOffset: 105,
            startInBlock: 0,
            endInBlock: 5
          },
          {
            blockId: 'b2',
            kind: 'paragraph',
            level: null,
            page: 6,
            bbox: null,
            text: 'second',
            startOffset: 200,
            endOffset: 206,
            startInBlock: 0,
            endInBlock: 6
          }
        ]
      }
    }),
    1
  )

  assert.equal(citation.blockId, 'b1')
  assert.equal(citation.startOffset, 100)
  assert.equal(citation.endOffset, 206)
  assert.equal(citation.page, 5)
  assert.equal(citation.pageEnd, 6)
})

test('an unpaginated source produces a citation without page or block fields', () => {
  const citation = citationFromSearchResult(
    searchResult({ locator: { pageStart: null, pageEnd: null, blocks: [] } }),
    1
  )

  assert.equal(citation.page, undefined)
  assert.equal(citation.pageEnd, undefined)
  assert.equal(citation.blockId, undefined)
  assert.equal(citation.startOffset, undefined)
  assert.equal(citation.endOffset, undefined)
})

test('citations are numbered by their position in the prompt', () => {
  const citations = buildCitations([searchResult(), searchResult({ chunkId: 'chunk_2' })])
  assert.deepEqual(
    citations.map((citation) => citation.index),
    [1, 2]
  )
  assert.deepEqual(
    citations.map((citation) => citation.chunkId),
    ['chunk_1', 'chunk_2']
  )
})

test('an answer without retrieval produces no citations', () => {
  const { context, sources, citations } = buildRAGContext([])
  assert.equal(context, '')
  assert.deepEqual(sources, [])
  assert.deepEqual(citations, [])
})

test('the prompt asks the model to mark sources so a claim can be resolved', () => {
  const { context, sources, citations } = buildRAGContext([searchResult()])

  assert.match(context, /\[来源 1: Attention Is All You Need\]/)
  assert.match(context, /\[n\]/)
  assert.equal(sources.length, 1)
  assert.equal(citations.length, 1)
  assert.equal(citations[0].score, 0.87)
})

/**
 * The reader half. A citation is a snapshot: it must still parse after the source
 * document has been deleted or re-indexed, and one bad row must not hide the good
 * ones.
 */

test('a citation survives a metadata round trip', () => {
  const [citation] = parseCitations({
    citations: [citationFromSearchResult(searchResult(), 1)]
  })

  assert.equal(citation.documentId, 'doc_1')
  assert.equal(citation.page, 5)
  assert.equal(citation.blockId, 'blk_doc_1_7')
  assert.equal(citation.startOffset, 100)
  assert.equal(citation.endOffset, 121)
})

test('a citation whose document no longer exists still parses', () => {
  // Deleting the document does not rewrite history: the answer was grounded when
  // it was written. The UI disables the jump; the parser keeps the record.
  const [citation] = parseCitations({
    citations: [citationFromSearchResult(searchResult(), 1)]
  })
  assert.equal(citation.documentTitle, 'Attention Is All You Need')
})

test('a citation missing a field it cannot resolve without is dropped', () => {
  for (const missing of ['documentId', 'documentTitle', 'chunkId', 'quote']) {
    const broken = citationFromSearchResult(searchResult(), 1) as unknown as Record<string, unknown>
    delete broken[missing]
    assert.deepEqual(parseCitations({ citations: [broken] }), [], missing)
  }
})

test('a malformed citation is dropped without discarding its siblings', () => {
  const parsed = parseCitations({
    citations: [
      citationFromSearchResult(searchResult(), 1),
      { nope: true },
      citationFromSearchResult(searchResult({ chunkId: 'chunk_2' }), 2)
    ]
  })
  assert.equal(parsed.length, 2)
  assert.deepEqual(
    parsed.map((citation) => citation.chunkId),
    ['chunk_1', 'chunk_2']
  )
})

test('citations come back ordered by the marker the prompt used', () => {
  const parsed = parseCitations({
    citations: [
      citationFromSearchResult(searchResult({ chunkId: 'c3' }), 3),
      citationFromSearchResult(searchResult({ chunkId: 'c1' }), 1),
      citationFromSearchResult(searchResult({ chunkId: 'c2' }), 2)
    ]
  })
  assert.deepEqual(
    parsed.map((citation) => citation.index),
    [1, 2, 3]
  )
})

test('metadata that is absent, null or the wrong shape yields no citations', () => {
  for (const metadata of [
    undefined,
    null,
    'text',
    42,
    {},
    { citations: null },
    { citations: 'x' }
  ]) {
    assert.deepEqual(parseCitations(metadata), [], JSON.stringify(metadata))
  }
})

/**
 * 「来源已删除 → chip disabled」只有在读过列表之后才能成立。
 *
 * 空的列表有两个含义：还没加载（不知道）和确实一个都没有（读过了）。
 * 把前者当成删除会把冷启动时所有历史 citation 都误判成失效引用。
 */
test('a citation source is presumed present until the list has been read', () => {
  assert.equal(citationDocumentExists([], false, 'doc_1'), true)
  assert.equal(citationDocumentExists([{ id: 'other' }], false, 'doc_1'), true)
})

test('after a successful load, only a listed document exists', () => {
  assert.equal(citationDocumentExists([{ id: 'doc_1' }], true, 'doc_1'), true)
  assert.equal(citationDocumentExists([{ id: 'other' }], true, 'doc_1'), false)
})

test('a loaded empty list means every citation source is gone', () => {
  assert.equal(citationDocumentExists([], true, 'doc_1'), false)
})

test('a failed load is not evidence that the source was deleted', () => {
  // loadDocuments() 失败时保持 documentsLoaded:false，而不是把失败当成空列表。
  assert.equal(citationDocumentExists([], false, 'doc_1'), true)
})
