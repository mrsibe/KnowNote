/**
 * AI Core 类型定义 - 简化版本
 */

export type OpenAIVerbosity = 'low' | 'medium' | 'high'
export type ValidOpenAIVerbosity = OpenAIVerbosity

export interface Assistant {
  id: string
  name: string
  provider: string
  model: string
}

export const SystemProviderIds = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  AZURE: 'azure',
  DEEPSEEK: 'deepseek',
  QWEN: 'qwen',
  OLLAMA: 'ollama'
} as const
