/**
 * EmbeddingBackend 抽象。
 *
 * EmbeddingService 只表达"我要 embedding"，不认识 ONNX / OpenAI / Ollama；具体后端实现
 * 这个接口即可。
 */

import type { EmbeddingPurpose, EmbeddingSpace } from '../../shared/types'

/**
 * 后端返回的单个向量
 */
export interface BackendEmbeddingResult {
  embedding: Float32Array
  model: string
  dimensions: number
  tokensUsed?: number
}

/**
 * 一个 embedding 后端
 */
export interface EmbeddingBackend {
  readonly kind: 'local' | 'remote'

  /** 该后端产出的 embedding space 身份 */
  getSpace(): EmbeddingSpace

  /** 后端当前是否可用（本地模型已安装、远程连接已配置等） */
  isReady(): Promise<boolean>

  /** 生成单个文本的向量 */
  embed(text: string, purpose: EmbeddingPurpose): Promise<BackendEmbeddingResult>

  /** 批量生成向量 */
  embedBatch(
    texts: string[],
    purpose: EmbeddingPurpose,
    onProgress?: (completed: number, total: number) => void
  ): Promise<BackendEmbeddingResult[]>
}
