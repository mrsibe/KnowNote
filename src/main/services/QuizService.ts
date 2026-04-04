/**
 * QuizService
 * 퀴즈서비스 - 생성및관리노트북의퀴즈문제라이브러리
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
 * 진행콜백함수타입
 */
export type QuizProgressCallback = (stage: string, progress: number) => void

/**
 * 퀴즈생성선택지
 */
export interface QuizGenerationOptions {
  questionCount?: number // 문제수량，기본10
  difficulty?: 'easy' | 'medium' | 'hard' // 어려운도，기본medium
  customPrompt?: string // 자체정의힌트
}

/**
 * 조회quiz생성 Prompt（지원국실제화및자체정의）
 */
async function getQuizPrompt(customPrompt?: string): Promise<string> {
  // 만약제공자체정의힌트，직접사용
  if (customPrompt && customPrompt.trim()) {
    return customPrompt.trim()
  }

  // 아니오에서설정에서조회
  const settings = await settingsManager.getAllSettings()
  const language = settings.language || 'ko-KR'

  const prompt = settings.prompts?.quiz?.[language]

  if (!prompt) {
    throw new Error(`찾을 수 없음 ${language} 언어의퀴즈생성힌트`)
  }

  return prompt
}

/**
 * 조회어려운도가리키는명령텍스트
 */
function getDifficultyInstruction(
  difficulty: 'easy' | 'medium' | 'hard',
  language: string
): string {
  const difficultyInstructions = {
    easy: {
      'ko-KR':
        '난이도 요��: 쉬움 - 기본 개념과 정의에 초점을 맞춘 쉬운 난이도의 문제를 생성하세요. 선택지 간의 차이가 명확해야 합니다.',
      'en-US':
        'Difficulty: Easy - Generate easy-difficulty questions that focus on basic concepts and definitions. Options should have clear differences.'
    },
    medium: {
      'ko-KR':
        '난이도 요구: 보통 - 지식 포인트의 이해와 적용이 필요한 보통 난이도의 문제를 생성하세요. 선택지의 유사성을 적절히 높이세요.',
      'en-US':
        'Difficulty: Medium - Generate medium-difficulty questions that require understanding and applying knowledge points, with moderately similar options.'
    },
    hard: {
      'ko-KR':
        '난이도 요구: 어려움 - 깊은 이해, 종합적 적용 및 분석 능력이 필요한 어려운 문제를 생성하세요. 선택지에 어느 정도의 혼동성이 있어야 합니다.',
      'en-US':
        'Difficulty: Hard - Generate hard-difficulty questions that require deep understanding, comprehensive application, and analytical ability. Options should be somewhat confusing.'
    }
  }

  return difficultyInstructions[difficulty][language] || difficultyInstructions[difficulty]['ko-KR']
}

/**
 * Zod Schema 정의퀴즈결구조
 */
const QuizQuestionSchema: z.ZodType<QuizQuestion> = z.object({
  id: z.string().describe('문제 고유 ID'),
  questionText: z.string().max(200).describe('문제 텍스트, 200자 이내'),
  options: z.array(z.string().max(100)).length(4).describe('4개 선택지'),
  correctAnswer: z.number().min(0).max(3).describe('정답 인덱스 (0-3)'),
  explanation: z.string().max(300).describe('답변 설명, 300자 이내'),
  hints: z.array(z.string().max(100)).min(1).max(2).describe('1-2개 힌트'),
  metadata: z
    .object({
      chunkIds: z.array(z.string()).describe('관련 chunk ID 목록')
    })
    .optional()
})

/**
 * 생성동상태Quiz Schema
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
 * 퀴즈서비스
 */
export class QuizService {
  constructor(private providerManager: ProviderManager) {}

  /**
   * 집계노트북내용
   */
  private async aggregateNotebookContent(notebookId: string): Promise<string> {
    const db = getDatabase()
    const contentParts: string[] = []

    try {
      // 1. 조회모든인덱스문서
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
        throw new Error('노트북없있는사용 가능내용생성문제，요청먼저문서 추가에지식 베이스')
      }

      // 2. 집계문서chunks (매개문서가장많은10개chunks)
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
        throw new Error('노트북없있는사용 가능내용생성문제')
      }

      return contentParts.join('\n\n---\n\n')
    } catch (error) {
      Logger.error('QuizService', 'Error aggregating content:', error)
      throw error
    }
  }

  /**
   * 호출LLM생성문제 (사용 streamObject 결구조화출력)
   */
  private async callLLMForGeneration(
    content: string,
    options?: QuizGenerationOptions,
    onProgress?: QuizProgressCallback
  ): Promise<QuizGenerationResult> {
    const provider = await this.providerManager.getActiveChatProvider()
    if (!provider) {
      throw new Error('없있는사용 가능의대화모델,요청먼저설정LLM제공자')
    }

    // 보장 provider 예 AISDKProvider 인스턴스
    if (!(provider instanceof AISDKProvider)) {
      throw new Error('현재 provider 미지원결구조화출력')
    }

    Logger.info('QuizService', `Using provider: ${provider.name}`)

    // 조회기본힌트
    const promptTemplate = await getQuizPrompt(options?.customPrompt)

    // 조회생성매개변수
    const questionCount = options?.questionCount || 10
    const difficulty = options?.difficulty || 'medium'

    // 프롬프트 언어 감지
    const isKorean = promptTemplate.includes('한국어') || promptTemplate.includes('문제')
    const language = isKorean ? 'ko-KR' : 'en-US'

    // 조회어려운도가리키는명령
    const difficultyInstruction = getDifficultyInstruction(difficulty, language)

    // 치환변수플레이스홀더
    let prompt = promptTemplate.replace(/\{\{QUESTION_COUNT\}\}/g, questionCount.toString())
    prompt = prompt.replace(/\{\{DIFFICULTY_INSTRUCTION\}\}/g, difficultyInstruction)

    // 치환내용플레이스홀더
    prompt = prompt.replace(/\{\{CONTENT\}\}/g, content)

    try {
      onProgress?.('generating_quiz', 30)

      // 조회 AI SDK 모델인스턴스
      const model = provider.getAIModel()

      // 생성동상태Schema
      const QuizSchema = createQuizSchema(questionCount)

      // 사용 streamObject 생성결구조화데이터
      const { partialObjectStream, object } = streamObject({
        model: model,
        schema: QuizSchema,
        prompt: prompt
      })

      // 감시스트림형식업데이트 (용도:표시진행)
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

      // 등대기완전한객체
      const result = await object
      Logger.info('QuizService', `Generated quiz: ${result.metadata.totalQuestions} questions`)

      // 기본검증
      if (!result.questions || result.questions.length < 1) {
        throw new Error('생성의문제수량아닌정확인')
      }

      return {
        questions: result.questions,
        metadata: result.metadata
      }
    } catch (error) {
      Logger.error('QuizService', 'Error calling LLM:', error)
      throw new Error(`생성문제실패: ${(error as Error).message}`)
    }
  }

  /**
   * 검증및정리세척문제데이터
   */
  private async validateAndCleanQuiz(
    notebookId: string,
    result: QuizGenerationResult
  ): Promise<QuizGenerationResult> {
    const db = getDatabase()

    // 수세트모든제에의chunkIds
    const allChunkIds = new Set<string>()
    result.questions.forEach((question) => {
      if (question.metadata?.chunkIds) {
        question.metadata.chunkIds.forEach((id) => allChunkIds.add(id))
      }
    })

    // 검증chunkIds예아니오존재
    if (allChunkIds.size > 0) {
      const validChunks = db
        .select({ id: chunks.id })
        .from(chunks)
        .where(and(eq(chunks.notebookId, notebookId), inArray(chunks.id, Array.from(allChunkIds))))
        .all()

      const validChunkIds = new Set(validChunks.map((c) => c.id))

      // 필터링유효하지 않음의chunkIds
      result.questions = result.questions.map((question) => {
        if (question.metadata?.chunkIds) {
          question.metadata.chunkIds = question.metadata.chunkIds.filter((id) =>
            validChunkIds.has(id)
          )
        }
        return question
      })
    }

    // 문제제거재（확인questionText예아니오재복）
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
   * 생성문제
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
      // 1. 생성기록
      onProgress?.('creating_record', 0)

      const notebook = db.select().from(notebooks).where(eq(notebooks.id, notebookId)).get()
      if (!notebook) {
        throw new Error('노트북존재하지 않음')
      }

      // 현재 조회언어설정
      const settings = await settingsManager.getAllSettings()
      const language = settings.language || 'ko-KR'

      // 현재 조회버전번호
      const latestVersion = db
        .select({ version: quizzes.version })
        .from(quizzes)
        .where(eq(quizzes.notebookId, notebookId))
        .orderBy(desc(quizzes.version))
        .limit(1)
        .get()

      const newVersion = (latestVersion?.version || 0) + 1

      // 기반으로언어생성제목
      const titleTemplate =
        language === 'en-US' ? `${notebook.title} Quiz` : `${notebook.title}의퀴즈`

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

      // 생성의 item（추가에목록끝끝）
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

      // 2. 집계내용
      onProgress?.('aggregating_content', 10)
      const content = await this.aggregateNotebookContent(notebookId)

      // 3. 호출LLM생성
      const result = await this.callLLMForGeneration(content, options, onProgress)

      // 4. 검증및정리세척데이터
      onProgress?.('validating_data', 80)
      const validatedResult = await this.validateAndCleanQuiz(notebookId, result)

      // 5. 빌드chunkMapping
      const chunkMapping: Record<string, string[]> = {}
      validatedResult.questions.forEach((question) => {
        if (question.metadata?.chunkIds && question.metadata.chunkIds.length > 0) {
          chunkMapping[question.id] = question.metadata.chunkIds
        }
      })

      // 6. 업데이트데이터베이스
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

      // 업데이트상태실패
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
   * 문제은행 조회
   */
  getQuiz(quizId: string): Quiz | undefined {
    const db = getDatabase()
    const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get()
    return quiz
  }

  /**
   * 노트북 조회최신버전문제라이브러리
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
   * 제출퀴즈세션
   */
  submitSession(quizId: string, answers: Record<string, number>): string {
    const db = getDatabase()
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    // 문제은행 조회
    const quiz = this.getQuiz(quizId)
    if (!quiz) {
      throw new Error('문제라이브러리존재하지 않음')
    }

    const questions = quiz.questionsData as any as QuizQuestion[]

    // 계산분수
    let correctCount = 0
    questions.forEach((question) => {
      const userAnswer = answers[question.id]
      if (userAnswer !== undefined && userAnswer === question.correctAnswer) {
        correctCount++
      }
    })

    const totalQuestions = questions.length
    const score = Math.round((correctCount / totalQuestions) * 100)

    // 세션 생성기록
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
   * 조회퀴즈세션
   */
  getSession(sessionId: string): QuizSession | undefined {
    const db = getDatabase()
    const session = db.select().from(quizSessions).where(eq(quizSessions.id, sessionId)).get()
    return session
  }

  /**
   * 업데이트문제라이브러리
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
   * 문제은행 삭제
   */
  deleteQuiz(quizId: string): void {
    const db = getDatabase()

    // 먼저삭제연관된 item
    db.delete(items)
      .where(and(eq(items.type, 'quiz'), eq(items.resourceId, quizId)))
      .run()
    Logger.info('QuizService', `Deleted item for quiz: ${quizId}`)

    // 문제은행 삭제자（레벨연삭제quizSessions）
    db.delete(quizzes).where(eq(quizzes.id, quizId)).run()
    executeCheckpoint('PASSIVE')
    Logger.info('QuizService', `Quiz deleted: ${quizId}`)
  }
}
