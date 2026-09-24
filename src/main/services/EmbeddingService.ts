/**
 * EmbeddingService
 *
 * 只表达"我要 embedding"，不认识 ONNX / OpenAI / Ollama：没配置远程 embedding
 * connection 时用内置本地模型，配置了就转发给远程。默认配置下用户只需配好 Chat 就能
 * 上传第一个 PDF。
 *
 * 远程路径带批处理、错误重试与速率控制；本地路径负责按需下载模型并获得进度。
 */

import type {
  EmbeddingDownloadProgress,
  EmbeddingPurpose,
  EmbeddingSourceInfo,
  EmbeddingSpace,
  LocalEmbeddingModelInfo
} from '../../shared/types'
import { DEFAULT_EMBEDDING_SOURCES } from '../../shared/types'
import { ConnectionManager } from '../models/ConnectionManager'
import Logger from '../../shared/utils/logger'
import { LocalEmbeddingBackend } from '../embedding/LocalEmbeddingBackend'
import type { TransformersModuleLoader } from '../embedding/LocalEmbeddingBackend'
import { RemoteEmbeddingBackend } from '../embedding/RemoteEmbeddingBackend'
import type { BackendEmbeddingResult, EmbeddingBackend } from '../embedding/types'
import { ModelDownloadService } from '../embedding/download/ModelDownloadService'
import {
  deleteLocalModel,
  ensureRevisionlessAliases,
  getLocalModelInfo,
  importLocalModel,
  isModelInstalled
} from '../embedding/ModelRegistry'

/**
 * Embedding 服务配置
 */
export interface EmbeddingServiceConfig {
  batchSize?: number // 远程批处理大小，默认 20
  maxRetries?: number // 最大重试次数，默认 3
  retryDelay?: number // 重试延迟（毫秒），默认 1000
  rateLimit?: number // 请求间隔（毫秒），默认 100
}

export interface EmbeddingServiceOptions extends EmbeddingServiceConfig {
  /** userData/models */
  cacheDir: string
  /** 覆盖下载源（按顺序）；默认 huggingface.co → hf-mirror.com */
  getSources?: () => string[] | Promise<string[]>
  /** 设置页里的下载进度广播 */
  onDownloadProgress?: (progress: EmbeddingDownloadProgress) => void
  /** 测试注入 */
  loadTransformers?: TransformersModuleLoader
}

const DEFAULT_SOURCES = DEFAULT_EMBEDDING_SOURCES

/**
 * Embedding 服务
 */
export class EmbeddingService {
  private readonly connectionManager: ConnectionManager
  private readonly cacheDir: string
  private readonly getSources: () => string[] | Promise<string[]>
  private readonly onDownloadProgress?: (progress: EmbeddingDownloadProgress) => void
  private readonly loadTransformers?: TransformersModuleLoader
  private config: Required<EmbeddingServiceConfig>

  private localBackend: LocalEmbeddingBackend | null = null
  private downloadService: ModelDownloadService | null = null
  private downloadProgressListener: ((progress: EmbeddingDownloadProgress) => void) | null = null
  private lastDetectedRemoteDimensions = 0

  constructor(connectionManager: ConnectionManager, options: EmbeddingServiceOptions) {
    this.connectionManager = connectionManager
    this.cacheDir = options.cacheDir
    this.getSources = options.getSources ?? (() => [...DEFAULT_SOURCES])
    this.onDownloadProgress = options.onDownloadProgress
    this.loadTransformers = options.loadTransformers
    this.config = {
      batchSize: options.batchSize ?? 20,
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      rateLimit: options.rateLimit ?? 100
    }
  }

  /**
   * 远程 connection 已配置时用远程，否则用内置本地模型。
   */
  async resolveBackend(): Promise<EmbeddingBackend> {
    const client = await this.connectionManager.getEmbeddingClient()
    if (client) {
      const backend = new RemoteEmbeddingBackend(client)
      this.lastDetectedRemoteDimensions = 0
      return backend
    }
    return this.getLocalBackend()
  }

  /**
   * 当前生效的 space 身份（不触发下载/推理）
   */
  async getSpace(): Promise<EmbeddingSpace> {
    return (await this.resolveBackend()).getSpace()
  }

  /**
   * 确保当前后端可用：远程需要 connection；本地需要模型已安装，没有则按需下载。
   *
   * 这是「第一次使用 RAG 时下载」的触发点。
   */
  async ensureReady(onProgress?: (progress: EmbeddingDownloadProgress) => void): Promise<void> {
    const connection = await this.connectionManager.getConnection('embedding')
    if (connection) {
      return
    }

    if (await isModelInstalled(this.cacheDir)) {
      // 探测步骤读不带 revision 的路径，确保别名存在（旧版本缓存可能还没有）
      await ensureRevisionlessAliases(this.cacheDir)
      return
    }

    await this.downloadLocalModel(onProgress)
  }

  /**
   * 生成单个文本的嵌入向量
   */
  async embed(
    text: string,
    purpose: EmbeddingPurpose = 'document'
  ): Promise<BackendEmbeddingResult> {
    const backend = await this.resolveBackend()
    return await this.withRetry(() => backend.embed(text, purpose))
  }

  /**
   * 批量生成嵌入向量
   */
  async embedBatch(
    texts: string[],
    purpose: EmbeddingPurpose = 'document',
    onProgress?: (completed: number, total: number) => void
  ): Promise<BackendEmbeddingResult[]> {
    if (texts.length === 0) {
      return []
    }

    const backend = await this.resolveBackend()

    if (backend.kind === 'remote') {
      return await this.embedRemoteInBatches(backend, texts, purpose, onProgress)
    }

    return await this.withRetry(() => backend.embedBatch(texts, purpose, onProgress))
  }

  private async embedRemoteInBatches(
    backend: EmbeddingBackend,
    texts: string[],
    purpose: EmbeddingPurpose,
    onProgress?: (completed: number, total: number) => void
  ): Promise<BackendEmbeddingResult[]> {
    const results: BackendEmbeddingResult[] = []
    const batches = this.chunk(texts, this.config.batchSize)

    Logger.info('EmbeddingService', `Processing ${texts.length} texts in ${batches.length} batches`)

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const batchResults = await this.withRetry(() => backend.embedBatch(batch, purpose))
      results.push(...batchResults)
      onProgress?.(results.length, texts.length)
      Logger.debug('EmbeddingService', `Batch ${i + 1}/${batches.length} completed`)

      if (i < batches.length - 1) {
        await this.sleep(this.config.rateLimit)
      }
    }

    return results
  }

  /**
   * 是否配置了远程 embedding connection
   */
  async isRemoteConfigured(): Promise<boolean> {
    return Boolean(await this.connectionManager.getConnection('embedding'))
  }

  /**
   * 检查是否可用：远程 connection 已配置，或本地模型已安装
   */
  async isAvailable(): Promise<boolean> {
    if (await this.isRemoteConfigured()) {
      return true
    }
    return await isModelInstalled(this.cacheDir)
  }

  /**
   * 获取当前 Embedding 模型标识
   */
  async getDefaultModel(): Promise<string | undefined> {
    const connection = await this.connectionManager.getConnection('embedding')
    if (connection) {
      return connection.modelId
    }
    return (await this.getLocalBackend().getSpace()).model
  }

  /**
   * 获取本次会话首次量到的远程维度（0 表示还没量到）
   */
  getDetectedRemoteDimensions(): number {
    return this.lastDetectedRemoteDimensions
  }

  // ==================== 内置本地模型管理 ====================

  /**
   * UI 需要的本地模型状态（安装 / 未安装 / 占用字节）
   */
  async getLocalModelInfo(): Promise<LocalEmbeddingModelInfo> {
    return await getLocalModelInfo(this.cacheDir)
  }

  /**
   * 下载并校验内置本地模型；可被 cancelLocalModelDownload() 取消。
   */
  async downloadLocalModel(
    onProgress?: (progress: EmbeddingDownloadProgress) => void
  ): Promise<void> {
    this.downloadProgressListener = onProgress ?? null
    try {
      const service = await this.getDownloadService()
      await service.downloadAll()
    } finally {
      this.downloadProgressListener = null
    }
  }

  cancelLocalModelDownload(): void {
    this.downloadService?.cancel()
  }

  isDownloading(): boolean {
    return this.downloadService?.isDownloading() ?? false
  }

  async deleteLocalModel(): Promise<void> {
    await this.localBackend?.dispose()
    this.localBackend = null
    await deleteLocalModel(this.cacheDir)
  }

  async probeSources(): Promise<EmbeddingSourceInfo[]> {
    const service = await this.getDownloadService()
    return await service.probeAllSources()
  }

  /**
   * 手动导入：目录布局与缓存目录一致，校验通过后落盘。
   * @returns 缺失或校验失败的文件；为空表示成功。
   */
  async importLocalModel(sourceDir: string): Promise<string[]> {
    return await importLocalModel(this.cacheDir, sourceDir)
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<EmbeddingServiceConfig>): void {
    this.config = { ...this.config, ...config }
  }

  private getLocalBackend(): LocalEmbeddingBackend {
    if (!this.localBackend) {
      this.localBackend = new LocalEmbeddingBackend({
        cacheDir: this.cacheDir,
        loadTransformers: this.loadTransformers
      })
    }
    return this.localBackend
  }

  private async getDownloadService(): Promise<ModelDownloadService> {
    if (this.downloadService) {
      return this.downloadService
    }

    const configured = await this.getSources()
    const sources = configured.length > 0 ? configured : [...DEFAULT_SOURCES]

    this.downloadService = new ModelDownloadService({
      cacheDir: this.cacheDir,
      sources,
      onProgress: (progress) => {
        this.downloadProgressListener?.(progress)
        this.onDownloadProgress?.(progress)
      }
    })
    return this.downloadService
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
          const delay = this.config.retryDelay * Math.pow(2, attempt - 1)
          await this.sleep(delay)
        }
      }
    }

    throw lastError
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
