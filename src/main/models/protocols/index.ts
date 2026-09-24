/**
 * Protocol adapter 注册表
 *
 * 按 protocol 分派到具体实现，业务代码不再按厂商名分支。
 */

import type { APIProtocol } from '../../../shared/types/connection'
import type { ProtocolAdapter } from './types'
import { openaiCompletionsAdapter } from './openaiCompletions'
import { openaiResponsesAdapter } from './openaiResponses'
import { anthropicMessagesAdapter } from './anthropicMessages'
import { googleGenerativeAiAdapter } from './googleGenerativeAi'

const ADAPTERS: Record<APIProtocol, ProtocolAdapter> = {
  'openai-completions': openaiCompletionsAdapter,
  'openai-responses': openaiResponsesAdapter,
  'anthropic-messages': anthropicMessagesAdapter,
  'google-generative-ai': googleGenerativeAiAdapter
}

export function getProtocolAdapter(protocol: APIProtocol): ProtocolAdapter {
  const adapter = ADAPTERS[protocol]
  if (!adapter) {
    throw new Error(`Unsupported API protocol: ${protocol}`)
  }
  return adapter
}

export type { ProtocolAdapter } from './types'
