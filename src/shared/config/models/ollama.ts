import { ModelType } from '../../types'
import type { ProviderLocalModels } from './types'

/**
 * Ollama 주요 모델 목록
 * 데이터 출처: https://ollama.com/library
 * 마지막 업데이트: 2025-01-15
 */
export const OLLAMA_BUILTIN_MODELS: ProviderLocalModels = {
  providerName: 'ollama',
  lastUpdated: '2025-01-15',
  models: [
    // Chat Models
    {
      id: 'llama3.2',
      type: ModelType.CHAT,
      owned_by: 'meta',
      max_context: 128000,
      description: 'Llama 3.2'
    },
    {
      id: 'llama3.1',
      type: ModelType.CHAT,
      owned_by: 'meta',
      max_context: 128000,
      description: 'Llama 3.1'
    },
    {
      id: 'qwen2.5',
      type: ModelType.CHAT,
      owned_by: 'qwen',
      max_context: 32768,
      description: 'Qwen 2.5'
    },
    {
      id: 'deepseek-r1',
      type: ModelType.CHAT,
      owned_by: 'deepseek',
      max_context: 64000,
      description: 'DeepSeek R1'
    },
    {
      id: 'mistral',
      type: ModelType.CHAT,
      owned_by: 'mistral',
      max_context: 32768,
      description: 'Mistral'
    },
    {
      id: 'gemma2',
      type: ModelType.CHAT,
      owned_by: 'google',
      max_context: 8192,
      description: 'Gemma 2'
    },

    // Embedding Models
    {
      id: 'nomic-embed-text',
      type: ModelType.EMBEDDING,
      owned_by: 'nomic-ai',
      max_context: 8192,
      description: 'Nomic Embed Text - 768 차원'
    },
    {
      id: 'mxbai-embed-large',
      type: ModelType.EMBEDDING,
      owned_by: 'mixedbread',
      max_context: 512,
      description: 'MXBai Embed Large - 1024 차원'
    },
    {
      id: 'all-minilm',
      type: ModelType.EMBEDDING,
      owned_by: 'sentence-transformers',
      max_context: 256,
      description: 'All MiniLM - 384 차원'
    },
    {
      id: 'bge-m3',
      type: ModelType.EMBEDDING,
      owned_by: 'BAAI',
      max_context: 8191,
      description: 'BGE M3 - 1024 차원'
    }
  ]
}
