import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeForComparison, resolveCitations } from '../src/shared/utils/citationResolution.ts'
import type { Citation, CitationContext } from '../src/shared/types/citation.ts'

/**
 * An answer asked to mark its sources with `[n]` can mark a source that was never
 * retrieved, or attribute a passage to the wrong span (#70). Neither may render as
 * a clickable source. Resolution is pure and deterministic so citation precision
 * is computable for the eval harness (#75).
 */

const citation = (over: Partial<Citation> = {}): Citation => ({
  index: 1,
  documentId: 'doc_1',
  documentTitle: 'Attention Is All You Need',
  chunkId: 'chunk_1',
  quote: 'the attention mechanism',
  score: 0.87,
  ...over
})

const context = (over: Partial<CitationContext> = {}): CitationContext => ({
  citation: citation(),
  spanText: 'The attention mechanism is central to the transformer.',
  ...over
})

test('a grounded marker resolves to its citation', () => {
  const resolution = resolveCitations('The mechanism is central [1].', [context()])

  assert.equal(resolution.resolved.length, 1)
  assert.equal(resolution.unresolved.length, 0)
  assert.equal(resolution.misattributed.length, 0)
  assert.equal(resolution.resolved[0].marker, 1)
  assert.equal(resolution.resolved[0].citation?.documentTitle, 'Attention Is All You Need')
  assert.equal(resolution.precision, 1)
})

test('a fabricated marker with no context is unresolved, never clickable', () => {
  const resolution = resolveCitations('A claim with a made-up source [9].', [context()])

  assert.equal(resolution.resolved.length, 0)
  assert.equal(resolution.unresolved.length, 1)
  assert.equal(resolution.unresolved[0].marker, 9)
  assert.equal(resolution.misattributed.length, 0)
  assert.equal(resolution.precision, 0)
})

test('a marker whose span does not contain the claimed quote is flagged, not resolved', () => {
  const wrongSpan: CitationContext = {
    citation: citation({ index: 2, quote: 'a passage about attention' }),
    spanText: 'an unrelated sentence about tokenisation'
  }
  const resolution = resolveCitations('Something [2].', [context(), wrongSpan])

  assert.equal(resolution.resolved.length, 0)
  assert.equal(resolution.misattributed.length, 1)
  assert.equal(resolution.misattributed[0].marker, 2)
  assert.equal(resolution.misattributed[0].citation?.chunkId, 'chunk_1')
})

test('validation is case- and whitespace-insensitive but nothing beyond that', () => {
  const loose: CitationContext = {
    citation: citation({ quote: 'THE   Attention\n Mechanism' }),
    spanText: 'the attention mechanism is central'
  }
  assert.equal(resolveCitations('x [1]', [loose]).resolved.length, 1)

  // "roughly matching" is exactly the failure this guards against: one changed
  // word is a different claim, so it must not resolve.
  const fuzzy: CitationContext = {
    citation: citation({ quote: 'the attention mechanism' }),
    spanText: 'the efficient attention mechanism differs'
  }
  assert.equal(resolveCitations('x [1]', [fuzzy]).misattributed.length, 1)
})

test('a missing span cannot refute the quote, so the citation resolves', () => {
  const unknown = resolveCitations('x [1]', [{ citation: citation() }])
  assert.equal(unknown.resolved.length, 1)
})

test('precision counts resolved markers over all markers', () => {
  const resolution = resolveCitations('a [1] b [2] c [9]', [
    context({ citation: citation({ index: 1 }) }),
    {
      citation: citation({ index: 2, quote: 'nowhere in the span' }),
      spanText: 'span without the quote'
    }
  ])

  assert.equal(resolution.matches.length, 3)
  assert.equal(resolution.resolved.length, 1)
  assert.equal(resolution.misattributed.length, 1)
  assert.equal(resolution.unresolved.length, 1)
  assert.equal(resolution.precision, 1 / 3)
})

test('an answer with no markers has no matches and zero precision', () => {
  const resolution = resolveCitations('A plain answer.', [context()])
  assert.deepEqual(resolution.matches, [])
  assert.equal(resolution.precision, 0)
})

test('every marker occurrence is reported, not just the first', () => {
  const resolution = resolveCitations('first [1] and again [1]', [context()])
  assert.equal(resolution.resolved.length, 2)
})

test('normalisation collapses whitespace and case only', () => {
  assert.equal(normalizeForComparison('  Hello\n\tWorld  '), 'hello world')
})
