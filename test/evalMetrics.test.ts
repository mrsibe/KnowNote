import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  citationRecall,
  firstRelevantRank,
  mean,
  ndcgAtK,
  percentile,
  recallAtK,
  reciprocalRank
} from '../src/main/eval/metrics.ts'

/**
 * The eval metrics are the only numbers v1.5 experiments (#77, #78) are allowed
 * to argue from, so they are pinned by hand here rather than trusted to the
 * harness that calls them.
 */

test('recall@k covers ground truth within the first k ranks', () => {
  // rank 1 matches gt 0, rank 2 matches nothing, rank 3 matches gt 1
  const matches = [[0], [], [1]]

  assert.equal(recallAtK(matches, 2, 1), 0.5)
  assert.equal(recallAtK(matches, 2, 2), 0.5)
  assert.equal(recallAtK(matches, 2, 3), 1)
})

test('a repeated match does not inflate recall past 1', () => {
  const matches = [[0], [0], [0]]
  assert.equal(recallAtK(matches, 1, 3), 1)
})

test('recall is 0 when there is no ground truth', () => {
  assert.equal(recallAtK([[]], 0, 5), 0)
})

test('first relevant rank is 1-based and 0 when nothing is relevant', () => {
  assert.equal(firstRelevantRank([[], [], [2]]), 3)
  assert.equal(firstRelevantRank([[], []]), 0)
  assert.equal(firstRelevantRank([]), 0)
})

test('reciprocal rank is 1/rank of the first hit', () => {
  assert.equal(reciprocalRank([[0]]), 1)
  assert.equal(reciprocalRank([[], [0]]), 0.5)
  assert.equal(reciprocalRank([[], []]), 0)
})

test('nDCG@k discounts a later hit and is 1 when the hit is first', () => {
  assert.equal(ndcgAtK([[0]], 1, 10), 1)
  // A single ground truth at rank 2: 1/log2(3) over the ideal 1/log2(2)
  assert.ok(Math.abs(ndcgAtK([[], [0]], 1, 10) - 1 / Math.log2(3)) < 1e-12)
  assert.equal(ndcgAtK([[], []], 1, 10), 0)
})

test('citation recall counts grounded citations over citations retrieved', () => {
  // 2 of 3 retrieved citations are grounded
  assert.equal(citationRecall([[0], [], [1]], 3), 2 / 3)
  assert.equal(citationRecall([], 5), 0)
})

test('mean and percentile handle the empty and single cases', () => {
  assert.equal(mean([]), 0)
  assert.equal(mean([1, 2, 3]), 2)
  assert.equal(percentile([], 50), 0)
  assert.equal(percentile([42], 95), 42)
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3)
  assert.equal(percentile([5, 1, 4, 2, 3], 95), 5)
})
