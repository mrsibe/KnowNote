/**
 * google-generative-ai 协议
 *
 * Google Generative AI (Gemini) API，含 embedding 端点。
 */

import { createGoogle } from '@ai-sdk/google'
import type { EmbeddingModel, LanguageModel } from 'ai'
import type { ModelConnection } from '../../../shared/types/connection'
import type { ProtocolAdapter } from './types'
import { listGoogleModels } from './modelListing'

const PROVIDER_OPTIONS_KEY = 'google'

function createProvider(connection: ModelConnection) {
  return createGoogle({
    baseURL: connection.baseUrl,
    apiKey: connection.apiKey
  })
}

export const googleGenerativeAiAdapter: ProtocolAdapter = {
  protocol: 'google-generative-ai',

  createLanguageModel(connection): LanguageModel {
    return createProvider(connection)(connection.modelId)
  },

  createEmbeddingModel(connection): EmbeddingModel {
    return createProvider(connection).embedding(connection.modelId)
  },

  embeddingProviderOptions(_connection, dimensions) {
    return dimensions ? { [PROVIDER_OPTIONS_KEY]: { outputDimensionality: dimensions } } : undefined
  },

  /**
   * Gemini takes a thinking token budget rather than an effort level (#179), so
   * only an explicit budget is sent. No budget means the provider's default.
   */
  chatProviderOptions(connection) {
    return connection.reasoningBudget
      ? {
          [PROVIDER_OPTIONS_KEY]: { thinkingConfig: { thinkingBudget: connection.reasoningBudget } }
        }
      : undefined
  },

  supportsModelListing: true,

  listModels: listGoogleModels
}
