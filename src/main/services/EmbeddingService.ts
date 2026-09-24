/**
 * EmbeddingService
 * 封装向量生成逻辑，支持批处理和错误重试
 */

import { ConnectionManager } from '../models/ConnectionManager'
import type { EmbeddingResult, EmbeddingConfig } from '../models/types'
import Logger from '../../shared/utils/logger'

/**
 * Embedding 服务配置
 */
export interface EmbeddingServiceConfig {
  batchSize?: number // 批处理大小，默认 20
  maxRetries?: number // 最大重试次数，默认 3
  retryDelay?: number // 重试延迟（毫秒），默认 1000
  rateLimit?: number // 请求间隔（毫秒），默认 100
}

/**
 * Embedding 服务
 * 封装向量生成逻辑，支持批处理、错误重试、速率控制
 */
export class EmbeddingService {
  private connectionManager: ConnectionManager
  private config: Required<EmbeddingServiceConfig>

  constructor(connectionManager: ConnectionManager, config?: EmbeddingServiceConfig) {
    this.connectionManager = connectionManager
    this.config = {
      batchSize: config?.batchSize ?? 20,
      maxRetries: config?.maxRetries ?? 3,
      retryDelay: config?.retryDelay ?? 1000,
      rateLimit: config?.rateLimit ?? 100
    }
  }

  /**
   * 生成单个文本的嵌入向量
   */
  async embed(text: string, config?: EmbeddingConfig): Promise<EmbeddingResult> {
    const client = await this.connectionManager.getEmbeddingClient()

    if (!client) {
      throw new Error('No embedding model configured')
    }

    return await this.withRetry(() => client.createEmbedding(text, config))
  }

  /**
   * 批量生成嵌入向量
   * 自动分批处理大量文本
   */
  async embedBatch(
    texts: string[],
    config?: EmbeddingConfig,
    onProgress?: (completed: number, total: number) => void
  ): Promise<EmbeddingResult[]> {
    if (texts.length === 0) {
      return []
    }

    const client = await this.connectionManager.getEmbeddingClient()

    if (!client) {
      throw new Error('No embedding model configured')
    }

    const results: EmbeddingResult[] = []
    const batches = this.chunk(texts, this.config.batchSize)

    Logger.info('EmbeddingService', `Processing ${texts.length} texts in ${batches.length} batches`)

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]

      try {
        const batchResults = await this.withRetry(() => client.createEmbeddings(batch, config))
        results.push(...batchResults)

        if (onProgress) {
          onProgress(results.length, texts.length)
        }

        Logger.debug('EmbeddingService', `Batch ${i + 1}/${batches.length} completed`)

        // 避免 rate limiting
        if (i < batches.length - 1) {
          await this.sleep(this.config.rateLimit)
        }
      } catch (error) {
        Logger.error('EmbeddingService', `Batch ${i + 1} failed:`, error)
        throw error
      }
    }

    return results
  }

  /**
   * 获取当前 Embedding Connection 的模型 ID
   */
  async getDefaultModel(): Promise<string | undefined> {
    const client = await this.connectionManager.getEmbeddingClient()
    return client?.modelId
  }

  /**
   * 检查是否配置了 Embedding Connection
   */
  async isAvailable(): Promise<boolean> {
    const client = await this.connectionManager.getEmbeddingClient()
    return client !== null
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<EmbeddingServiceConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 数组分块
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }

  /**
   * 带重试的执行
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error as Error
        Logger.warn('EmbeddingService', `Attempt ${attempt} failed:`, error)

        if (attempt < this.config.maxRetries) {
          // 指数退避
          const delay = this.config.retryDelay * Math.pow(2, attempt - 1)
          await this.sleep(delay)
        }
      }
    }

    throw lastError
  }

  /**
   * 延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
