/**
 * DenseRetriever
 * 当前的默认检索策略：查询向量 → 向量库 KNN → 批量补齐证据。
 *
 * 只负责"怎么检索"。embedding space 校验留在 `KnowledgeService`（那是前置条件，
 * 不是策略），因此这个类可以单独被 eval harness 与后续的 BM25 / hybrid 策略替换。
 */

import { getDatabase } from '../../db'
import { vectorStoreManager } from '../../vectorstore'
import type { EmbeddingService } from '../EmbeddingService'
import type { CandidateHit } from './candidates'
import { hydrateEvidence } from './evidence'
import { buildRetrievalTrace } from './trace'
import type { RetrievalRequest, RetrievalResult, Retriever } from './types'

const STRATEGY = 'dense'

export class DenseRetriever implements Retriever {
  constructor(private readonly embeddingService: EmbeddingService) {}

  /**
   * 只做“向量命中”，不补齐证据。
   *
   * 抽出来是给 hybrid 用的（#77）：融合需要的是 `chunkId + score`，不是已经 join 好
   * 文档/块/偏移的证据。公开方法让 `HybridRetriever` 复用同一条 dense 路径，而不是把
   * embed + KNN 抄一遍。
   */
  async candidateHits(request: RetrievalRequest): Promise<CandidateHit[]> {
    const topK = request.topK ?? 5
    const threshold = request.threshold ?? 0.5

    // E5 要求 query 前缀，与索引时的 document 前缀区分
    await this.embeddingService.ensureReady()
    const queryEmbedding = await this.embeddingService.embed(request.query, 'query')

    const vectorStore = await vectorStoreManager.getStore(request.notebookId)
    // scope 过滤由向量库在 KNN 之前执行（#94），不是取回 topK 之后再筛。
    const hits = await vectorStore.query(queryEmbedding.embedding, {
      topK,
      threshold,
      filter: request.filter
    })

    return hits.map((hit) => ({ chunkId: hit.chunkId, score: hit.score }))
  }

  async search(request: RetrievalRequest): Promise<RetrievalResult> {
    const topK = request.topK ?? 5
    const threshold = request.threshold ?? 0.5
    const startedAt = performance.now()

    const hits = await this.candidateHits(request)
    const evidence = hits.length === 0 ? [] : hydrateEvidence(getDatabase(), hits)

    return {
      evidence,
      trace: buildRetrievalTrace({
        strategy: STRATEGY,
        filter: request.filter,
        topK,
        threshold,
        durationMs: performance.now() - startedAt
      })
    }
  }
}
