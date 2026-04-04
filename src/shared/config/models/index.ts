import { Model } from '../../types'
import { OPENAI_BUILTIN_MODELS } from './openai'
import { DEEPSEEK_BUILTIN_MODELS } from './deepseek'
import { OLLAMA_BUILTIN_MODELS } from './ollama'
import { LMSTUDIO_BUILTIN_MODELS } from './lmstudio'
import type { ProviderLocalModels, LocalModelDefinition } from './types'

/**
 * 모든 Provider의 내장 모델 설정
 */
const BUILTIN_MODELS_MAP: Record<string, ProviderLocalModels> = {
  lmstudio: LMSTUDIO_BUILTIN_MODELS,
  ollama: OLLAMA_BUILTIN_MODELS,
  openai: OPENAI_BUILTIN_MODELS,
  deepseek: DEEPSEEK_BUILTIN_MODELS
}

/**
 * 로컬 모델 정의를 표준 Model 객체로 변환
 */
function convertToModel(def: LocalModelDefinition, providerName: string): Model {
  return {
    id: def.id,
    object: 'model',
    owned_by: def.owned_by,
    type: def.type,
    // lastUpdated를 created 타임스탬프(Unix timestamp)로 변환
    created: Math.floor(
      new Date(BUILTIN_MODELS_MAP[providerName]?.lastUpdated || Date.now()).getTime() / 1000
    )
  }
}

/**
 * 지정된 Provider의 내장 모델 목록 조회
 * @param providerName Provider 이름
 * @returns 내장 모델 목록, 없으면 빈 배열 반환
 */
export function getBuiltinModels(providerName: string): Model[] {
  const config = BUILTIN_MODELS_MAP[providerName]
  if (!config) {
    return []
  }

  return config.models.map((model) => convertToModel(model, providerName))
}

/**
 * 내장 모델 설정 존재 여부 확인
 * @param providerName Provider 이름
 * @returns 내장 모델 설정 존재 여부
 */
export function hasBuiltinModels(providerName: string): boolean {
  return providerName in BUILTIN_MODELS_MAP
}

/**
 * 모든 Provider의 내장 모델 목록 조회
 * @returns 모든 내장 모델의 매핑 테이블 { providerName: Model[] }
 */
export function getAllBuiltinModels(): Record<string, Model[]> {
  const result: Record<string, Model[]> = {}

  for (const providerName in BUILTIN_MODELS_MAP) {
    result[providerName] = getBuiltinModels(providerName)
  }

  return result
}

/**
 * 타입별 내장 모델 필터링
 * @param providerName Provider 이름
 * @param type 모델 타입
 * @returns 필터링된 모델 목록
 */
export function getBuiltinModelsByType(providerName: string, type: string): Model[] {
  const models = getBuiltinModels(providerName)
  return models.filter((m) => m.type === type)
}

/**
 * 내장 모델 통계 정보 조회
 */
export function getBuiltinModelsStats(): {
  totalProviders: number
  totalModels: number
  byProvider: Record<string, number>
  byType: Record<string, number>
} {
  const byProvider: Record<string, number> = {}
  const byType: Record<string, number> = {}
  let totalModels = 0

  for (const providerName in BUILTIN_MODELS_MAP) {
    const models = BUILTIN_MODELS_MAP[providerName].models
    byProvider[providerName] = models.length
    totalModels += models.length

    models.forEach((model) => {
      const type = model.type.toString()
      byType[type] = (byType[type] || 0) + 1
    })
  }

  return {
    totalProviders: Object.keys(BUILTIN_MODELS_MAP).length,
    totalModels,
    byProvider,
    byType
  }
}

// 타입 내보내기
export * from './types'
