/**
 * RemoteEmbeddingBackend
 *
 * 包装已有的 ModelClient（AI SDK 路径不变），把远程 embedding connection 适配成
 * EmbeddingBackend。远程模型不区分 query/document 前缀 —— 前缀语义由各 provider 负责。
 */

import type { EmbeddingPurpose, EmbeddingSpace } from '../../shared/types'
import type { ModelClient } from '../models/ModelClient'
import type { EmbeddingConfig } from '../models/types'
import { getRemoteSpace } from './space'
import type { BackendEmbeddingResult, EmbeddingBackend } from './types'

export class RemoteEmbeddingBackend implements EmbeddingBackend {
  readonly kind = 'remote' as const

  private readonly client: ModelClient
  private space: EmbeddingSpace

  constructor(client: ModelClient) {
    this.client = client
    this.space = getRemoteSpace(client.connection)
  }

  getSpace(): EmbeddingSpace {
    return this.space
  }

  async isReady(): Promise<boolean> {
    return Boolean(this.client.modelId)
  }

  async embed(text: string, purpose: EmbeddingPurpose): Promise<BackendEmbeddingResult> {
    void purpose
    return this.toBackendResult(await this.client.createEmbedding(text))
  }

  async embedBatch(
    texts: string[],
    purpose: EmbeddingPurpose,
    onProgress?: (completed: number, total: number) => void
  ): Promise<BackendEmbeddingResult[]> {
    void purpose
    if (texts.length === 0) {
      return []
    }

    // ModelClient 自己不分批，这里按批处理，顺便上报进度
    const batchSize = 20
    const results: BackendEmbeddingResult[] = []

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)
      const batchResults = await this.client.createEmbeddings(batch)
      results.push(...batchResults.map((result) => this.toBackendResult(result)))
      onProgress?.(results.length, texts.length)
    }

    return results
  }

  private toBackendResult(result: {
    embedding: Float32Array
    model: string
    dimensions: number
    tokensUsed: number
  }): BackendEmbeddingResult {
    // 首次量到真实维度后回填，保证 space 身份包含维度
    if (this.space.dimensions !== result.dimensions) {
      this.space = getRemoteSpace(this.client.connection, result.dimensions)
    }
    return {
      embedding: result.embedding,
      model: result.model,
      dimensions: result.dimensions,
      tokensUsed: result.tokensUsed
    }
  }
}

export type { EmbeddingConfig }
