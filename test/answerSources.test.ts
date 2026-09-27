import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseAnswerSources,
  parseRetrievalStatus,
  sourcesForDisplay
} from '../src/shared/utils/answerSources.ts'

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
