/**
 * Builtin Providers
 * 内置供应商配置注册表
 */

import type { ProviderDescriptor } from './ProviderDescriptor'
import { AISDKProvider } from '../base/AISDKProvider'

/**
 * 内置供应商注册表
 * 所有内置供应商都在这里定义
 *
 * 添加新的内置供应商只需在这个数组中添加配置即可
 */
export const BUILTIN_PROVIDERS: ProviderDescriptor[] = [
  {
    name: 'openai',
    displayName: 'OpenAI',
    isBuiltin: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultChatModel: 'gpt-4o',
    defaultEmbeddingModel: 'text-embedding-3-small',
    capabilities: {
      chat: true,
      embedding: true
    },
    createProvider: (descriptor) => new AISDKProvider(descriptor)
  },

  {
    name: 'atlascloud',
    displayName: 'Atlas Cloud',
    isBuiltin: true,
    defaultBaseUrl: 'https://api.atlascloud.ai/v1',
    defaultChatModel: 'openai/gpt-4.1-mini',
    capabilities: {
      chat: true,
      embedding: false
    },
    createProvider: (descriptor) => new AISDKProvider(descriptor)
  },

  {
    name: 'deepseek',
    displayName: 'DeepSeek',
    isBuiltin: true,
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultChatModel: 'deepseek-chat',
    defaultEmbeddingModel: 'deepseek-embedding', // 假设 DeepSeek 支持 embedding
    capabilities: {
      chat: true,
      embedding: true
    },
    createProvider: (descriptor) => new AISDKProvider(descriptor)
  },

  {
    name: 'qwen',
    displayName: 'Qwen',
    isBuiltin: true,
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultChatModel: 'qwen-max',
    defaultEmbeddingModel: 'text-embedding-v2',
    capabilities: {
      chat: true,
      embedding: true
    },
    createProvider: (descriptor) => new AISDKProvider(descriptor)
  },

  {
    name: 'kimi',
    displayName: 'Kimi',
    isBuiltin: true,
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultChatModel: 'kimi-k2-turbo-preview',
    capabilities: {
      chat: true,
      embedding: false // Kimi 不支持 embedding
    },
    createProvider: (descriptor) => new AISDKProvider(descriptor)
  },

  {
    name: 'siliconflow',
    displayName: 'SiliconFlow',
    isBuiltin: true,
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    defaultChatModel: 'deepseek-ai/DeepSeek-V3',
    defaultEmbeddingModel: 'BAAI/bge-m3',
    capabilities: {
      chat: true,
      embedding: true // SiliconFlow 作为模型聚合平台支持 embedding
    },
    createProvider: (descriptor) => new AISDKProvider(descriptor)
  },

  {
    name: 'ollama',
    displayName: 'Ollama',
    isBuiltin: true,
    defaultBaseUrl: 'http://localhost:11434/api',
    capabilities: {
      chat: true,
      embedding: true
    },
    createProvider: (descriptor) => new AISDKProvider(descriptor)
  },

  {
    name: 'zhipu',
    displayName: '智谱AI',
    isBuiltin: true,
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultChatModel: 'glm-4-plus',
    defaultEmbeddingModel: 'embedding-3',
    capabilities: {
      chat: true,
      embedding: true
    },
    createProvider: (descriptor) => new AISDKProvider(descriptor)
  }
]

/**
 * 根据名称获取内置供应商描述符
 * @param name - 供应商名称
 * @returns ProviderDescriptor 或 undefined
 */
export function getBuiltinProvider(name: string): ProviderDescriptor | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.name === name)
}

/**
 * 检查是否为内置供应商
 * @param name - 供应商名称
 * @returns 是否为内置供应商
 */
export function isBuiltinProvider(name: string): boolean {
  return BUILTIN_PROVIDERS.some((p) => p.name === name)
}
