/**
 * EmbeddingService
 * 벡터 생성 로직 캡슐화, 배치 처리 및 오류 재시도 지원
 */

import { ProviderManager } from '../providers/ProviderManager'
import type { EmbeddingResult, EmbeddingConfig } from '../providers/types'
import Logger from '../../shared/utils/logger'

/**
 * Embedding 서비스 설정
 */
export interface EmbeddingServiceConfig {
  batchSize?: number // 배치 크기, 기본값 20
  maxRetries?: number // 최대 재시도 횟수, 기본값 3
  retryDelay?: number // 재시도 지연 (밀리초), 기본값 1000
  rateLimit?: number // 요청 간격 (밀리초), 기본값 100
}

/**
 * Embedding 서비스
 * 벡터 생성 로직 캡슐화, 배치 처리, 오류 재시도, 속도 제한 지원
 */
export class EmbeddingService {
  private providerManager: ProviderManager
  private config: Required<EmbeddingServiceConfig>

  constructor(providerManager: ProviderManager, config?: EmbeddingServiceConfig) {
    this.providerManager = providerManager
    this.config = {
      batchSize: config?.batchSize ?? 20,
      maxRetries: config?.maxRetries ?? 3,
      retryDelay: config?.retryDelay ?? 1000,
      rateLimit: config?.rateLimit ?? 100
    }
  }

  /**
   * 단일 텍스트의 임베딩 벡터 생성
   */
  async embed(text: string, config?: EmbeddingConfig): Promise<EmbeddingResult> {
    const provider = await this.providerManager.getActiveEmbeddingProvider()

    if (!provider) {
      throw new Error('No embedding provider available')
    }

    return await this.withRetry(() => provider.createEmbedding(text, config))
  }

  /**
   * 일괄 임베딩 벡터 생성
   * 대량 텍스트를 자동으로 배치 처리
   */
  async embedBatch(
    texts: string[],
    config?: EmbeddingConfig,
    onProgress?: (completed: number, total: number) => void
  ): Promise<EmbeddingResult[]> {
    if (texts.length === 0) {
      return []
    }

    const provider = await this.providerManager.getActiveEmbeddingProvider()

    if (!provider) {
      throw new Error('No embedding provider available')
    }

    const results: EmbeddingResult[] = []
    const batches = this.chunk(texts, this.config.batchSize)

    Logger.info('EmbeddingService', `Processing ${texts.length} texts in ${batches.length} batches`)

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]

      try {
        const batchResults = await this.withRetry(() => provider.createEmbeddings(batch, config))
        results.push(...batchResults)

        if (onProgress) {
          onProgress(results.length, texts.length)
        }

        Logger.debug('EmbeddingService', `Batch ${i + 1}/${batches.length} completed`)

        // rate limiting 방지
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
   * 현재 Embedding Provider의 기본 Embedding 모델 조회
   */
  async getDefaultModel(): Promise<string | undefined> {
    const provider = await this.providerManager.getActiveEmbeddingProvider()
    return provider?.getDefaultEmbeddingModel()
  }

  /**
   * 현재 Embedding Provider가 Embedding을 지원하는지 확인
   */
  async isAvailable(): Promise<boolean> {
    const provider = await this.providerManager.getActiveEmbeddingProvider()
    return provider !== null
  }

  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<EmbeddingServiceConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 배열 분할
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }

  /**
   * 재시도 포함 실행
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
          // 지수 백오프
          const delay = this.config.retryDelay * Math.pow(2, attempt - 1)
          await this.sleep(delay)
        }
      }
    }

    throw lastError
  }

  /**
   * 지연
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
