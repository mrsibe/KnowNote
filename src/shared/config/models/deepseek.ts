import { ModelType } from '../../types'
import type { ProviderLocalModels } from './types'

/**
 * DeepSeek 내장 모델 목록
 * cherry-studio 및 공식 문서 기반
 * 마지막 업데이트: 2025-01-15
 */
export const DEEPSEEK_BUILTIN_MODELS: ProviderLocalModels = {
  providerName: 'deepseek',
  lastUpdated: '2025-01-15',
  models: [
    {
      id: 'deepseek-chat',
      type: ModelType.CHAT,
      owned_by: 'deepseek',
      max_context: 64000,
      description: 'DeepSeek Chat'
    },
    {
      id: 'deepseek-reasoner',
      type: ModelType.CHAT,
      owned_by: 'deepseek',
      max_context: 64000,
      description: 'DeepSeek Reasoner'
    }
  ]
}
