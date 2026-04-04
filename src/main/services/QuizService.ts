/**
 * QuizService
 * 퀴즈 서비스 - 노트북의 퀴즈 문제 은행 생성 및 관리
 */

import { getDatabase, executeCheckpoint } from '../db'
import { quizzes, documents, chunks, notebooks, items, quizSessions } from '../db/schema'
import type { Quiz, NewQuiz, QuizSession, NewQuizSession } from '../db/schema'
import type { QuizQuestion, QuizGenerationResult } from '../../shared/types/quiz'
import { eq, desc, and, inArray } from 'drizzle-orm'
import { ProviderManager } from '../providers/ProviderManager'
import { AISDKProvider } from '../providers/base/AISDKProvider'
import { streamObject } from 'ai'
import { z } from 'zod'
import Logger from '../../shared/utils/logger'
import { settingsManager } from '../config'

/**
 * 진행률 콜백 함수 타입
 */
export type QuizProgressCallback = (stage: string, progress: number) => void

/**
 * 퀴즈 생성 옵션
 */
export interface QuizGenerationOptions {
  questionCount?: number // 문제 수, 기본값 10
  difficulty?: 'easy' | 'medium' | 'hard' // 난이도, 기본값 medium
  customPrompt?: string // 사용자 정의 프롬프트
}

/**
 * 퀴즈 생성 Prompt 조회 (국제화 및 사용자 정의 지원)
 */
async function getQuizPrompt(customPrompt?: string): Promise<string> {
  // 사용자 정의 프롬프트가 제공된 경우 직접 사용
  if (customPrompt && customPrompt.trim()) {
    return customPrompt.trim()
  }

  // 그렇지 않으면 설정에서 조회
  const settings = await settingsManager.getAllSettings()
  const language = settings.language || 'zh-CN'

  const prompt = settings.prompts?.quiz?.[language]

  if (!prompt) {
    throw new Error(`${language} 언어의 퀴즈 생성 프롬프트를 찾을 수 없습니다`)
  }

  return prompt
}

/**
 * 난이도 지시 텍스트 조회
 */
function getDifficultyInstruction(
  difficulty: 'easy' | 'medium' | 'hard',
  language: string
): string {
  const difficultyInstructions = {
    easy: {
      'zh-CN':
        '难度要求：简单 - 请生成简单难度的题目，重点考察基础概念和定义，选项之间的差异要明显。',
      'en-US':
        'Difficulty: Easy - Generate easy-difficulty questions that focus on basic concepts and definitions. Options should have clear differences.'
    },
    medium: {
      'zh-CN':
        '难度要求：中等 - 请生成中等难度的题目，需要理解和应用知识点，适当增加选项的相似性。',
      'en-US':
        'Difficulty: Medium - Generate medium-difficulty questions that require understanding and applying knowledge points, with moderately similar options.'
    },
    hard: {
      'zh-CN':
        '难度要求：困难 - 请生成困难题目，需要深度理解、综合应用和分析能力，选项之间要有一定的迷惑性。',
      'en-US':
        'Difficulty: Hard - Generate hard-difficulty questions that require deep understanding, comprehensive application, and analytical ability. Options should be somewhat confusing.'
    }
  }

  return difficultyInstructions[difficulty][language] || difficultyInstructions[difficulty]['zh-CN']
}

/**
 * 퀴즈 구조를 정의하는 Zod Schema
 */
const QuizQuestionSchema: z.ZodType<QuizQuestion> = z.object({
  id: z.string().describe('문제 고유 ID'),
  questionText: z.string().max(200).describe('문제 텍스트, 200자 이하'),
  options: z.array(z.string().max(100)).length(4).describe('4개 선택지'),
  correctAnswer: z.number().min(0).max(3).describe('정답 인덱스 (0-3)'),
  explanation: z.string().max(300).describe('정답 해설, 300자 이하'),
  hints: z.array(z.string().max(100)).min(1).max(2).describe('1-2개 힌트'),
  metadata: z
    .object({
      chunkIds: z.array(z.string()).describe('연관된 chunk ID 목록')
    })
    .optional()
})

/**
 * 동적 Quiz Schema 생성
 */
function createQuizSchema(questionCount: number) {
  return z.object({
    questions: z.array(QuizQuestionSchema).length(questionCount).describe(`${questionCount}개 문제`),
    metadata: z.object({
      totalQuestions: z.number().describe('총 문제 수')
    })
  })
}

/**
 * 퀴즈 서비스
 */
export class QuizService {
  constructor(private providerManager: ProviderManager) {}

  /**
   * 노트북 내용 집계
   */
  private async aggregateNotebookContent(notebookId: string): Promise<string> {
    const db = getDatabase()
    const contentParts: string[] = []

    try {
      // 1. 모든 인덱싱된 문서 조회
      const docs = db
        .select({
          id: documents.id,
          title: documents.title,
          type: documents.type
        })
        .from(documents)
        .where(and(eq(documents.notebookId, notebookId), eq(documents.status, 'indexed')))
        .all()

      Logger.info('QuizService', `Found ${docs.length} indexed documents`)

      if (docs.length === 0) {
        throw new Error('노트북에 문제를 생성할 수 있는 콘텐츠가 없습니다. 먼저 문서를 지식 베이스에 추가하세요')
      }

      // 2. 문서 chunks 집계 (문서당 최대 10개 chunks)
      for (const doc of docs) {
        const docChunks = db
          .select()
          .from(chunks)
          .where(eq(chunks.documentId, doc.id))
          .orderBy(chunks.chunkIndex)
          .limit(10)
          .all()

        if (docChunks.length > 0) {
          const chunkContent = docChunks.map((c) => c.content).join('\n')
          contentParts.push(`[문서: ${doc.title}]\n${chunkContent}`)
        }
      }

      if (contentParts.length === 0) {
        throw new Error('노트북에 문제를 생성할 수 있는 콘텐츠가 없습니다')
      }

      return contentParts.join('\n\n---\n\n')
    } catch (error) {
      Logger.error('QuizService', 'Error aggregating content:', error)
      throw error
    }
  }

  /**
   * LLM을 호출하여 문제 생성 (streamObject 구조화 출력 사용)
   */
  private async callLLMForGeneration(
    content: string,
    options?: QuizGenerationOptions,
    onProgress?: QuizProgressCallback
  ): Promise<QuizGenerationResult> {
    const provider = await this.providerManager.getActiveChatProvider()
    if (!provider) {
      throw new Error('사용 가능한 대화 모델이 없습니다. LLM 제공자를 먼저 설정하세요')
    }

    // provider가 AISDKProvider 인스턴스인지 확인
    if (!(provider instanceof AISDKProvider)) {
      throw new Error('현재 provider는 구조화 출력을 지원하지 않습니다')
    }

    Logger.info('QuizService', `Using provider: ${provider.name}`)

    // 기본 프롬프트 조회
    const promptTemplate = await getQuizPrompt(options?.customPrompt)

    // 생성 파라미터 조회
    const questionCount = options?.questionCount || 10
    const difficulty = options?.difficulty || 'medium'

    // 프롬프트 언어 감지
    const isChinese = promptTemplate.includes('中文') || promptTemplate.includes('题目')
    const language = isChinese ? 'zh-CN' : 'en-US'

    // 난이도 지시 조회
    const difficultyInstruction = getDifficultyInstruction(difficulty, language)

    // 변수 플레이스홀더 대체
    let prompt = promptTemplate.replace(/\{\{QUESTION_COUNT\}\}/g, questionCount.toString())
    prompt = prompt.replace(/\{\{DIFFICULTY_INSTRUCTION\}\}/g, difficultyInstruction)

    // 내용 플레이스홀더 대체
    prompt = prompt.replace(/\{\{CONTENT\}\}/g, content)

    try {
      onProgress?.('generating_quiz', 30)

      // AI SDK 모델 인스턴스 가져오기
      const model = provider.getAIModel()

      // 동적 Schema 생성
      const QuizSchema = createQuizSchema(questionCount)

      // streamObject를 사용하여 구조화 데이터 생성
      const { partialObjectStream, object } = streamObject({
        model: model,
        schema: QuizSchema,
        prompt: prompt
      })

      // 스트리밍 업데이트 모니터링 (진행률 표시용)
      let lastProgress = 30
      let chunkCount = 0
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _partialObject of partialObjectStream) {
        chunkCount++
        if (chunkCount % 5 === 0) {
          lastProgress = Math.min(lastProgress + 5, 65)
          onProgress?.('generating_quiz', lastProgress)
        }
      }
      Logger.info('QuizService', `Received ${chunkCount} partial updates`)

      onProgress?.('parsing_result', 70)

      // 완전한 객체 대기
      const result = await object
      Logger.info('QuizService', `Generated quiz: ${result.metadata.totalQuestions} questions`)

      // 기본 검증
      if (!result.questions || result.questions.length < 1) {
        throw new Error('생성된 문제 수가 올바르지 않습니다')
      }

      return {
        questions: result.questions,
        metadata: result.metadata
      }
    } catch (error) {
      Logger.error('QuizService', 'Error calling LLM:', error)
      throw new Error(`문제 생성 실패: ${(error as Error).message}`)
    }
  }

  /**
   * 문제 데이터 검증 및 정리
   */
  private async validateAndCleanQuiz(
    notebookId: string,
    result: QuizGenerationResult
  ): Promise<QuizGenerationResult> {
    const db = getDatabase()

    // 모든 언급된 chunkIds 수집
    const allChunkIds = new Set<string>()
    result.questions.forEach((question) => {
      if (question.metadata?.chunkIds) {
        question.metadata.chunkIds.forEach((id) => allChunkIds.add(id))
      }
    })

    // chunkIds 존재 여부 검증
    if (allChunkIds.size > 0) {
      const validChunks = db
        .select({ id: chunks.id })
        .from(chunks)
        .where(and(eq(chunks.notebookId, notebookId), inArray(chunks.id, Array.from(allChunkIds))))
        .all()

      const validChunkIds = new Set(validChunks.map((c) => c.id))

      // 유효하지 않은 chunkIds 필터링
      result.questions = result.questions.map((question) => {
        if (question.metadata?.chunkIds) {
          question.metadata.chunkIds = question.metadata.chunkIds.filter((id) =>
            validChunkIds.has(id)
          )
        }
        return question
      })
    }

    // 문제 중복 제거 (questionText 중복 확인)
    const uniqueQuestions: QuizQuestion[] = []
    const seenTexts = new Set<string>()
    result.questions.forEach((question) => {
      if (!seenTexts.has(question.questionText)) {
        seenTexts.add(question.questionText)
        uniqueQuestions.push(question)
      }
    })

    result.questions = uniqueQuestions

    return result
  }

  /**
   * 문제 생성
   */
  async generateQuiz(
    notebookId: string,
    options?: QuizGenerationOptions,
    onProgress?: QuizProgressCallback
  ): Promise<string> {
    const db = getDatabase()
    const quizId = `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const startTime = Date.now()

    try {
      // 1. 레코드 생성
      onProgress?.('creating_record', 0)

      const notebook = db.select().from(notebooks).where(eq(notebooks.id, notebookId)).get()
      if (!notebook) {
        throw new Error('노트북이 존재하지 않습니다')
      }

      // 현재 언어 설정 조회
      const settings = await settingsManager.getAllSettings()
      const language = settings.language || 'zh-CN'

      // 현재 버전 번호 조회
      const latestVersion = db
        .select({ version: quizzes.version })
        .from(quizzes)
        .where(eq(quizzes.notebookId, notebookId))
        .orderBy(desc(quizzes.version))
        .limit(1)
        .get()

      const newVersion = (latestVersion?.version || 0) + 1

      // 언어에 따라 제목 생성
      const titleTemplate =
        language === 'en-US' ? `${notebook.title} Quiz` : `${notebook.title}의 퀴즈`

      const newQuiz: NewQuiz = {
        id: quizId,
        notebookId,
        title: titleTemplate,
        version: newVersion,
        questionsData: [] as any,
        chunkMapping: {} as any,
        status: 'generating',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      db.insert(quizzes).values(newQuiz).run()
      Logger.info('QuizService', `Created quiz: ${quizId}, version: ${newVersion}`)

      // 해당하는 item 생성 (목록 끝에 추가)
      const existingItems = db.select().from(items).where(eq(items.notebookId, notebookId)).all()
      const maxOrder = existingItems.reduce((max, item) => Math.max(max, item.order), -1)
      const newOrder = maxOrder + 1

      const itemId = `item-quiz-${quizId}`
      db.insert(items)
        .values({
          id: itemId,
          notebookId,
          type: 'quiz',
          resourceId: quizId,
          order: newOrder,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .run()
      Logger.info('QuizService', `Created item for quiz: ${itemId} with order: ${newOrder}`)

      // 2. 내용 집계
      onProgress?.('aggregating_content', 10)
      const content = await this.aggregateNotebookContent(notebookId)

      // 3. LLM 호출하여 생성
      const result = await this.callLLMForGeneration(content, options, onProgress)

      // 4. 데이터 검증 및 정리
      onProgress?.('validating_data', 80)
      const validatedResult = await this.validateAndCleanQuiz(notebookId, result)

      // 5. chunkMapping 구축
      const chunkMapping: Record<string, string[]> = {}
      validatedResult.questions.forEach((question) => {
        if (question.metadata?.chunkIds && question.metadata.chunkIds.length > 0) {
          chunkMapping[question.id] = question.metadata.chunkIds
        }
      })

      // 6. 데이터베이스 업데이트
      onProgress?.('saving_quiz', 90)

      const generationTime = Date.now() - startTime

      db.update(quizzes)
        .set({
          questionsData: validatedResult.questions as any,
          chunkMapping: chunkMapping as any,
          metadata: {
            model: (await this.providerManager.getActiveChatProvider())?.name || 'unknown',
            totalQuestions: validatedResult.metadata.totalQuestions,
            generationTime
          } as any,
          status: 'completed',
          updatedAt: new Date()
        })
        .where(eq(quizzes.id, quizId))
        .run()

      executeCheckpoint('PASSIVE')
      onProgress?.('completed', 100)

      Logger.info('QuizService', `Quiz generated successfully: ${quizId}`)
      return quizId
    } catch (error) {
      Logger.error('QuizService', 'Error generating quiz:', error)

      // 상태를 실패로 업데이트
      db.update(quizzes)
        .set({
          status: 'failed',
          errorMessage: (error as Error).message,
          updatedAt: new Date()
        })
        .where(eq(quizzes.id, quizId))
        .run()

      throw error
    }
  }

  /**
   * 문제 은행 조회
   */
  getQuiz(quizId: string): Quiz | undefined {
    const db = getDatabase()
    const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get()
    return quiz
  }

  /**
   * 노트북의 최신 버전 문제 은행 조회
   */
  getLatestQuiz(notebookId: string): Quiz | undefined {
    const db = getDatabase()
    const quiz = db
      .select()
      .from(quizzes)
      .where(and(eq(quizzes.notebookId, notebookId), eq(quizzes.status, 'completed')))
      .orderBy(desc(quizzes.version))
      .limit(1)
      .get()
    return quiz
  }

  /**
   * 퀴즈 세션 제출
   */
  submitSession(quizId: string, answers: Record<string, number>): string {
    const db = getDatabase()
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    // 문제 은행 조회
    const quiz = this.getQuiz(quizId)
    if (!quiz) {
      throw new Error('문제 은행이 존재하지 않습니다')
    }

    const questions = quiz.questionsData as any as QuizQuestion[]

    // 점수 계산
    let correctCount = 0
    questions.forEach((question) => {
      const userAnswer = answers[question.id]
      if (userAnswer !== undefined && userAnswer === question.correctAnswer) {
        correctCount++
      }
    })

    const totalQuestions = questions.length
    const score = Math.round((correctCount / totalQuestions) * 100)

    // 세션 레코드 생성
    const newSession: NewQuizSession = {
      id: sessionId,
      quizId,
      notebookId: quiz.notebookId,
      answers: answers as any,
      score,
      totalQuestions,
      correctCount,
      completedAt: new Date(),
      createdAt: new Date()
    }

    db.insert(quizSessions).values(newSession).run()
    executeCheckpoint('PASSIVE')
    Logger.info('QuizService', `Quiz session created: ${sessionId}, score: ${score}`)

    return sessionId
  }

  /**
   * 퀴즈 세션 조회
   */
  getSession(sessionId: string): QuizSession | undefined {
    const db = getDatabase()
    const session = db.select().from(quizSessions).where(eq(quizSessions.id, sessionId)).get()
    return session
  }

  /**
   * 문제 은행 업데이트
   */
  updateQuiz(quizId: string, updates: Partial<{ title: string }>): void {
    const db = getDatabase()
    db.update(quizzes)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(quizzes.id, quizId))
      .run()
    executeCheckpoint('PASSIVE')
    Logger.info('QuizService', `Quiz updated: ${quizId}`)
  }

  /**
   * 문제 은행 삭제
   */
  deleteQuiz(quizId: string): void {
    const db = getDatabase()

    // 연관된 item 먼저 삭제
    db.delete(items)
      .where(and(eq(items.type, 'quiz'), eq(items.resourceId, quizId)))
      .run()
    Logger.info('QuizService', `Deleted item for quiz: ${quizId}`)

    // 문제 은행 자체 삭제 (quizSessions 캐스케이드 삭제)
    db.delete(quizzes).where(eq(quizzes.id, quizId)).run()
    executeCheckpoint('PASSIVE')
    Logger.info('QuizService', `Quiz deleted: ${quizId}`)
  }
}
