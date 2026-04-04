/**
 * Notebook 관련 타입 정의
 * shared 모듈에서 모든 타입을 통합 내보내기
 */

// shared에서 통합 채팅 타입 가져오기
export type { ChatSession, ChatMessage } from '../../../shared/types/chat'

// shared에서 노트북 및 노트 타입 가져오기
export type { Notebook, Note } from '../../../shared/types'
