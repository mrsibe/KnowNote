/**
 * 模型调用相关的内部类型
 */

/**
 * Embedding 配置
 */
export interface EmbeddingConfig {
  /** 覆盖 connection 上的 modelId */
  model?: string
  /** 向量维度，部分模型支持 */
  dimensions?: number
}

/**
 * Embedding 结果
 */
export interface EmbeddingResult {
  embedding: Float32Array
  model: string
  dimensions: number
  tokensUsed: number
}
