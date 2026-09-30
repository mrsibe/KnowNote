/**
 * openai-responses 协议
 *
 * OpenAI Responses API。与 openai-completions 的区别只在对话端点。
 */

import { createOpenAI } from '@ai-sdk/openai'
import type { EmbeddingModel, LanguageModel } from 'ai'
import type { ModelConnection } from '../../../shared/types/connection'
import type { ProtocolAdapter } from './types'
import { listOpenAICompatibleModels } from './modelListing'

const PROVIDER_OPTIONS_KEY = 'openai'

function createProvider(connection: ModelConnection) {
  return createOpenAI({
    baseURL: connection.baseUrl,
    apiKey: connection.apiKey
  })
}

export const openaiResponsesAdapter: ProtocolAdapter = {
  protocol: 'openai-responses',

  createLanguageModel(connection): LanguageModel {
    return createProvider(connection).responses(connection.modelId)
  },

  createEmbeddingModel(connection): EmbeddingModel {
    return createProvider(connection).embeddingModel(connection.modelId)
  },

  embeddingProviderOptions(_connection, dimensions) {
    return dimensions ? { [PROVIDER_OPTIONS_KEY]: { dimensions } } : undefined
  },

  /** OpenAI Responses takes the same effort vocabulary (#179). */
  chatProviderOptions(connection) {
    return connection.reasoningEffort
      ? { [PROVIDER_OPTIONS_KEY]: { reasoningEffort: connection.reasoningEffort } }
      : undefined
  },

  /**
   * AI SDK 6 把 `strictJsonSchema` 的默认值改为 true，而结构化输出服务用的 schema
   * 带 `.optional()` 字段，strict 模式会拒绝。显式关掉，保持与 v5 相同的请求体。
   */
  structuredOutputProviderOptions() {
    return { [PROVIDER_OPTIONS_KEY]: { strictJsonSchema: false } }
  },

  supportsModelListing: true,

  listModels: listOpenAICompatibleModels
}
