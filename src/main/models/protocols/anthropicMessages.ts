/**
 * anthropic-messages 协议
 *
 * Anthropic Messages API。Anthropic 不提供 embedding 端点。
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { EmbeddingModel, LanguageModel } from 'ai'
import type { ModelConnection } from '../../../shared/types/connection'
import type { ProtocolAdapter } from './types'
import { listAnthropicModels } from './modelListing'

const PROVIDER_OPTIONS_KEY = 'anthropic'

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

  /**
   * Anthropic takes an effort level, or an explicit thinking budget (#179). The
   * budget form is used when the user gave one, because it is the more specific
   * statement; otherwise the effort level is passed through.
   */
  chatProviderOptions(connection): SharedV2ProviderOptions | undefined {
    if (connection.reasoningBudget) {
      return {
        [PROVIDER_OPTIONS_KEY]: {
          thinking: { type: 'enabled', budgetTokens: connection.reasoningBudget }
        }
      }
    }
    return connection.reasoningEffort
      ? { [PROVIDER_OPTIONS_KEY]: { effort: connection.reasoningEffort } }
      : undefined
  },

  supportsModelListing: true,

  listModels: listAnthropicModels
}
