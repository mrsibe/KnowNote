import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rrfFuse, RRF_K, type CandidateHit } from '../src/main/services/retrieval/candidates.ts'

/**
 * Retrieval fusion (#77). RRF combines ranks, not scores, because a cosine
 * similarity and a BM25 score are not on the same scale. These pin the two
 * properties the hybrid retriever depends on: agreement between channels wins, and
 * a chunk only one channel found still ranks.
 */

const hit = (chunkId: string, score = 0): CandidateHit => ({ chunkId, score })

test('a chunk both channels rank beats one only a single channel found', () => {
  const dense = [hit('a'), hit('shared')]
  const sparse = [hit('shared'), hit('b')]

  const fused = rrfFuse([dense, sparse])

  assert.equal(fused[0].chunkId, 'shared')
  assert.deepEqual(
    fused.map((entry) => entry.rank),
    [1, 2, 3]
  )
})

test('a chunk found by only one channel still ranks', () => {
  const fused = rrfFuse([[hit('only-dense')], [hit('only-sparse')]])

  assert.equal(fused.length, 2)
  // Ranked 1 in its own channel, so both contribute the same amount.
  assert.equal(fused[0].score, fused[1].score)
})

test('the fused score is the sum of reciprocal ranks', () => {
  const fused = rrfFuse([[hit('a'), hit('b')], [hit('b')]])

  const byId = new Map(fused.map((entry) => [entry.chunkId, entry.score]))
  assert.ok(Math.abs((byId.get('a') as number) - 1 / (RRF_K + 1)) < 1e-12)
  assert.ok(Math.abs((byId.get('b') as number) - (1 / (RRF_K + 2) + 1 / (RRF_K + 1))) < 1e-12)
})

test('an empty channel contributes nothing and does not throw', () => {
  const fused = rrfFuse([[], [hit('a')]])
  assert.deepEqual(
    fused.map((entry) => entry.chunkId),
    ['a']
  )
  assert.deepEqual(rrfFuse([]), [])
  assert.deepEqual(rrfFuse([[], []]), [])
})

test('scores are not used, only order — a low-scoring rank-1 still wins its channel', () => {
  const highScoreButLast = [hit('first', 0.01), hit('second', 0.99)]
  const fused = rrfFuse([highScoreButLast])

  assert.deepEqual(
    fused.map((entry) => entry.chunkId),
    ['first', 'second']
  )
})

test('a chunk present in both channels outranks a chunk ranked first by one', () => {
  // The point of fusion: agreement is stronger evidence than a single channel's
  // confidence, even when that channel put its pick first.
  const dense = [hit('dense-top'), hit('agreed')]
  const sparse = [hit('sparse-top'), hit('agreed')]

  const fused = rrfFuse([dense, sparse])

  assert.equal(fused[0].chunkId, 'agreed')
})
