/**
 * Retrieval metrics (#75).
 *
 * Pure functions over the per-question match matrix, so the arithmetic is unit
 * tested and the harness only has to supply retrieval output. Relevance is
 * binary (an item either covers a ground-truth block or it does not) and gains
 * are not graded — the dataset records locations, not degrees of relevance.
 */

/** Ground-truth indices matched by each retrieved rank, in rank order. */
export type MatchMatrix = number[][]

/** 1-based rank of the first relevant item, or 0 when none is relevant. */
export function firstRelevantRank(matchesByRank: MatchMatrix): number {
  const index = matchesByRank.findIndex((matches) => matches.length > 0)
  return index === -1 ? 0 : index + 1
}

/** Fraction of ground-truth locations covered by the first `k` ranks. */
export function recallAtK(matchesByRank: MatchMatrix, groundTruthCount: number, k: number): number {
  if (groundTruthCount === 0) return 0
  const covered = new Set<number>()
  for (const matches of matchesByRank.slice(0, k)) {
    for (const match of matches) covered.add(match)
  }
  return covered.size / groundTruthCount
}

/** Mean reciprocal rank of the first relevant item. */
export function reciprocalRank(matchesByRank: MatchMatrix): number {
  const rank = firstRelevantRank(matchesByRank)
  return rank === 0 ? 0 : 1 / rank
}

/**
 * nDCG@k with binary gains. The ideal ranking puts every ground-truth location
 * first, so the discount is a plain log base 2.
 */
export function ndcgAtK(matchesByRank: MatchMatrix, groundTruthCount: number, k: number): number {
  if (groundTruthCount === 0) return 0

  let dcg = 0
  const limit = Math.min(matchesByRank.length, k)
  for (let i = 0; i < limit; i++) {
    if (matchesByRank[i].length > 0) dcg += 1 / Math.log2(i + 2)
  }

  let idcg = 0
  const ideal = Math.min(groundTruthCount, k)
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2)

  return idcg === 0 ? 0 : dcg / idcg
}

/**
 * Evidence precision@k: of the first `k` retrieved passages, the share that cover
 * a ground-truth block.
 *
 * This is retrieval precision, **not** answer citation recall. No model runs in
 * this harness and no answer is produced, so a metric that claims to be about an
 * answer's citations would be a false claim. Answer-level citation correctness is
 * the resolver's job (#70); a model-driven answer eval is a separate deliverable.
 *
 * Each retrieved passage is counted once, however many ground-truth blocks it
 * covers. Overlapping chunks can cover the same block, and each still counts as a
 * separate retrieved passage — a reader would see two citations there, and this
 * metric describes what they would be shown.
 */
export function evidencePrecisionAtK(matchesByRank: MatchMatrix, k: number): number {
  const retrieved = matchesByRank.slice(0, k)
  if (retrieved.length === 0) return 0
  const grounded = retrieved.filter((matches) => matches.length > 0).length
  return grounded / retrieved.length
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Nearest-rank percentile. `p` is 0-100. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1)
  return sorted[index]
}
