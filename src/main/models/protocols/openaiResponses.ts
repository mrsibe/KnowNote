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
    return createProvider(connection).textEmbeddingModel(connection.modelId)
  },

  embeddingProviderOptions(_connection, dimensions) {
    return dimensions ? { [PROVIDER_OPTIONS_KEY]: { dimensions } } : undefined
  },

  supportsModelListing: true,

  listModels: listOpenAICompatibleModels
}
