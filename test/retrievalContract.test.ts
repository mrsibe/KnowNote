import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRetrievalTrace } from '../src/main/services/retrieval/trace.ts'
import { assertFilterSupported } from '../src/main/services/retrieval/filter.ts'

/**
 * The retrieval contract (#160) is the seam #94, #157 and #77 build on. These pin
 * the two properties the rest of v1.5 assumes:
 *
 * - the trace describes what a search actually used, so #157 can snapshot it;
 * - an unsupported filter is refused instead of silently ignored, because the
 *   whole point of #160 is to stop declaring capabilities that do nothing.
 */

test('a trace carries the effective search parameters and no empty fields', () => {
  const trace = buildRetrievalTrace({
    strategy: 'dense',
    topK: 5,
    threshold: 0.5,
    durationMs: 12.5
  })

  assert.deepEqual(trace, {
    strategy: 'dense',
    scope: {},
    topK: 5,
    threshold: 0.5,
    durationMs: 12.5
  })
  // An unset threshold means "no threshold", not "threshold 0".
  assert.equal(
    'threshold' in buildRetrievalTrace({ strategy: 'dense', topK: 5, durationMs: 1 }),
    false
  )
})

test('a filter becomes the recorded scope of the trace', () => {
  const trace = buildRetrievalTrace({
    strategy: 'dense',
    filter: { documentIds: ['doc_a', 'doc_b'] },
    topK: 8,
    durationMs: 3
  })

  assert.deepEqual(trace.scope, { documentIds: ['doc_a', 'doc_b'] })
  assert.equal(trace.topK, 8)
})

test('a not-yet-implemented source filter is refused, not ignored', () => {
  // Nothing about the empty cases should throw: they mean "no filter".
  assert.doesNotThrow(() => assertFilterSupported(undefined))
  assert.doesNotThrow(() => assertFilterSupported({}))
  assert.doesNotThrow(() => assertFilterSupported({ documentIds: [] }))

  // A real filter must fail loudly until #94 implements it. Silently returning
  // unscoped results would look like it worked.
  assert.throws(() => assertFilterSupported({ documentIds: ['doc_a'] }), /#94/)
})
