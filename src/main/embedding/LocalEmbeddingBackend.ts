/**
 * LocalEmbeddingBackend
 *
 * 内置本地 embedding 后端：只用 ONNX runtime 在本地推理，权重由 ModelDownloadService
 * 按需下载并预置到 transformers.js 的缓存目录。推理时 `env.allowRemoteModels = false`，
 * transformers.js 全程不触网。
 *
 * E5 系列要求 query / document 使用不同前缀，中文也用英文前缀；不加会掉检索效果。
 */

import type { EmbeddingPurpose, EmbeddingSpace } from '../../shared/types'
import { LOCAL_EMBEDDING_MODEL } from './localModel'
import { getLocalSpace } from './space'
import type { BackendEmbeddingResult, EmbeddingBackend } from './types'

/**
 * feature-extraction pipeline 的最小结构。
 *
 * 只依赖真正调用的部分，避免把 transformers.js 的类型引入主进程的编译依赖。
 */
export interface FeatureExtractionPipeline {
  (
    texts: string[],
    options: {
      pooling: 'mean' | 'cls' | 'last_token'
      normalize: boolean
      truncation: boolean
      max_length: number
    }
  ): Promise<{ tolist(): number[][] }>
  dispose?: () => Promise<void>
}

/**
 * 动态加载 transformers.js。测试里可以注入假实现，因此做成可覆盖的加载器。
 */
export type TransformersModuleLoader = () => Promise<{
  pipeline: (
    task: 'feature-extraction',
    model: string,
    options: Record<string, unknown>
  ) => Promise<FeatureExtractionPipeline>
  env: {
    cacheDir: string | null
    allowRemoteModels: boolean
    allowLocalModels: boolean
    useFSCache: boolean
  }
}>

export interface LocalEmbeddingBackendOptions {
  /** userData/models */
  cacheDir: string
  /** 下载进度回调（0-1） */
  onLoadProgress?: (progress: number) => void
  loadTransformers?: TransformersModuleLoader
}

const defaultLoader: TransformersModuleLoader = async () => {
  const transformers = await import('@huggingface/transformers')
  // SAFETY: transformers.js exposes `pipeline`/`env` with the same runtime shape as the
  // minimal interface above; only the fields this file calls are relied on, and the full
  // library type surface is deliberately kept out of the main-process compile graph.
  return transformers as unknown as Awaited<ReturnType<TransformersModuleLoader>>
}

/**
 * 给文本加上 E5 的前缀
 */
export function applyEmbeddingPrefix(text: string, purpose: EmbeddingPurpose): string {
  const prefix =
    purpose === 'query' ? LOCAL_EMBEDDING_MODEL.queryPrefix : LOCAL_EMBEDDING_MODEL.documentPrefix
  return `${prefix}${text}`
}

export class LocalEmbeddingBackend implements EmbeddingBackend {
  readonly kind = 'local' as const

  private readonly cacheDir: string
  private readonly onLoadProgress?: (progress: number) => void
  private readonly loadTransformers: TransformersModuleLoader
  private readonly space: EmbeddingSpace = getLocalSpace()

  private extractor: FeatureExtractionPipeline | null = null
  private loading: Promise<FeatureExtractionPipeline> | null = null

  constructor(options: LocalEmbeddingBackendOptions) {
    this.cacheDir = options.cacheDir
    this.onLoadProgress = options.onLoadProgress
    this.loadTransformers = options.loadTransformers ?? defaultLoader
  }

  getSpace(): EmbeddingSpace {
    return this.space
  }

  async isReady(): Promise<boolean> {
    return this.extractor !== null
  }

  async embed(text: string, purpose: EmbeddingPurpose): Promise<BackendEmbeddingResult> {
    const results = await this.embedBatch([text], purpose)
    return results[0]
  }

  async embedBatch(
    texts: string[],
    purpose: EmbeddingPurpose,
    onProgress?: (completed: number, total: number) => void
  ): Promise<BackendEmbeddingResult[]> {
    if (texts.length === 0) {
      return []
    }

    const extractor = await this.getExtractor()
    const prepared = texts.map((text) => applyEmbeddingPrefix(text, purpose))

    const output = await extractor(prepared, {
      pooling: LOCAL_EMBEDDING_MODEL.pooling,
      normalize: LOCAL_EMBEDDING_MODEL.normalize,
      truncation: true,
      max_length: LOCAL_EMBEDDING_MODEL.maxLength
    })

    const vectors = output.tolist()
    const results = vectors.map((vector) => ({
      embedding: Float32Array.from(vector),
      model: LOCAL_EMBEDDING_MODEL.id,
      dimensions: vector.length
    }))

    onProgress?.(results.length, texts.length)
    return results
  }

  /**
   * 释放 ONNX session
   */
  async dispose(): Promise<void> {
    if (this.extractor?.dispose) {
      await this.extractor.dispose()
    }
    this.extractor = null
    this.loading = null
  }

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    if (this.extractor) {
      return this.extractor
    }
    if (this.loading) {
      return this.loading
    }

    this.loading = this.createExtractor()
    try {
      this.extractor = await this.loading
      return this.extractor
    } finally {
      this.loading = null
    }
  }

  private async createExtractor(): Promise<FeatureExtractionPipeline> {
    const { pipeline, env } = await this.loadTransformers()

    // 权重由自研下载器预置到缓存目录；关掉远端模型，避免 transformers.js 自己触网
    // （它的下载器不校验、不续传、不重试）。
    env.cacheDir = this.cacheDir
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.useFSCache = true

    return pipeline('feature-extraction', LOCAL_EMBEDDING_MODEL.id, {
      dtype: LOCAL_EMBEDDING_MODEL.dtype,
      revision: LOCAL_EMBEDDING_MODEL.revision,
      progress_callback: (event: { status?: string; progress?: number }) => {
        if (event?.status === 'progress' && typeof event.progress === 'number') {
          this.onLoadProgress?.(event.progress / 100)
        }
      }
    })
  }
}
