/**
 * Quiz 관련 타입 정의
 * 퀴즈 기능의 공유 타입
 */

/**
 * 문제
 */
export interface QuizQuestion {
  id: string
  questionText: string
  options: string[] // 고정 4개 선택지
  correctAnswer: number // 0-3
  explanation: string
  hints: string[] // 1-2개 힌트
  metadata?: {
    chunkIds: string[]
  }
}

/**
 * 문제 은행
 */
export interface Quiz {
  id: string
  notebookId: string
  title: string
  version: number
  questions: QuizQuestion[]
  chunkMapping: Record<string, string[]>
  metadata: {
    model: string
    totalQuestions: number
    generationTime: number
  }
  status: 'generating' | 'completed' | 'failed'
  errorMessage?: string
  createdAt: Date
  updatedAt: Date
}

/**
 * 퀴즈 세션
 */
export interface QuizSession {
  id: string
  quizId: string
  notebookId: string
  answers: Record<string, number> // questionId -> selectedAnswerIndex
  score?: number
  totalQuestions: number
  correctCount?: number
  completedAt?: Date
  createdAt: Date
}

/**
 * Quiz 생성 결과 (LLM streamObject 반환용)
 */
export interface QuizGenerationResult {
  questions: QuizQuestion[]
  metadata: {
    totalQuestions: number
  }
}
