import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  citedChunkIds,
  countCitedSources,
  parseAnswerSources,
  parseRetrievalSnapshot,
  parseRetrievalStatus,
  sourcesForDisplay
} from '../src/shared/utils/answerSources.ts'
import type { Citation } from '../src/shared/types/citation.ts'

/**
 * `chat_messages.metadata` is an open JSON bag written by whichever version of the
 * app produced the message, so these parsers are the only place that decides what
 * is usable. If they are wrong, the transcript either hides real evidence or
 * renders a broken one — and both look like a working screen.
 */

const source = (over: Record<string, unknown> = {}) => ({
  index: 1,
  documentId: 'doc_1',
  documentTitle: 'Beijing guide',
  chunkId: 'chunk_1',
  content: 'The Forbidden City opens at 08:30.',
  ...over
})

const citation = (chunkId: string, index = 1): Citation => ({
  index,
  documentId: 'doc_1',
  documentTitle: 'Beijing guide',
  chunkId,
  quote: 'a passage',
  score: 0.8
})

test('a well-formed source survives the round trip', () => {
  const parsed = parseAnswerSources({ sources: [source()] })
  assert.equal(parsed.length, 1)
  assert.deepEqual(parsed[0], {
    index: 1,
    documentId: 'doc_1',
    documentTitle: 'Beijing guide',
    documentType: undefined,
    chunkId: 'chunk_1',
    chunkIndex: undefined,
    content: 'The Forbidden City opens at 08:30.',
    score: undefined
  })
})

test('optional fields are kept when present and omitted when not', () => {
  const [parsed] = parseAnswerSources({
    sources: [source({ documentType: 'pdf', chunkIndex: 7, score: 0.83 })]
  })
  assert.equal(parsed.documentType, 'pdf')
  assert.equal(parsed.chunkIndex, 7)
  assert.equal(parsed.score, 0.83)
})

test('a source missing a field it cannot be rendered without is dropped', () => {
  for (const missing of ['documentId', 'documentTitle', 'chunkId', 'content']) {
    const broken = source()
    delete (broken as Record<string, unknown>)[missing]
    assert.deepEqual(parseAnswerSources({ sources: [broken] }), [], missing)
  }
})

test('empty strings count as missing, not as values', () => {
  assert.deepEqual(parseAnswerSources({ sources: [source({ content: '' })] }), [])
  assert.deepEqual(parseAnswerSources({ sources: [source({ documentTitle: '' })] }), [])
})

test('a malformed entry is dropped without discarding its siblings', () => {
  // Two usable sources out of three should still show the two: one bad row from an
  // older writer is not a reason to hide the evidence that did survive.
  const parsed = parseAnswerSources({
    sources: [source({ index: 1 }), { nope: true }, source({ index: 2, chunkId: 'chunk_2' })]
  })
  assert.equal(parsed.length, 2)
  assert.deepEqual(
    parsed.map((s) => s.chunkId),
    ['chunk_1', 'chunk_2']
  )
})

test('sources come back ordered by the index the prompt used', () => {
  const parsed = parseAnswerSources({
    sources: [
      source({ index: 3, chunkId: 'c3' }),
      source({ index: 1, chunkId: 'c1' }),
      source({ index: 2, chunkId: 'c2' })
    ]
  })
  assert.deepEqual(
    parsed.map((s) => s.index),
    [1, 2, 3]
  )
})

test('a non-numeric index degrades to 0 rather than dropping the source', () => {
  const [parsed] = parseAnswerSources({ sources: [source({ index: 'first' })] })
  assert.equal(parsed.index, 0)
})

test('metadata that is absent, null or the wrong shape yields no sources', () => {
  for (const metadata of [undefined, null, 'text', 42, {}, { sources: null }, { sources: 'x' }]) {
    assert.deepEqual(parseAnswerSources(metadata), [], JSON.stringify(metadata))
  }
})

test('retrieval status accepts exactly the three recorded values', () => {
  assert.equal(parseRetrievalStatus({ retrieval: 'used' }), 'used')
  assert.equal(parseRetrievalStatus({ retrieval: 'none' }), 'none')
  assert.equal(parseRetrievalStatus({ retrieval: 'failed' }), 'failed')
})

test('an unrecorded retrieval status is null, which is not the same as "none"', () => {
  // "We did not record it" is a statement about an old message; "none" is a
  // statement about the answer. Rendering the first as the second would accuse a
  // grounded answer of being ungrounded.
  for (const metadata of [undefined, null, {}, { retrieval: 'success' }, { retrieval: 1 }]) {
    assert.equal(parseRetrievalStatus(metadata), null, JSON.stringify(metadata))
  }
})

test('what to display per status', () => {
  const used = { retrieval: 'used', sources: [source()] }
  assert.equal(sourcesForDisplay(used).length, 1)

  // A failed search is reported as no evidence, never as a partial list: a
  // half-complete evidence set presented as the whole story is worse than none.
  assert.deepEqual(sourcesForDisplay({ retrieval: 'failed', sources: [source()] }), [])
  assert.deepEqual(sourcesForDisplay({ retrieval: 'none', sources: [] }), [])

  // Unknown status: show whatever sources exist, and let the UI decide (it renders
  // nothing when the status is unknown).
  assert.equal(sourcesForDisplay({ sources: [source()] }).length, 1)
  assert.deepEqual(sourcesForDisplay(undefined), [])
})

/**
 * Retrieval explainability (#157): the snapshot of how a turn retrieved. It is
 * read back from the DB, so it is parsed defensively — a message with no snapshot
 * is "not recorded", not "retrieved with default parameters".
 */

test('a retrieval snapshot round-trips', () => {
  const snapshot = parseRetrievalSnapshot({
    retrievalSnapshot: {
      strategy: 'dense',
      scope: { documentIds: ['doc_1', 'doc_2'] },
      topK: 8,
      threshold: 0.5,
      durationMs: 42.4
    }
  })

  assert.deepEqual(snapshot, {
    strategy: 'dense',
    scope: { documentIds: ['doc_1', 'doc_2'] },
    topK: 8,
    threshold: 0.5,
    durationMs: 42.4
  })
})

test('a snapshot without a scope means the whole notebook', () => {
  const snapshot = parseRetrievalSnapshot({
    retrievalSnapshot: { strategy: 'dense', scope: {}, topK: 5, durationMs: 3 }
  })

  assert.deepEqual(snapshot?.scope, {})
  assert.equal(snapshot?.threshold, undefined)
})

test('a snapshot that cannot be rendered is dropped, not guessed', () => {
  for (const bad of [
    undefined,
    null,
    {},
    { retrievalSnapshot: null },
    { retrievalSnapshot: {} },
    { retrievalSnapshot: { strategy: 'dense' } },
    { retrievalSnapshot: { topK: 5, durationMs: 1 } },
    { retrievalSnapshot: { strategy: '', topK: 5, durationMs: 1 } }
  ]) {
    assert.equal(parseRetrievalSnapshot(bad), null, JSON.stringify(bad))
  }
})

test('non-string document ids are dropped from the snapshot scope', () => {
  const snapshot = parseRetrievalSnapshot({
    retrievalSnapshot: {
      strategy: 'dense',
      scope: { documentIds: ['a', 2, 'b'] },
      topK: 5,
      durationMs: 1
    }
  })

  assert.deepEqual(snapshot?.scope.documentIds, ['a', 'b'])
})

test('cited passages are the ones the answer actually used', () => {
  const sources = [source(), source({ chunkId: 'chunk_2' }), source({ chunkId: 'chunk_3' })]
  const citations = [citation('chunk_1', 1), citation('chunk_3', 2)]

  assert.equal(countCitedSources(sources, citations), 2)
  assert.deepEqual([...citedChunkIds(citations)].sort(), ['chunk_1', 'chunk_3'])

  // A citation for a chunk that retrieval never returned must not make a source
  // look cited.
  assert.equal(countCitedSources(sources, [citation('chunk_missing', 9)]), 0)
  assert.equal(countCitedSources([], citations), 0)
})
