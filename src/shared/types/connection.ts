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
 * Reasoning effort a model may be asked to spend, where its protocol supports it
 * (#179). A lower effort leaves more of the output budget for the visible answer,
 * which is the other way out of a truncated reasoning answer besides continuing it.
 */
export const REASONING_EFFORTS = ['low', 'medium', 'high'] as const

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

/**
 * 单个 Model Connection
 */
export interface ModelConnection {
  protocol: APIProtocol
  baseUrl: string
  apiKey: string
  modelId: string
  /**
   * The ceiling on generated tokens, or absent for the model's own default.
   *
   * Absent is the default on purpose: a reasoning model's thinking shares this
   * budget with its answer, so a ceiling that is right for one model is wrong for
   * another — per-connection, like the model id itself.
   */
  maxOutputTokens?: number
  /**
   * The model's context window in tokens, when the user knows it (#179).
   *
   * Metadata, not a request parameter: KnowNote does not trim the prompt against
   * it. It exists so a connection can describe its model, and so a future trims
   * have something to read.
   */
  contextWindow?: number
  /**
   * Whether this model spends output budget on reasoning (#179). When true the
   * connection's output ceiling covers thinking as well as the answer.
   */
  reasoning?: boolean
  /**
   * How much effort the model should spend thinking, for protocols that take it.
   * Unknown OpenAI-compatible endpoints keep behaving exactly as before when this
   * is absent — nothing is sent.
   */
  reasoningEffort?: ReasoningEffort
  /**
   * An explicit reasoning token budget, for protocols that take one (Anthropic
   * thinking, Gemini thinkingConfig). Absent means the provider's default.
   */
  reasoningBudget?: number
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
