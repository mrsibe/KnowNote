export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'openrouter'
  | 'ollama'
  | 'deepseek'
  | 'zhipu'
  | 'moonshot'
  | 'doubao'
  | 'minimax'
  | 'silicon'
  | 'custom'

export interface Provider {
  id: string
  type: ProviderType
  name: string
  apiKey: string
  apiHost: string
  anthropicApiHost?: string // 用于支持 Anthropic 兼容的供应商
  apiVersion?: string
  models: any[] // 将在 model.ts 中定义具体类型
  enabled?: boolean
  isSystem?: boolean

  // API 选项
  apiOptions?: {
    isNotSupportArrayContent?: boolean
    isNotSupportStreamOptions?: boolean
    isSupportDeveloperRole?: boolean
    isSupportServiceTier?: boolean
  }

  // Anthropic prompt caching
  anthropicCacheControl?: {
    tokenThreshold: number
    cacheSystemMessage: boolean
    cacheLastNMessages: number
  }

  // 其他配置
  serviceTier?: 'auto' | 'default' | 'flex' | 'priority'
  extra_headers?: Record<string, string>
  rateLimit?: number
  isAuthed?: boolean
  notes?: string
}

// 辅助类型：至少包含某些属性
export type AtLeast<T, K extends string> = Partial<T> & Record<K, any>

// SystemProvider 类型（用于配置）
export type SystemProvider = Provider & {
  isSystem: true
  isVertex?: boolean  // 用于 Gemini/VertexAI 区分
}

// OpenAI Service Tiers
export const OpenAIServiceTiers = {
  AUTO: 'auto',
  DEFAULT: 'default',
  FLEX: 'flex',
  PRIORITY: 'priority'
} as const

export const SystemProviderIds = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  GROQ: 'groq',
  OPENROUTER: 'openrouter',
  OLLAMA: 'ollama',
  DEEPSEEK: 'deepseek',
  ZHIPU: 'zhipu',
  MOONSHOT: 'moonshot',
  DOUBAO: 'doubao',
  MINIMAX: 'minimax',
  SILICON: 'silicon'
} as const

export type SystemProviderId = string

// 辅助函数：检查是否为系统供应商 ID
export function isSystemProviderId(id: string): boolean {
  return Object.values(SystemProviderIds).includes(id as any)
}

export interface ProviderConfig {
  providerName: string
  config: Record<string, any>
  enabled: boolean
  updatedAt: number
}

export interface CustomProviderConfig {
  providerName: string
  displayName: string
  baseUrl: string
  apiKey: string
}
