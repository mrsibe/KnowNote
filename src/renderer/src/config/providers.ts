// 核心供应商 Logo 导入
import AnthropicProviderLogo from '@renderer/assets/providers/anthropic.png'
import DeepSeekProviderLogo from '@renderer/assets/providers/deepseek.png'
import GoogleProviderLogo from '@renderer/assets/providers/google.png'
import GroqProviderLogo from '@renderer/assets/providers/groq.png'
import MinimaxProviderLogo from '@renderer/assets/providers/minimax.png'
import MoonshotProviderLogo from '@renderer/assets/providers/moonshot.webp'
import OllamaProviderLogo from '@renderer/assets/providers/ollama.png'
import OpenAiProviderLogo from '@renderer/assets/providers/openai.png'
import OpenRouterProviderLogo from '@renderer/assets/providers/openrouter.png'
import SiliconFlowProviderLogo from '@renderer/assets/providers/silicon.png'
import BytedanceProviderLogo from '@renderer/assets/providers/volcengine.png'
import ZhipuProviderLogo from '@renderer/assets/providers/zhipu.png'

import type { SystemProvider, SystemProviderId } from '@shared/types/provider'
import { OpenAIServiceTiers } from '@shared/types/provider'
import { SYSTEM_MODELS } from './models'

export const SYSTEM_PROVIDERS_CONFIG: Record<SystemProviderId, SystemProvider> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.openai.com',
    models: SYSTEM_MODELS.openai || [],
    isSystem: true,
    enabled: false,
    serviceTier: OpenAIServiceTiers.AUTO
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    apiKey: '',
    apiHost: 'https://api.anthropic.com',
    models: SYSTEM_MODELS.anthropic || [],
    isSystem: true,
    enabled: false
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    type: 'gemini',
    apiKey: '',
    apiHost: 'https://generativelanguage.googleapis.com',
    models: SYSTEM_MODELS.gemini || [],
    isSystem: true,
    enabled: false,
    isVertex: false
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.groq.com/openai',
    models: SYSTEM_MODELS.groq || [],
    isSystem: true,
    enabled: false
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://openrouter.ai/api/v1/',
    models: SYSTEM_MODELS.openrouter || [],
    isSystem: true,
    enabled: false
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    type: 'ollama',
    apiKey: '',
    apiHost: 'http://localhost:11434',
    models: SYSTEM_MODELS.ollama || [],
    isSystem: true,
    enabled: false
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.deepseek.com',
    anthropicApiHost: 'https://api.deepseek.com/anthropic',
    models: SYSTEM_MODELS.deepseek || [],
    isSystem: true,
    enabled: false
  },
  zhipu: {
    id: 'zhipu',
    name: 'ZhiPu',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://open.bigmodel.cn/api/paas/v4/',
    anthropicApiHost: 'https://open.bigmodel.cn/api/anthropic',
    models: SYSTEM_MODELS.zhipu || [],
    isSystem: true,
    enabled: false
  },
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.moonshot.cn',
    models: SYSTEM_MODELS.moonshot || [],
    isSystem: true,
    enabled: false
  },
  doubao: {
    id: 'doubao',
    name: 'Doubao',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://ark.cn-beijing.volces.com/api/v3',
    models: SYSTEM_MODELS.doubao || [],
    isSystem: true,
    enabled: false
  },
  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.minimax.chat',
    models: SYSTEM_MODELS.minimax || [],
    isSystem: true,
    enabled: false
  },
  silicon: {
    id: 'silicon',
    name: 'Silicon',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.siliconflow.cn',
    anthropicApiHost: 'https://api.siliconflow.cn',
    models: SYSTEM_MODELS.silicon || [],
    isSystem: true,
    enabled: false
  }
}

export const PROVIDER_LOGO_MAP: Record<string, string> = {
  openai: OpenAiProviderLogo,
  anthropic: AnthropicProviderLogo,
  gemini: GoogleProviderLogo,
  groq: GroqProviderLogo,
  openrouter: OpenRouterProviderLogo,
  ollama: OllamaProviderLogo,
  deepseek: DeepSeekProviderLogo,
  zhipu: ZhipuProviderLogo,
  moonshot: MoonshotProviderLogo,
  doubao: BytedanceProviderLogo,
  minimax: MinimaxProviderLogo,
  silicon: SiliconFlowProviderLogo
} as const

export function getProviderLogo(providerId: string) {
  return PROVIDER_LOGO_MAP[providerId as keyof typeof PROVIDER_LOGO_MAP]
}

export const NOT_SUPPORTED_RERANK_PROVIDERS = ['ollama'] as const satisfies SystemProviderId[]
export const ONLY_SUPPORTED_DIMENSION_PROVIDERS = ['ollama'] as const satisfies SystemProviderId[]
