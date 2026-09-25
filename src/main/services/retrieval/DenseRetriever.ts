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
import type { RetrieveOptions, RetrievedEvidence, Retriever } from './types'

export class DenseRetriever implements Retriever {
  constructor(private readonly embeddingService: EmbeddingService) {}

  async search(
    notebookId: string,
    query: string,
    options: RetrieveOptions = {}
  ): Promise<RetrievedEvidence[]> {
    const { topK = 5, threshold = 0.5 } = options

    // E5 要求 query 前缀，与索引时的 document 前缀区分
    await this.embeddingService.ensureReady()
    const queryEmbedding = await this.embeddingService.embed(query, 'query')

    const vectorStore = await vectorStoreManager.getStore(notebookId)
    const hits = await vectorStore.query(queryEmbedding.embedding, { topK, threshold })
    if (hits.length === 0) return []

    return hydrateEvidence(getDatabase(), hits)
  }
}
