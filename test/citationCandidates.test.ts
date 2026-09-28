import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCitationCandidates,
  groupCandidateRanges,
  splitSentences,
  type CitationCandidateSource
} from '../src/main/services/citationCandidates.ts'
import type { EvidenceBlock } from '../src/main/services/retrieval/types.ts'

/**
 * `buildCitationCandidates()` (#155) turns a retrieved chunk into the verbatim spans
 * the model will cite. Two properties matter and are pinned here:
 *
 * - a candidate's quote is a **verbatim slice** of `documents.content` at its
 *   offsets, because that is exactly what the reader highlights;
 * - candidates are sentence-sized, but not so small that a claim spanning two
 *   sentences cannot be cited.
 */

const block = (
  text: string,
  startOffset: number,
  over: Partial<EvidenceBlock> = {}
): EvidenceBlock => ({
  blockId: `blk_${startOffset}`,
  kind: 'paragraph',
  level: null,
  page: 1,
  bbox: null,
  text,
  startOffset,
  endOffset: startOffset + text.length,
  startInBlock: 0,
  endInBlock: text.length,
  ...over
})

const source = (over: Partial<CitationCandidateSource> = {}): CitationCandidateSource => ({
  chunkId: 'chunk_1',
  documentId: 'doc_1',
  locator: { pageStart: 1, pageEnd: 1, blocks: [block('the retrieved passage', 0)] },
  content: 'the retrieved passage',
  ...over
})

const quotes = (text: string): string[] =>
  splitSentences(text).map((range) => text.slice(range.start, range.end))

test('sentences are split on terminators, Latin and CJK alike', () => {
  assert.deepEqual(quotes('First sentence. Second sentence.'), [
    'First sentence.',
    'Second sentence.'
  ])
  assert.deepEqual(quotes('第一句。第二句！第三句？'), ['第一句。', '第二句！', '第三句？'])
})

test('a decimal point and an abbreviation do not end a sentence', () => {
  assert.deepEqual(quotes('The value is 3.14 and it matters.'), [
    'The value is 3.14 and it matters.'
  ])
  assert.deepEqual(quotes('See Fig. 3 for details. Then continue.'), [
    'See Fig. 3 for details.',
    'Then continue.'
  ])
  assert.deepEqual(quotes('U.S. policy changed.'), ['U.S. policy changed.'])
})

test('short neighbouring sentences merge so a two-sentence claim is citable', () => {
  const text = 'A causes B. So the result is C.'
  const groups = groupCandidateRanges(text)

  assert.equal(groups.length, 1)
  assert.equal(text.slice(groups[0].start, groups[0].end), text)
})

test('a long sentence stands alone, and grouping stops at three sentences', () => {
  const long = `${'x'.repeat(120)}.`
  assert.equal(groupCandidateRanges(long).length, 1)

  const six = Array.from({ length: 6 }, () => `${'y'.repeat(29)}.`).join(' ')
  assert.equal(groupCandidateRanges(six).length, 2)
})

test('a chunk that starts mid-block keeps the exact span, not the block bounds', () => {
  const [candidate] = buildCitationCandidates([
    source({
      locator: {
        pageStart: 3,
        pageEnd: 3,
        blocks: [
          block('aaaaaaaaaaaaaaaaaaaa', 50, {
            blockId: 'b1',
            page: 3,
            startInBlock: 5,
            endInBlock: 12
          })
        ]
      }
    })
  ])

  assert.equal(candidate.index, 1)
  assert.equal(candidate.quote, 'aaaaaaa')
  assert.equal(candidate.startOffset, 55)
  assert.equal(candidate.endOffset, 62)
  assert.equal(candidate.blockId, 'b1')
  assert.equal(candidate.page, 3)
})

test('a candidate quote is a verbatim slice of the source at its offsets', () => {
  const text = 'First sentence. Second sentence.'
  const content = `${'P'.repeat(100)}${text}`

  const candidates = buildCitationCandidates([
    source({ content, locator: { pageStart: 1, pageEnd: 1, blocks: [block(text, 100)] } })
  ])

  assert.ok(candidates.length > 0)
  for (const candidate of candidates) {
    assert.equal(
      content.slice(candidate.startOffset as number, candidate.endOffset as number),
      candidate.quote
    )
  }
})

test('candidates are numbered continuously across chunks, from startIndex', () => {
  const first = source({ chunkId: 'c1', content: 'first block text' })
  const second = source({
    chunkId: 'c2',
    content: 'second block text',
    locator: {
      pageStart: 2,
      pageEnd: 2,
      blocks: [block('second block text', 300, { blockId: 'b2', page: 2 })]
    }
  })

  const candidates = buildCitationCandidates([first, second])
  assert.deepEqual(
    candidates.map((candidate) => candidate.index),
    [1, 2]
  )
  assert.deepEqual(
    candidates.map((candidate) => candidate.chunkId),
    ['c1', 'c2']
  )

  const offset = buildCitationCandidates([first], 5)
  assert.equal(offset[0].index, 5)
})

test('a source with no blocks falls back to the whole chunk, with no span', () => {
  const [candidate] = buildCitationCandidates([
    source({
      content: '  whole chunk text  ',
      locator: { pageStart: null, pageEnd: null, blocks: [] }
    })
  ])

  assert.equal(candidate.quote, 'whole chunk text')
  assert.equal(candidate.startOffset, undefined)
  assert.equal(candidate.endOffset, undefined)
  assert.equal(candidate.blockId, undefined)
  assert.equal(candidate.page, undefined)
})
