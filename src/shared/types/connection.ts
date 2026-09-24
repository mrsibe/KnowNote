/**
 * Model Connection 类型定义
 *
 * 一个 Model Connection = API Protocol + Base URL + API Key + Model ID。
 * KnowNote 不认识任何厂商：兼容 OpenAI API 的服务一律只是
 * "OpenAI-compatible endpoint"。能力(capability)与连接解耦，由用户显式声明
 * 该连接用于 chat 还是 embedding，代码不再猜测模型类型。
 */

/**
 * 支持的 API 协议。新增协议只需实现一个 protocol adapter。
 */
export const API_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai'
] as const

export type APIProtocol = (typeof API_PROTOCOLS)[number]

/**
 * 连接的能力标签。RAG 链路同时需要 chat 与 embedding，
 * 之后接入 rerank 时在这里继续扩展。
 */
export const MODEL_CAPABILITIES = ['chat', 'embedding'] as const

export type ModelCapability = (typeof MODEL_CAPABILITIES)[number]

/**
 * 支持 embedding 的协议。Anthropic Messages 不提供 embedding 端点。
 */
export const EMBEDDING_CAPABLE_PROTOCOLS: readonly APIProtocol[] = [
  'openai-completions',
  'openai-responses',
  'google-generative-ai'
]

export function protocolSupportsEmbedding(protocol: APIProtocol): boolean {
  return EMBEDDING_CAPABLE_PROTOCOLS.includes(protocol)
}

/**
 * 单个 Model Connection
 */
export interface ModelConnection {
  protocol: APIProtocol
  baseUrl: string
  apiKey: string
  modelId: string
}

/**
 * 按 capability 索引的连接集合。缺失的能力表示未配置。
 */
export type ConnectionMap = Partial<Record<ModelCapability, ModelConnection>>

/**
 * 连接测试结果
 */
export interface ConnectionTestResult {
  ok: boolean
  error?: string
}
