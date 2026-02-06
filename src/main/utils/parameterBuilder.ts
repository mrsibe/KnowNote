/**
 * 参数构建器
 * 参考 cherry-studio 的 parameterBuilder 实现
 */

import type { APIMessage } from '../../shared/types/chat'
import type { LLMProviderConfig } from '../providers/types'

export interface BuildParamsResult {
  params: {
    messages: any[]
    temperature?: number
    maxOutputTokens?: number
    topP?: number
    abortSignal?: AbortSignal
  }
  capabilities: {
    enableReasoning: boolean
    enableWebSearch: boolean
  }
}

/**
 * 构建 AI SDK 流式参数
 */
export async function buildStreamTextParams(
  messages: APIMessage[],
  config: LLMProviderConfig,
  options?: {
    signal?: AbortSignal
    timeout?: number
  }
): Promise<BuildParamsResult> {
  // 转换消息格式
  const coreMessages = messages.map((msg) => ({
    role: msg.role,
    content: msg.content
  }))

  // 构建基础参数
  const params = {
    messages: coreMessages,
    temperature: config.temperature,
    maxOutputTokens: config.maxTokens,
    topP: config.topP,
    abortSignal: options?.signal
  }

  // 检测能力
  const capabilities = {
    enableReasoning: detectReasoningCapability(config),
    enableWebSearch: false // KnowNote 暂不支持
  }

  return { params, capabilities }
}

/**
 * 检测推理能力
 */
function detectReasoningCapability(config: LLMProviderConfig): boolean {
  // 根据模型 ID 判断是否支持推理
  const modelId = config.model?.toLowerCase() || ''
  return (
    modelId.includes('o1') ||
    modelId.includes('o3') ||
    modelId.includes('deepseek-reasoner') ||
    modelId.includes('qwen-plus') ||
    modelId.includes('qwen-max')
  )
}
