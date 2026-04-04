import { ModelType } from '../../types'
import type { ProviderLocalModels } from './types'

/**
 * OpenAI 내장 모델 목록
 * cherry-studio 및 공식 문서 기반
 * 마지막 업데이트: 2025-01-15
 */
export const OPENAI_BUILTIN_MODELS: ProviderLocalModels = {
  providerName: 'openai',
  lastUpdated: '2025-01-15',
  models: [
    // GPT-5 시리즈 (cherry-studio)
    {
      id: 'gpt-5.1',
      type: ModelType.CHAT,
      owned_by: 'openai',
      max_context: 128000,
      description: 'GPT 5.1'
    },
    {
      id: 'gpt-5',
      type: ModelType.CHAT,
      owned_by: 'openai',
      max_context: 128000,
      description: 'GPT 5'
    },
    {
      id: 'gpt-5-mini',
      type: ModelType.CHAT,
      owned_by: 'openai',
      max_context: 128000,
      description: 'GPT 5 Mini'
    },
    {
      id: 'gpt-5-nano',
      type: ModelType.CHAT,
      owned_by: 'openai',
      max_context: 128000,
      description: 'GPT 5 Nano'
    },
    {
      id: 'gpt-5-pro',
      type: ModelType.CHAT,
      owned_by: 'openai',
      max_context: 128000,
      description: 'GPT 5 Pro'
    },
    {
      id: 'gpt-5-chat',
      type: ModelType.CHAT,
      owned_by: 'openai',
      max_context: 128000,
      description: 'GPT 5 Chat'
    },

    // GPT-4 시리즈
    {
      id: 'gpt-4o',
      type: ModelType.CHAT,
      owned_by: 'openai',
      max_context: 128000,
      description: 'GPT-4o - 최신 멀티모달 모델'
    },
    {
      id: 'gpt-4o-mini',
      type: ModelType.CHAT,
      owned_by: 'openai',
      max_context: 128000,
      description: 'GPT-4o Mini'
    },
    {
      id: 'gpt-4-turbo',
      type: ModelType.CHAT,
      owned_by: 'openai',
      max_context: 128000,
      description: 'GPT-4 Turbo'
    },
    {
      id: 'gpt-4',
      type: ModelType.CHAT,
      owned_by: 'openai',
      max_context: 8192,
      description: 'GPT-4'
    },
    {
      id: 'gpt-3.5-turbo',
      type: ModelType.CHAT,
      owned_by: 'openai',
      max_context: 16385,
      description: 'GPT-3.5 Turbo'
    },

    // 이미지 모델
    { id: 'gpt-image-1', type: ModelType.IMAGE, owned_by: 'openai', description: 'GPT Image 1' },
    { id: 'dall-e-3', type: ModelType.IMAGE, owned_by: 'openai', description: 'DALL-E 3' },
    { id: 'dall-e-2', type: ModelType.IMAGE, owned_by: 'openai', description: 'DALL-E 2' },

    // 임베딩 모델
    {
      id: 'text-embedding-3-large',
      type: ModelType.EMBEDDING,
      owned_by: 'openai',
      max_context: 8191,
      description: 'Embedding v3 Large - 3072 차원'
    },
    {
      id: 'text-embedding-3-small',
      type: ModelType.EMBEDDING,
      owned_by: 'openai',
      max_context: 8191,
      description: 'Embedding v3 Small - 1536 차원'
    },
    {
      id: 'text-embedding-ada-002',
      type: ModelType.EMBEDDING,
      owned_by: 'openai',
      max_context: 8191,
      description: 'Embedding Ada 002'
    },

    // 오디오 모델
    {
      id: 'whisper-1',
      type: ModelType.AUDIO,
      owned_by: 'openai',
      description: 'Whisper - 음성 텍스트 변환'
    },
    { id: 'tts-1', type: ModelType.AUDIO, owned_by: 'openai', description: 'TTS v1' },
    { id: 'tts-1-hd', type: ModelType.AUDIO, owned_by: 'openai', description: 'TTS v1 HD' }
  ]
}
