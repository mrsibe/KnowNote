/**
 * openai-completions 协议
 *
 * OpenAI Chat Completions API。覆盖绝大多数服务：OpenAI、DeepSeek、Qwen、
 * Kimi、SiliconFlow、智谱、Ollama、LM Studio、vLLM、SGLang、OpenRouter 等。
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { EmbeddingModel, LanguageModel } from 'ai'
import type { ModelConnection } from '../../../shared/types/connection'
import type { ProtocolAdapter } from './types'
import { listOpenAICompatibleModels } from './modelListing'

export const PROVIDER_OPTIONS_KEY = 'openai-compatible'

function createProvider(connection: ModelConnection) {
  return createOpenAICompatible({
    name: PROVIDER_OPTIONS_KEY,
    baseURL: connection.baseUrl,
    apiKey: connection.apiKey
  })
}

export const openaiCompletionsAdapter: ProtocolAdapter = {
  protocol: 'openai-completions',

  createLanguageModel(connection): LanguageModel {
    return createProvider(connection)(connection.modelId)
  },

  createEmbeddingModel(connection): EmbeddingModel {
    return createProvider(connection).textEmbeddingModel(connection.modelId)
  },

  embeddingProviderOptions(_connection, dimensions) {
    return dimensions ? { [PROVIDER_OPTIONS_KEY]: { dimensions } } : undefined
  },

  supportsModelListing: true,

  listModels: listOpenAICompatibleModels
}
