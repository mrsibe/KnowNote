import { EmbeddingService } from './EmbeddingService'
import Logger from '../../shared/utils/logger'

export interface RerankCandidate {
  chunkId: string
  content: string
  score: number
  [key: string]: any
}

export class RerankService {
  private embeddingService: EmbeddingService

  constructor(embeddingService: EmbeddingService) {
    this.embeddingService = embeddingService
  }

  /**
   * Rerank candidates by embedding-based similarity rescoring
   * Uses the query embedding and original chunk embeddings for precise cosine similarity
   */
  async rerank(
    query: string,
    candidates: RerankCandidate[],
    topN: number
  ): Promise<RerankCandidate[]> {
    if (candidates.length <= topN) return candidates

    try {
      // Generate query embedding
      const queryEmbedding = await this.embeddingService.embed(query)

      // Generate embeddings for all candidate contents
      const contents = candidates.map((c) => c.content)
      const candidateEmbeddings = await this.embeddingService.embedBatch(contents)

      // Compute cosine similarity for each candidate
      const scored = candidates.map((candidate, i) => {
        const similarity = this.cosineSimilarity(
          queryEmbedding.embedding,
          candidateEmbeddings[i].embedding
        )
        return { ...candidate, score: similarity }
      })

      // Sort by similarity score (descending) and take topN
      scored.sort((a, b) => b.score - a.score)

      Logger.debug('Rerank', `Reranked ${candidates.length} candidates → top ${topN}`)
      return scored.slice(0, topN)
    } catch (error) {
      Logger.warn('Rerank', 'Reranking failed, returning original order:', error)
      return candidates.slice(0, topN)
    }
  }

  /**
   * Cosine similarity between two Float32Array vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB)
    if (denominator === 0) return 0
    return dotProduct / denominator
  }
}
