/**
 * 내장 프로바이더
 * 내장 프로바이더 설정 레지스트리
 */

import type { ProviderDescriptor } from './ProviderDescriptor'
import { AISDKProvider } from '../base/AISDKProvider'

/**
 * 내장 프로바이더 레지스트리
 * 모든 내장 프로바이더가 여기에 정의됩니다.
 *
 * 새로운 내장 프로바이더를 추가하려면 이 배열에 설정을 추가하면 됩니다.
 */
export const BUILTIN_PROVIDERS: ProviderDescriptor[] = [
  {
    name: 'lmstudio',
    displayName: 'LM Studio',
    isBuiltin: true,
    defaultBaseUrl: 'http://localhost:1234/v1',
    defaultChatModel: 'llama-3.2-3b-instruct',
    defaultEmbeddingModel: 'text-embedding-nomic-embed-text-v1.5',
    capabilities: {
      chat: true,
      embedding: true
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
    name: 'deepseek',
    displayName: 'DeepSeek',
    isBuiltin: true,
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultChatModel: 'deepseek-chat',
    defaultEmbeddingModel: 'deepseek-embedding',
    capabilities: {
      chat: true,
      embedding: true
    },
    createProvider: (descriptor) => new AISDKProvider(descriptor)
  }
]

/**
 * 이름으로 내장 프로바이더 디스크립터 조회
 * @param name - 프로바이더 이름
 * @returns ProviderDescriptor 또는 undefined
 */
export function getBuiltinProvider(name: string): ProviderDescriptor | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.name === name)
}

/**
 * 내장 프로바이더 여부 확인
 * @param name - 프로바이더 이름
 * @returns 내장 프로바이더 여부
 */
export function isBuiltinProvider(name: string): boolean {
  return BUILTIN_PROVIDERS.some((p) => p.name === name)
}
