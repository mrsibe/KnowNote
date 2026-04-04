/**
 * Anki 관련 타입 정의
 * Anki 카드 생성 기능의 공유 타입
 */

/**
 * 기본 카드 타입
 */
export interface BaseAnkiCard {
  id: string
  type: 'basic' | 'cloze' | 'fill-blank'
  tags?: string[]
  metadata?: {
    chunkIds: string[]
    difficulty?: 'easy' | 'medium' | 'hard'
  }
}

/**
 * 기본 질문답변 카드
 * 앞면: 질문, 뒷면: 답변
 */
export interface BasicCard extends BaseAnkiCard {
  type: 'basic'
  front: string // 앞면: 질문
  back: string // 뒷면: 답변
}

/**
 * Cloze 카드 (빈칸 채우기)
 * {{c1::답변}} 형식 사용
 */
export interface ClozeCard extends BaseAnkiCard {
  type: 'cloze'
  text: string // {{c1::답변}} 형식이 포함된 텍스트
  backExtra?: string // 뒷면 추가 정보
}

/**
 * 빈칸 채우기 카드
 */
export interface FillBlankCard extends BaseAnkiCard {
  type: 'fill-blank'
  sentence: string // _____가 포함된 문장
  answer: string // 빈칸 답변
  hint?: string // 선택적 힌트
}

/**
 * 카드 유니온 타입
 */
export type AnkiCardItem = BasicCard | ClozeCard | FillBlankCard

/**
 * Anki 카드 세트
 */
export interface AnkiCard {
  id: string
  notebookId: string
  title: string
  version: number
  cardsData: AnkiCardItem[]
  chunkMapping: Record<string, string[]> // cardId -> chunkIds
  metadata: {
    model: string
    totalCards: number
    cardTypes: string[]
    generationTime: number
  }
  status: 'generating' | 'completed' | 'failed'
  errorMessage?: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Anki 생성 결과 (LLM streamObject 반환용)
 */
export interface AnkiGenerationResult {
  cards: AnkiCardItem[]
  metadata: {
    totalCards: number
    cardTypes: string[]
  }
}

/**
 * Anki 생성 옵션
 */
export interface AnkiGenerationOptions {
  cardCount?: number // 카드 수량, 기본 20
  cardTypes?: ('basic' | 'cloze' | 'fill-blank')[] // 카드 타입, 기본 전체
  difficulty?: 'easy' | 'medium' | 'hard'
  customPrompt?: string
}

/**
 * Anki 내보내기 형식
 */
export type AnkiExportFormat = 'apkg'
