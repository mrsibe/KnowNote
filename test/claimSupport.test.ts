import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyClaimSupport } from '../src/shared/utils/claimSupport.ts'
import type { Citation } from '../src/shared/types/citation.ts'

/**
 * Citation coverage (#156) measures one deterministic thing: does a sentence carry
 * a citation that resolves to a real span. It must not pretend to know whether the
 * citation *proves* the sentence — that is NLI, not a rule.
 *
 * The four statuses are exhaustive, so the counts must always add up:
 * `statements === cited + uncited + invalid`, with `inference` outside them.
 */

const citation = (index: number): Citation => ({
  index,
  documentId: 'doc_1',
  documentTitle: 'Attention Is All You Need',
  chunkId: 'chunk_1',
  quote: 'a passage',
  score: 0.8
})

test('a sentence with a resolvable marker counts as cited', () => {
  const report = classifyClaimSupport('A is true [1]. B is true [2].', [citation(1), citation(2)])

  assert.equal(report.cited, 2)
  assert.equal(report.uncited, 0)
  assert.equal(report.invalid, 0)
  assert.equal(report.statements, 2)
  assert.equal(report.coverage, 1)
  assert.equal(report.unsupportedRate, 0)
})

test('a prose sentence with no marker counts as uncited', () => {
  const report = classifyClaimSupport('A is true [1]. B is also true.', [citation(1)])

  assert.equal(report.cited, 1)
  assert.equal(report.uncited, 1)
  assert.equal(report.statements, 2)
  assert.equal(report.coverage, 0.5)
  assert.equal(report.unsupportedRate, 0.5)
  assert.deepEqual(
    report.sentences.map((sentence) => sentence.status),
    ['cited', 'uncited']
  )
})

test('a marker that resolves to nothing is an invalid citation', () => {
  const report = classifyClaimSupport('A is true [9].', [citation(1)])

  assert.equal(report.invalid, 1)
  assert.equal(report.cited, 0)
  assert.equal(report.statements, 1)
  assert.equal(report.coverage, 0)
  assert.equal(report.invalidRate, 1)
})

test('one invalid marker makes the sentence invalid even beside a good one', () => {
  const report = classifyClaimSupport('A is true [1][9].', [citation(1)])

  assert.equal(report.invalid, 1)
  assert.equal(report.cited, 0)
  assert.equal(report.statements, 1)
})

test('an explicitly marked inference is not an uncited statement', () => {
  const report = classifyClaimSupport('A is true [1]. I suspect B. [inference]', [citation(1)])

  assert.equal(report.cited, 1)
  assert.equal(report.inference, 1)
  assert.equal(report.uncited, 0)
  // Inference is outside the factual denominator: coverage is still 1.
  assert.equal(report.statements, 1)
  assert.equal(report.coverage, 1)
})

test('headings and fenced code are not statements', () => {
  const answer = '# Summary\n\nA is true [1].\n\n```\nconst x = 1\n```\n'
  const report = classifyClaimSupport(answer, [citation(1)])

  assert.equal(report.statements, 1)
  assert.equal(report.cited, 1)
})

test('a marker written after the sentence period still belongs to that sentence', () => {
  const report = classifyClaimSupport('A is true. [1]', [citation(1)])

  assert.equal(report.cited, 1)
  assert.equal(report.uncited, 0)
  assert.equal(report.statements, 1)
})

test('an inference marker after the period attaches to the sentence', () => {
  const report = classifyClaimSupport('I suspect B. [inference]', [citation(1)])

  assert.equal(report.inference, 1)
  assert.equal(report.uncited, 0)
  assert.equal(report.statements, 0)
})

test('a four-digit bracket is a year, not a citation marker', () => {
  const report = classifyClaimSupport('In 2024 [2024] something happened.', [])

  assert.equal(report.cited, 0)
  assert.equal(report.invalid, 0)
  assert.equal(report.uncited, 1)
})

test('an answer with no statements has full coverage rather than zero', () => {
  const report = classifyClaimSupport('', [])

  assert.equal(report.statements, 0)
  assert.equal(report.coverage, 1)
  assert.equal(report.unsupportedRate, 0)
  assert.equal(report.invalidRate, 0)
  assert.deepEqual(report.sentences, [])
})

test('counts stay consistent with the per-sentence statuses', () => {
  const answer = 'A is true [1]. B is stated plainly. C is false [9]. D follows. [inference]'
  const report = classifyClaimSupport(answer, [citation(1)])

  const statuses = report.sentences.map((sentence) => sentence.status)
  assert.deepEqual(statuses, ['cited', 'uncited', 'invalid-citation', 'inference'])

  const counted = statuses.filter((status) => status !== 'inference').length
  assert.equal(report.statements, counted)
  assert.equal(report.statements, report.cited + report.uncited + report.invalid)
})
