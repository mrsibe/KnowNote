import { Model, ModelType, CategorizedModels } from '../types'
import { getAllBuiltinModels } from '../config/models'

/**
 * 내장 모델 타입 캐시 (빠른 조회용)
 */
let builtinModelTypeCache: Map<string, ModelType> | null = null

/**
 * 내장 모델 타입 캐시 초기화
 */
function initBuiltinModelTypeCache(): Map<string, ModelType> {
  if (builtinModelTypeCache) {
    return builtinModelTypeCache
  }

  const cache = new Map<string, ModelType>()
  const allBuiltinModels = getAllBuiltinModels()

  // 모든 provider의 내장 모델 순회
  for (const models of Object.values(allBuiltinModels)) {
    for (const model of models) {
      // 내장 모델은 type 필드가 보장됨
      if (model.type) {
        cache.set(model.id, model.type)
      }
    }
  }

  builtinModelTypeCache = cache
  return cache
}

/**
 * 내장 설정에서 모델 타입 조회
 * @param modelId 모델 ID
 * @returns 모델 타입, 찾을 수 없으면 undefined 반환
 */
function getBuiltinModelType(modelId: string): ModelType | undefined {
  const cache = initBuiltinModelTypeCache()
  return cache.get(modelId)
}

/**
 * 임베딩 모델 키워드 패턴
 */
const EMBEDDING_PATTERNS = [
  /embed/i,
  /bge/i,
  /bce-embedding/i,
  /e5-/i,
  /gte-/i,
  /m3e/i,
  /text-similarity/i,
  /sentence-transformers/i
]

/**
 * 리랭커 모델 키워드 패턴
 */
const RERANKER_PATTERNS = [/rerank/i, /cross-encoder/i]

/**
 * 대화 모델 키워드 패턴 (화이트리스트)
 */
const CHAT_PATTERNS = [
  /gpt-/i,
  /deepseek/i,
  /qwen/i,
  /claude/i,
  /llama/i,
  /mistral/i,
  /gemini/i,
  /glm/i,
  /kimi/i,
  /minimax/i,
  /yi-/i,
  /chatglm/i,
  /baichuan/i,
  /internlm/i,
  /thinking/i,
  /instruct/i,
  /chat/i
]

/**
 * 멀티모달/비전 모델 키워드
 */
const VISION_PATTERNS = [/-vl/i, /-vision/i, /vision/i, /4v/i, /captioner/i, /omni/i]

/**
 * 이미지 생성 모델 키워드
 */
const IMAGE_GEN_PATTERNS = [
  /stable-diffusion/i,
  /sdxl/i,
  /flux/i,
  /dalle/i,
  /midjourney/i,
  /kolors/i
]

/**
 * 오디오 모델 키워드
 */
const AUDIO_PATTERNS = [/whisper/i, /tts/i, /speech/i, /audio/i, /cosyvoice/i, /fish-speech/i]

/**
 * 모델 ID로 모델 타입 판별
 * @param modelId 모델 ID
 * @returns 모델 타입
 */
export function classifyModel(modelId: string): ModelType {
  const lowerCaseId = modelId.toLowerCase()

  // 우선순위 1: 명확한 특수 타입 (오판 방지)
  // 리랭커 모델
  if (RERANKER_PATTERNS.some((pattern) => pattern.test(lowerCaseId))) {
    return ModelType.RERANKER
  }

  // 임베딩 모델
  if (EMBEDDING_PATTERNS.some((pattern) => pattern.test(lowerCaseId))) {
    return ModelType.EMBEDDING
  }

  // 우선순위 2: 멀티미디어 생성 모델
  // 이미지 생성 모델
  if (IMAGE_GEN_PATTERNS.some((pattern) => pattern.test(lowerCaseId))) {
    return ModelType.IMAGE
  }

  // 오디오 모델
  if (AUDIO_PATTERNS.some((pattern) => pattern.test(lowerCaseId))) {
    return ModelType.AUDIO
  }

  // 우선순위 3: 대화 모델 (멀티모달 대화 포함)
  // 비전/멀티모달 대화 모델도 대화 모델로 분류 (주로 채팅에 사용되므로)
  if (
    CHAT_PATTERNS.some((pattern) => pattern.test(lowerCaseId)) ||
    VISION_PATTERNS.some((pattern) => pattern.test(lowerCaseId))
  ) {
    return ModelType.CHAT
  }

  // 기본값: 알 수 없음 반환
  return ModelType.UNKNOWN
}

/**
 * 모델에 타입 정보 추가
 * 우선순위:
 * 1. 내장 설정 파일에서 정의된 타입
 * 2. 모델 객체 자체의 type 필드 (API 반환)
 * 3. 모델 이름 기반 자동 분류
 * @param model 원본 모델 객체
 * @returns 타입 정보가 포함된 모델 객체
 */
export function enrichModelWithType(model: Model): Model {
  // 1. 내장 설정 파일에서 정의된 타입을 우선 사용
  const builtinType = getBuiltinModelType(model.id)
  if (builtinType) {
    return {
      ...model,
      type: builtinType
    }
  }

  // 2. 모델 객체 자체의 type 필드 사용, 또는 자동 분류 사용
  return {
    ...model,
    type: model.type || classifyModel(model.id)
  }
}

/**
 * 일괄적으로 모델에 타입 정보 추가
 * @param models 모델 목록
 * @returns 타입 정보가 포함된 모델 목록
 */
export function enrichModelsWithType(models: Model[]): Model[] {
  return models.map(enrichModelWithType)
}

/**
 * 모델 목록 분류
 * @param models 모델 목록
 * @returns 분류된 모델 객체
 */
export function categorizeModels(models: Model[]): CategorizedModels {
  const enrichedModels = enrichModelsWithType(models)

  return {
    chat: enrichedModels.filter((m) => m.type === ModelType.CHAT),
    embedding: enrichedModels.filter((m) => m.type === ModelType.EMBEDDING),
    reranker: enrichedModels.filter((m) => m.type === ModelType.RERANKER),
    other: enrichedModels.filter(
      (m) =>
        m.type === ModelType.IMAGE ||
        m.type === ModelType.AUDIO ||
        m.type === ModelType.VIDEO ||
        m.type === ModelType.UNKNOWN
    )
  }
}

/**
 * 대화 모델 필터링
 * @param models 모델 목록
 * @returns 대화 모델 목록
 */
export function filterChatModels(models: Model[]): Model[] {
  return enrichModelsWithType(models).filter((m) => m.type === ModelType.CHAT)
}

/**
 * 임베딩 모델 필터링
 * @param models 모델 목록
 * @returns 임베딩 모델 목록
 */
export function filterEmbeddingModels(models: Model[]): Model[] {
  return enrichModelsWithType(models).filter((m) => m.type === ModelType.EMBEDDING)
}

/**
 * 내장 모델과 원격 모델 스마트 병합
 *
 * 병합 전략:
 * - 원격 필드 우선: id, owned_by, created, object (최신 상태 반영)
 * - 내장 필드 우선: type, max_context, description (정밀하게 설정된 메타데이터)
 * - 원격 신규 모델: type 자동 분류 후 추가
 * - 내장 전용 모델: 유지 (원격 API 누락 방지)
 *
 * @param builtinModels 내장 모델 목록
 * @param remoteModels 원격 API에서 가져온 모델 목록
 * @returns 병합된 모델 목록
 *
 * @example
 * // 내장 모델: [{ id: 'gpt-4o', type: 'chat', max_context: 128000 }]
 * // 원격 모델: [{ id: 'gpt-4o', created: 1715367049, owned_by: 'openai' }]
 * // 병합 결과: [{ id: 'gpt-4o', type: 'chat', max_context: 128000, created: 1715367049, owned_by: 'openai' }]
 */
export function mergeModels(builtinModels: Model[], remoteModels: Model[]): Model[] {
  const builtinMap = new Map(builtinModels.map((m) => [m.id, m]))
  const remoteMap = new Map(remoteModels.map((m) => [m.id, m]))

  const merged: Model[] = []

  // 1. 모든 원격 모델 순회
  for (const remote of remoteModels) {
    const builtin = builtinMap.get(remote.id)

    if (builtin) {
      // 둘 다 존재: 스마트 병합
      // 원격 필드는 최신 기본 정보 제공, 내장 필드는 정확한 메타데이터 제공
      merged.push({
        ...remote, // 원격 필드 (id, object, owned_by, created)
        type: builtin.type, // 내장 필드 우선
        max_context: builtin.max_context,
        description: builtin.description
      })
    } else {
      // 원격에만 존재: 직접 추가 (type 자동 분류)
      merged.push(enrichModelWithType(remote))
    }
  }

  // 2. 내장에만 존재하는 모델 추가 (원격 API 누락 방지)
  for (const builtin of builtinModels) {
    if (!remoteMap.has(builtin.id)) {
      merged.push(builtin)
    }
  }

  return merged
}
