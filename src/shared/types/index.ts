/**
 * 공유 타입 정의
 * Drizzle에서 추론된 데이터베이스 스키마 기반으로, 타입 정의의 단일 데이터 소스를 보장
 */

// 지식 베이스 타입 내보내기
export * from './knowledge'

// 채팅 타입 내보내기
export * from './chat'

// Result 오류 처리 타입 내보내기
export * from './result'

// 퀴즈 타입 내보내기
export * from './quiz'

// Anki 타입 내보내기
export * from './anki'

/**
 * 노트북 인터페이스
 * Drizzle 스키마에서 추론된 타입과 호환
 */
export interface Notebook {
  id: string
  title: string
  description?: string | null | undefined // Drizzle에서 추론된 선택적 필드와 호환
  createdAt: Date
  updatedAt: Date
}

/**
 * 노트 인터페이스
 * Drizzle 스키마에서 추론된 타입과 호환
 */
export interface Note {
  id: string
  notebookId: string
  title: string
  content: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Provider 설정 인터페이스
 */
export interface ProviderConfig {
  providerName: string
  config: any
  enabled: boolean
  updatedAt: number
}

/**
 * 모델 타입 열거형
 */
export enum ModelType {
  CHAT = 'chat',
  EMBEDDING = 'embedding',
  RERANKER = 'reranker',
  IMAGE = 'image',
  AUDIO = 'audio',
  VIDEO = 'video',
  UNKNOWN = 'unknown'
}

/**
 * 모델 인터페이스
 */
export interface Model {
  id: string
  object: string
  owned_by?: string
  created?: number
  type?: ModelType
  max_context?: number // 최대 컨텍스트 길이 (내장 설정에서 제공)
  description?: string // 모델 설명 (내장 설정에서 제공)
}

/**
 * 분류된 모델 목록 인터페이스
 */
export interface CategorizedModels {
  chat: Model[]
  embedding: Model[]
  reranker: Model[]
  other: Model[]
}

/**
 * 앱 설정 인터페이스
 */
export interface AppSettings {
  theme: 'light' | 'dark'
  language: 'ko-KR' | 'en-US'
  autoLaunch: boolean
  hasCompletedOnboarding: boolean
  defaultChatModel?: string // 기본 대화 모델
  defaultEmbeddingModel?: string // 기본 임베딩 모델
  rag?: {
    topK?: number // 반환 결과 수, 기본값 5
    threshold?: number // 유사도 임계값, 기본값 0.3
    searchMode?: 'semantic' | 'keyword' | 'hybrid' // 검색 모드, 기본값 'hybrid'
    overRetrievalMultiplier?: number // Over-retrieval 배수, 기본값 4
    enableReranking?: boolean // 재순위화 활성화, 기본값 true
  }
  prompts?: {
    mindMap?: {
      'ko-KR'?: string // 한국어 마인드맵 생성 프롬프트
      'en-US'?: string // 영어 마인드맵 생성 프롬프트
    }
    quiz?: {
      'ko-KR'?: string // 한국어 퀴즈 생성 프롬프트
      'en-US'?: string // 영어 퀴즈 생성 프롬프트
    }
    anki?: {
      'ko-KR'?: string // 한국어 Anki 카드 생성 프롬프트
      'en-US'?: string // 영어 Anki 카드 생성 프롬프트
    }
  }
}

/**
 * 단축키 액션 열거형
 */
export enum ShortcutAction {
  // 노트북 관리
  CREATE_NOTEBOOK = 'create_notebook',
  CLOSE_NOTEBOOK = 'close_notebook',

  // 패널 전환
  TOGGLE_KNOWLEDGE_BASE = 'toggle_knowledge_base', // 지식 베이스
  TOGGLE_CREATIVE_SPACE = 'toggle_creative_space', // 창작 공간

  // 편집기
  SAVE_NOTE = 'save_note'
}

/**
 * 단축키 설정 인터페이스
 */
export interface ShortcutConfig {
  action: ShortcutAction
  accelerator: string // 예: "CommandOrControl+N"
  enabled: boolean
  description: string // i18n key
}
