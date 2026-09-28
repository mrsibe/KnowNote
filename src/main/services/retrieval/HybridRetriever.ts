import { getDatabase } from '../../db'
import type { EmbeddingService } from '../EmbeddingService'
import { searchChunksFts } from '../fts'
import { rrfFuse, type CandidateHit } from './candidates'
import { DenseRetriever } from './DenseRetriever'
import { hydrateEvidence } from './evidence'
import { buildRetrievalTrace } from './trace'
import type { RetrievalRequest, RetrievalResult, RetrievalStrategy, Retriever } from './types'

/**
 * HybridRetriever (#77)
 *
 * 三条策略共用一条路径，区别只在候选怎么产生：
 *
 *   dense  释义相近的段落（向量）
 *   sparse 字面出现的段落（BM25 over chunks_fts，#96）
 *   hybrid RRF 融合两者
 *
 * 融合在候选层完成（`chunkId + rank`），证据只补齐一次 —— 见 `candidates.ts`。
 * 两个通道的分数（cosine 与 BM25）不可比，所以只用 rank，这正是 RRF 的意义。
 */
export class HybridRetriever implements Retriever {
  private readonly dense: DenseRetriever

  constructor(embeddingService: EmbeddingService) {
    this.dense = new DenseRetriever(embeddingService)
  }

  async search(request: RetrievalRequest): Promise<RetrievalResult> {
    const strategy: RetrievalStrategy = request.strategy ?? 'dense'
    const topK = request.topK ?? 5
    const startedAt = performance.now()

    let hits: CandidateHit[]
    // BM25 没有「相似度阈值」这个概念，所以 sparse 的 trace 里 threshold 保持缺省，
    // 而不是拿 dense 的 0.5 冒充。
    let threshold: number | undefined

    if (strategy === 'sparse') {
      hits = searchChunksFts(request.notebookId, request.query, {
        limit: topK,
        documentIds: request.filter?.documentIds
      })
    } else if (strategy === 'hybrid') {
      const denseHits = await this.dense.candidateHits(request)
      const sparseHits = searchChunksFts(request.notebookId, request.query, {
        limit: topK,
        documentIds: request.filter?.documentIds
      })
      hits = rrfFuse([denseHits, sparseHits]).slice(0, topK)
    } else {
      threshold = request.threshold ?? 0.5
      hits = await this.dense.candidateHits({ ...request, threshold })
    }

    const evidence = hits.length === 0 ? [] : hydrateEvidence(getDatabase(), hits)

    return {
      evidence,
      trace: buildRetrievalTrace({
        strategy,
        filter: request.filter,
        topK,
        threshold,
        durationMs: performance.now() - startedAt
      })
    }
  }
}
