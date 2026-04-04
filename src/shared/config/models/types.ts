import { ModelType } from '../../types'

/**
 * 로컬 모델 정의 (간소화 버전, 정적 설정용)
 */
export interface LocalModelDefinition {
  id: string
  type: ModelType
  owned_by?: string
  max_context?: number // 최대 컨텍스트 길이
  description?: string // 모델 설명 (선택)
}

/**
 * Provider 로컬 모델 목록 설정
 */
export interface ProviderLocalModels {
  providerName: string
  lastUpdated: string // ISO 날짜 문자열, 업데이트 시간 추적 용이
  models: LocalModelDefinition[]
}
