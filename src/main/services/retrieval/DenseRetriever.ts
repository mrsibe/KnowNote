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
import { hydrateEvidence } from './evidence'
import { assertFilterSupported } from './filter'
import { buildRetrievalTrace } from './trace'
import type { RetrievalRequest, RetrievalResult, Retriever } from './types'

const STRATEGY = 'dense'

export class DenseRetriever implements Retriever {
  constructor(private readonly embeddingService: EmbeddingService) {}

  async search(request: RetrievalRequest): Promise<RetrievalResult> {
    // 先拒绝还不支持的过滤：静默忽略会返回"看起来受限、实际未受限"的结果。
    assertFilterSupported(request.filter)

    const topK = request.topK ?? 5
    const threshold = request.threshold ?? 0.5
    const startedAt = performance.now()

    // E5 要求 query 前缀，与索引时的 document 前缀区分
    await this.embeddingService.ensureReady()
    const queryEmbedding = await this.embeddingService.embed(request.query, 'query')

    const vectorStore = await vectorStoreManager.getStore(request.notebookId)
    const hits = await vectorStore.query(queryEmbedding.embedding, { topK, threshold })

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
