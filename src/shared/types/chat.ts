/**
 * 통합 채팅 관련 타입 정의
 * 이 파일은 main, renderer, preload 세 프로세스에서 공유됨
 *
 * 타입 정의는 Drizzle에서 추론된 데이터베이스 schema를 기반으로 하여 타입 정의의 단일 소스를 보장
 */

import type {
  ChatSession as DBChatSession,
  ChatMessage as DBChatMessage
} from '../../main/db/schema'

/**
 * 채팅 세션 인터페이스 (전체 버전)
 * Drizzle에서 추론된 데이터베이스 타입을 직접 사용
 */
export type ChatSession = DBChatSession

/**
 * 채팅 메시지 인터페이스 (전체 버전)
 * Drizzle에서 추론된 데이터베이스 타입을 기반으로 프론트엔드 확장 필드 추가
 */
export interface ChatMessage extends Omit<DBChatMessage, 'metadata' | 'reasoningContent'> {
  notebookId?: string // 프론트엔드 확장 필드, 동시 메시지 관리용
  reasoningContent?: string | null // 선택적 추론 내용 필드
  metadata?: Record<string, any>
  isStreaming?: boolean // 프론트엔드 확장 필드, 스트리밍 메시지 식별
  isReasoningStreaming?: boolean // 프론트엔드 확장 필드, 추론 과정 스트리밍 여부
}

/**
 * API 메시지 형식 (LLM Provider와 통신용)
 * API에 필요한 필드만 포함하는 간소화 버전
 */
export interface APIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning_content?: string // DeepSeek Reasoner 전용 필드
}

/**
 * 스트리밍 응답 청크
 */
export interface StreamChunk {
  content: string
  reasoningContent?: string // DeepSeek Reasoner 추론 과정 내용
  done: boolean
  reasoningDone?: boolean // 추론 과정 완료 여부
  metadata?: {
    model?: string
    finishReason?: string
    usage?: {
      promptTokens?: number
      completionTokens?: number
      totalTokens?: number
    }
    // 추론 관련 메타데이터 (AI SDK v5 추론 스트리밍)
    isReasoning?: boolean // 현재 내용이 추론 과정인지 여부
    reasoningStart?: boolean // 추론 블록 시작 마커
    reasoningEnd?: boolean // 추론 블록 종료 마커
    reasoningId?: string // 추론 블록 ID
  }
}
