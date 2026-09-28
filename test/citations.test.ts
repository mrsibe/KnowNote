import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRAGContext, citationFromCandidate } from '../src/main/services/citations.ts'
import { parseCitations, sourceDocumentExists } from '../src/shared/utils/citations.ts'
import type { SearchResult } from '../src/main/services/KnowledgeService.ts'
import type { EvidenceBlock } from '../src/main/services/retrieval/types.ts'

/**
 * A citation is the link between a claim in an answer and the place in the source
 * that supports it (#69, #155). Since #155 that place is a **candidate span** — a
 * sentence-sized piece of a retrieved chunk — not the chunk itself.
 *
 * The reader half is unchanged: a citation is still a snapshot, it must still parse
 * after the source is deleted or re-indexed, and one bad row must not hide the good
 * ones.
 */

const block = (
  text: string,
  startOffset: number,
  over: Partial<EvidenceBlock> = {}
): EvidenceBlock => ({
  blockId: `blk_${startOffset}`,
  kind: 'paragraph',
  level: null,
  page: 5,
  bbox: null,
  text,
  startOffset,
  endOffset: startOffset + text.length,
  startInBlock: 0,
  endInBlock: text.length,
  ...over
})

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
    blocks: [block('the retrieved passage', 100, { blockId: 'blk_doc_1_7' })]
  },
  ...over
})

test('a citation points at a candidate span, not the whole chunk', () => {
  const { citations } = buildRAGContext([searchResult()])

  assert.equal(citations.length, 1)
  assert.deepEqual(citations[0], {
    index: 1,
    documentId: 'doc_1',
    documentTitle: 'Attention Is All You Need',
    documentType: 'file',
    page: 5,
    blockId: 'blk_doc_1_7',
    chunkId: 'chunk_1',
    startOffset: 100,
    endOffset: 121,
    quote: 'the retrieved passage',
    score: 0.87
  })
})

test('citation candidates are numbered continuously across chunks', () => {
  const first = searchResult({ chunkId: 'c1' })
  const second = searchResult({
    chunkId: 'c2',
    documentTitle: 'GPT-2',
    locator: {
      pageStart: 3,
      pageEnd: 3,
      blocks: [block('a second passage', 200, { blockId: 'b2', page: 3 })]
    }
  })

  const { citations, context } = buildRAGContext([first, second])

  assert.deepEqual(
    citations.map((citation) => citation.index),
    [1, 2]
  )
  assert.match(context, /\[来源: GPT-2 — p\.3\]/)
})

test('the prompt groups by source but keeps the marker global', () => {
  const { context, sources, citations } = buildRAGContext([searchResult()])

  assert.match(context, /\[来源: Attention Is All You Need — p\.5\]/)
  assert.match(context, /\[1\] the retrieved passage/)
  assert.match(context, /\[n\]/)
  assert.equal(sources.length, 1)
  assert.equal(sources[0].chunkId, 'chunk_1')
  assert.equal(citations.length, 1)
  assert.equal(citations[0].score, 0.87)
})

test('the citation context carries the candidate span as its quote', () => {
  const { citationContexts } = buildRAGContext([searchResult()])

  assert.equal(citationContexts.length, 1)
  assert.equal(citationContexts[0].spanText, 'the retrieved passage')
  assert.equal(citationContexts[0].citation.quote, 'the retrieved passage')
})

test('an answer without retrieval produces no citations', () => {
  const { context, sources, citations, citationContexts } = buildRAGContext([])
  assert.equal(context, '')
  assert.deepEqual(sources, [])
  assert.deepEqual(citations, [])
  assert.deepEqual(citationContexts, [])
})

test('a candidate with no block or span still becomes a citation with no location', () => {
  const citation = citationFromCandidate(
    { index: 7, documentId: 'doc_1', chunkId: 'chunk_1', quote: 'legacy chunk text' },
    searchResult()
  )

  assert.equal(citation.index, 7)
  assert.equal(citation.quote, 'legacy chunk text')
  assert.equal(citation.page, undefined)
  assert.equal(citation.blockId, undefined)
  assert.equal(citation.startOffset, undefined)
  assert.equal(citation.endOffset, undefined)
})

/**
 * The reader half.
 */

test('a citation survives a metadata round trip', () => {
  const [citation] = buildRAGContext([searchResult()]).citations
  const [parsed] = parseCitations({ citations: [citation] })

  assert.equal(parsed.documentId, 'doc_1')
  assert.equal(parsed.page, 5)
  assert.equal(parsed.blockId, 'blk_doc_1_7')
  assert.equal(parsed.startOffset, 100)
  assert.equal(parsed.endOffset, 121)
})

test('a citation whose document no longer exists still parses', () => {
  const [citation] = buildRAGContext([searchResult()]).citations
  const [parsed] = parseCitations({ citations: [citation] })
  assert.equal(parsed.documentTitle, 'Attention Is All You Need')
})

test('a citation missing a field it cannot resolve without is dropped', () => {
  const [citation] = buildRAGContext([searchResult()]).citations

  for (const missing of ['documentId', 'documentTitle', 'chunkId', 'quote']) {
    const broken = { ...citation } as Record<string, unknown>
    delete broken[missing]
    assert.deepEqual(parseCitations({ citations: [broken] }), [], missing)
  }
})

test('a malformed citation is dropped without discarding its siblings', () => {
  const { citations } = buildRAGContext([searchResult(), searchResult({ chunkId: 'chunk_2' })])

  const parsed = parseCitations({ citations: [citations[0], { nope: true }, citations[1]] })
  assert.equal(parsed.length, 2)
  assert.deepEqual(
    parsed.map((citation) => citation.chunkId),
    ['chunk_1', 'chunk_2']
  )
})

test('citations come back ordered by the marker the prompt used', () => {
  const [first, second, third] = buildRAGContext([
    searchResult({ chunkId: 'c1' }),
    searchResult({ chunkId: 'c2' }),
    searchResult({ chunkId: 'c3' })
  ]).citations

  const [c1, c2, c3] = [{ ...third }, { ...first }, { ...second }]

  const parsed = parseCitations({ citations: [c3, c1, c2] })
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
  assert.equal(sourceDocumentExists([], false, 'doc_1'), true)
  assert.equal(sourceDocumentExists([{ id: 'other' }], false, 'doc_1'), true)
})

test('after a successful load, only a listed document exists', () => {
  assert.equal(sourceDocumentExists([{ id: 'doc_1' }], true, 'doc_1'), true)
  assert.equal(sourceDocumentExists([{ id: 'other' }], true, 'doc_1'), false)
})

test('a loaded empty list means every citation source is gone', () => {
  assert.equal(sourceDocumentExists([], true, 'doc_1'), false)
})

test('a failed load is not evidence that the source was deleted', () => {
  // loadDocuments() 失败时保持 documentsLoaded:false，而不是把失败当成空列表。
  assert.equal(sourceDocumentExists([], false, 'doc_1'), true)
})
