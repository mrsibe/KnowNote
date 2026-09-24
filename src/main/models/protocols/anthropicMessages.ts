/**
 * anthropic-messages 协议
 *
 * Anthropic Messages API。Anthropic 不提供 embedding 端点。
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import type { EmbeddingModel, LanguageModel } from 'ai'
import type { ModelConnection } from '../../../shared/types/connection'
import type { ProtocolAdapter } from './types'
import { listAnthropicModels } from './modelListing'

function createProvider(connection: ModelConnection) {
  return createAnthropic({
    baseURL: connection.baseUrl,
    apiKey: connection.apiKey
  })
}

export const anthropicMessagesAdapter: ProtocolAdapter = {
  protocol: 'anthropic-messages',

  createLanguageModel(connection): LanguageModel {
    return createProvider(connection)(connection.modelId)
  },

  createEmbeddingModel(): EmbeddingModel {
    throw new Error('The anthropic-messages protocol does not support embeddings')
  },

  supportsModelListing: true,

  listModels: listAnthropicModels
}
