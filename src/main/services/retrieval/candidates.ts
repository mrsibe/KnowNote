/**
 * Retrieval candidate layer (#77).
 *
 * Fusion combines `chunkId + rank`, not hydrated evidence: RRF only needs to know
 * where each channel ranked a chunk. Hydrating first would join documents, blocks
 * and offsets for every channel and then throw most of it away, so candidates are
 * fused as ids and hydrated once at the end.
 */

/** One channel's hit, before fusion. */
export interface CandidateHit {
  chunkId: string
  score: number
}

/** A fused hit with its final rank. */
export interface ScoredChunkHit {
  chunkId: string
  score: number
  rank: number
}

/** The RRF constant from the original paper; it damps the top ranks' advantage. */
export const RRF_K = 60

/**
 * Reciprocal Rank Fusion across channels.
 *
 * A chunk's fused score is `sum(1 / (k + rank))` over the channels that returned
 * it, so a chunk ranked well by one channel and absent from another still scores,
 * and agreement between channels is what moves a chunk up. Scores are not
 * comparable across channels (cosine vs BM25), which is exactly why only the ranks
 * are used.
 */
export function rrfFuse(
  channels: readonly (readonly CandidateHit[])[],
  k: number = RRF_K
): ScoredChunkHit[] {
  const fused = new Map<string, number>()

  for (const channel of channels) {
    channel.forEach((hit, index) => {
      const contribution = 1 / (k + index + 1)
      fused.set(hit.chunkId, (fused.get(hit.chunkId) ?? 0) + contribution)
    })
  }

  return [...fused.entries()]
    .map(([chunkId, score]) => ({ chunkId, score, rank: 0 }))
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
    .map((hit, index) => ({ ...hit, rank: index + 1 }))
}
