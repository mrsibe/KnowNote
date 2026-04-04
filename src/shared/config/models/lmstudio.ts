import { ModelType } from '../../types'
import type { ProviderLocalModels } from './types'

/**
 * LM Studio 기본 모델 목록
 * LM Studio는 로컬 LLM 서버로, 사용자가 모델을 직접 로드합니다.
 * 아래는 자주 사용되는 모델의 참조 목록이며, 실제 사용 가능한 모델은 LM Studio에서 로드한 모델에 따라 달라집니다.
 */
export const LMSTUDIO_BUILTIN_MODELS: ProviderLocalModels = {
  providerName: 'lmstudio',
  lastUpdated: '2026-04-04',
  models: [
    // Chat Models
    {
      id: 'llama-3.2-3b-instruct',
      type: ModelType.CHAT,
      owned_by: 'meta',
      max_context: 131072,
      description: 'Llama 3.2 3B Instruct'
    },
    {
      id: 'llama-3.1-8b-instruct',
      type: ModelType.CHAT,
      owned_by: 'meta',
      max_context: 131072,
      description: 'Llama 3.1 8B Instruct'
    },
    {
      id: 'qwen2.5-7b-instruct',
      type: ModelType.CHAT,
      owned_by: 'qwen',
      max_context: 32768,
      description: 'Qwen 2.5 7B Instruct'
    },
    {
      id: 'mistral-7b-instruct-v0.3',
      type: ModelType.CHAT,
      owned_by: 'mistral',
      max_context: 32768,
      description: 'Mistral 7B Instruct v0.3'
    },
    {
      id: 'gemma-2-9b-it',
      type: ModelType.CHAT,
      owned_by: 'google',
      max_context: 8192,
      description: 'Gemma 2 9B IT'
    },
    {
      id: 'deepseek-r1-distill-qwen-7b',
      type: ModelType.CHAT,
      owned_by: 'deepseek',
      max_context: 65536,
      description: 'DeepSeek R1 Distill Qwen 7B'
    },

    // Embedding Models
    {
      id: 'text-embedding-nomic-embed-text-v1.5',
      type: ModelType.EMBEDDING,
      owned_by: 'nomic-ai',
      max_context: 8192,
      description: 'Nomic Embed Text v1.5 - 768 차원'
    },
    {
      id: 'text-embedding-bge-m3',
      type: ModelType.EMBEDDING,
      owned_by: 'BAAI',
      max_context: 8191,
      description: 'BGE M3 - 1024 차원'
    }
  ]
}
