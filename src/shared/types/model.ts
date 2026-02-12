export interface Model {
  id: string
  name?: string
  provider?: string
  group?: string
  object?: string
  owned_by?: string
  created?: number
  enabled?: boolean // 用户配置：是否启用此模型

  // 能力标记（自动检测）
  capabilities?:
    | {
        reasoning: boolean
        vision: boolean
        toolUse: boolean
        embedding: boolean
        websearch: boolean
      }
    | Array<{ type: string }>

  // 推理配置
  reasoningEffort?: 'low' | 'medium' | 'high' | 'auto' | 'minimal'
  thinkingModelType?: 'default' | 'o' | 'gpt5' | 'gemini2_flash' | 'deepseek_hybrid'

  // 元数据
  maxTokens?: number
  max_context?: number
  contextWindow?: number
  description?: string
  pricing?: {
    input?: number
    output?: number
    input_per_million_tokens?: number
    output_per_million_tokens?: number
    currencySymbol?: string
  }

  // 其他属性
  type?: ModelType
}

export type ReasoningEffortOption = 'low' | 'medium' | 'high' | 'auto' | 'minimal' | 'none'
export type ThinkingModelType =
  | 'default'
  | 'o'
  | 'gpt5'
  | 'gpt5_1'
  | 'gpt5_2'
  | 'gpt5_codex'
  | 'gpt5_1_codex'
  | 'gpt5_1_codex_max'
  | 'gpt52pro'
  | 'gpt5pro'
  | 'gpt_oss'
  | 'gemini2_flash'
  | 'gemini2_pro'
  | 'gemini3_flash'
  | 'gemini3_pro'
  | 'deepseek_hybrid'
  | 'openai_deep_research'
  | 'grok'
  | 'grok4_fast'
  | 'qwen'
  | 'qwen_thinking'
  | 'doubao'
  | 'doubao_after_251015'
  | 'doubao_no_auto'
  | 'hunyuan'
  | 'perplexity'
  | 'zhipu'
  | 'mimo'
  | 'kimi_k2_5'

export interface ReasoningEffortConfig {
  effort?: ReasoningEffortOption
  label?: string
  default?: boolean | readonly ReasoningEffortOption[]
  o?: any // 允许额外属性
  [key: string]: any // 允许任意额外属性
}

export interface ThinkingOptionConfig {
  type?: ThinkingModelType
  label?: string
  default?: boolean | readonly string[]
  o?: any // 允许额外属性
  [key: string]: any // 允许任意额外属性
}

export enum ModelType {
  CHAT = 'chat',
  EMBEDDING = 'embedding',
  RERANKER = 'reranker',
  IMAGE = 'image',
  AUDIO = 'audio',
  VIDEO = 'video',
  UNKNOWN = 'unknown'
}

export interface LocalModelDefinition {
  id: string
  type: ModelType
  owned_by?: string
  max_context?: number
  description?: string
}

export interface ProviderLocalModels {
  providerName: string
  lastUpdated: string
  models: LocalModelDefinition[]
}

export interface CategorizedModels {
  chat: Model[]
  embedding: Model[]
  reranker: Model[]
  other: Model[]
}
