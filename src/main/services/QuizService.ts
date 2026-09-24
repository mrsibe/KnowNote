/**
 * QuizService
 * 答题服务 - 生成和管理笔记本的答题题库
 */

import { getDatabase, executeCheckpoint } from '../db'
import { quizzes, documents, chunks, notebooks, items, quizSessions } from '../db/schema'
import type { Quiz, NewQuiz, QuizSession, NewQuizSession } from '../db/schema'
import type { QuizQuestion, QuizGenerationResult } from '../../shared/types/quiz'
import { eq, desc, and, inArray } from 'drizzle-orm'
import { ConnectionManager } from '../models/ConnectionManager'
import { streamObject } from 'ai'
import { z } from 'zod'
import Logger from '../../shared/utils/logger'
import { settingsManager } from '../config'

/**
 * 进度回调函数类型
 */
export type QuizProgressCallback = (stage: string, progress: number) => void

/**
 * 答题生成选项
 */
export interface QuizGenerationOptions {
  questionCount?: number // 题目数量，默认10
  difficulty?: 'easy' | 'medium' | 'hard' // 难度，默认medium
  customPrompt?: string // 自定义提示词
}

/**
 * 获取quiz生成 Prompt（支持国际化和自定义）
 */
async function getQuizPrompt(customPrompt?: string): Promise<string> {
  // 如果提供了自定义提示词，直接使用
  if (customPrompt && customPrompt.trim()) {
    return customPrompt.trim()
  }

  // 否则从设置中获取
  const settings = await settingsManager.getAllSettings()
  const language = settings.language || 'zh-CN'

  const prompt = settings.prompts?.quiz?.[language]

  if (!prompt) {
    throw new Error(`未找到 ${language} 语言的答题生成提示词`)
  }

  return prompt
}

/**
 * 获取难度指令文本
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
 * Zod Schema 定义答题结构
 */
const QuizQuestionSchema: z.ZodType<QuizQuestion> = z.object({
  id: z.string().describe('题目唯一ID'),
  questionText: z.string().max(200).describe('题目文本，不超过200字'),
  options: z.array(z.string().max(100)).length(4).describe('4个选项'),
  correctAnswer: z.number().min(0).max(3).describe('正确答案索引（0-3）'),
  explanation: z.string().max(300).describe('答案解释，不超过300字'),
  hints: z.array(z.string().max(100)).min(1).max(2).describe('1-2个提示'),
  metadata: z
    .object({
      chunkIds: z.array(z.string()).describe('关联的chunk ID列表')
    })
    .optional()
})

/**
 * 创建动态Quiz Schema
 */
function createQuizSchema(questionCount: number) {
  return z.object({
    questions: z.array(QuizQuestionSchema).length(questionCount).describe(`${questionCount}道题目`),
    metadata: z.object({
      totalQuestions: z.number().describe('总题数')
    })
  })
}

/**
 * 答题服务
 */
export class QuizService {
  constructor(private connectionManager: ConnectionManager) {}

  /**
   * 聚合笔记本内容
   */
  private async aggregateNotebookContent(notebookId: string): Promise<string> {
    const db = getDatabase()
    const contentParts: string[] = []

    try {
      // 1. 获取所有已索引文档
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
        throw new Error('笔记本没有可用内容生成题目，请先添加文档到知识库')
      }

      // 2. 聚合文档chunks (每个文档最多10个chunks)
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
          contentParts.push(`[文档: ${doc.title}]\n${chunkContent}`)
        }
      }

      if (contentParts.length === 0) {
        throw new Error('笔记本没有可用内容生成题目')
      }

      return contentParts.join('\n\n---\n\n')
    } catch (error) {
      Logger.error('QuizService', 'Error aggregating content:', error)
      throw error
    }
  }

  /**
   * 调用LLM生成题目 (使用 streamObject 结构化输出)
   */
  private async callLLMForGeneration(
    content: string,
    options?: QuizGenerationOptions,
    onProgress?: QuizProgressCallback
  ): Promise<QuizGenerationResult> {
    const client = await this.connectionManager.getChatClient()
    if (!client) {
      throw new Error('没有可用的对话模型,请先在设置中配置模型连接')
    }

    Logger.info('QuizService', `Using model: ${client.label}`)

    // 获取基础提示词
    const promptTemplate = await getQuizPrompt(options?.customPrompt)

    // 获取生成参数
    const questionCount = options?.questionCount || 10
    const difficulty = options?.difficulty || 'medium'

    // 检测提示词语言
    const isChinese = promptTemplate.includes('中文') || promptTemplate.includes('题目')
    const language = isChinese ? 'zh-CN' : 'en-US'

    // 获取难度指令
    const difficultyInstruction = getDifficultyInstruction(difficulty, language)

    // 替换变量占位符
    let prompt = promptTemplate.replace(/\{\{QUESTION_COUNT\}\}/g, questionCount.toString())
    prompt = prompt.replace(/\{\{DIFFICULTY_INSTRUCTION\}\}/g, difficultyInstruction)

    // 替换内容占位符
    prompt = prompt.replace(/\{\{CONTENT\}\}/g, content)

    try {
      onProgress?.('generating_quiz', 30)

      // 获取 AI SDK 模型实例
      const model = client.getAIModel()

      // 创建动态Schema
      const QuizSchema = createQuizSchema(questionCount)

      // 使用 streamObject 生成结构化数据
      const { partialObjectStream, object } = streamObject({
        model: model,
        schema: QuizSchema,
        prompt: prompt
      })

      // 监听流式更新 (用于显示进度)
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

      // 等待完整对象
      const result = await object
      Logger.info('QuizService', `Generated quiz: ${result.metadata.totalQuestions} questions`)

      // 基础验证
      if (!result.questions || result.questions.length < 1) {
        throw new Error('生成的题目数量不正确')
      }

      return {
        questions: result.questions,
        metadata: result.metadata
      }
    } catch (error) {
      Logger.error('QuizService', 'Error calling LLM:', error)
      throw new Error(`生成题目失败: ${(error as Error).message}`)
    }
  }

  /**
   * 验证和清洗题目数据
   */
  private async validateAndCleanQuiz(
    notebookId: string,
    result: QuizGenerationResult
  ): Promise<QuizGenerationResult> {
    const db = getDatabase()

    // 收集所有提到的chunkIds
    const allChunkIds = new Set<string>()
    result.questions.forEach((question) => {
      if (question.metadata?.chunkIds) {
        question.metadata.chunkIds.forEach((id) => allChunkIds.add(id))
      }
    })

    // 验证chunkIds是否存在
    if (allChunkIds.size > 0) {
      const validChunks = db
        .select({ id: chunks.id })
        .from(chunks)
        .where(and(eq(chunks.notebookId, notebookId), inArray(chunks.id, Array.from(allChunkIds))))
        .all()

      const validChunkIds = new Set(validChunks.map((c) => c.id))

      // 过滤无效的chunkIds
      result.questions = result.questions.map((question) => {
        if (question.metadata?.chunkIds) {
          question.metadata.chunkIds = question.metadata.chunkIds.filter((id) =>
            validChunkIds.has(id)
          )
        }
        return question
      })
    }

    // 题目去重（检查questionText是否重复）
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
   * 生成题目
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
      // 1. 创建记录
      onProgress?.('creating_record', 0)

      const notebook = db.select().from(notebooks).where(eq(notebooks.id, notebookId)).get()
      if (!notebook) {
        throw new Error('笔记本不存在')
      }

      // 获取当前语言设置
      const settings = await settingsManager.getAllSettings()
      const language = settings.language || 'zh-CN'

      // 获取当前版本号
      const latestVersion = db
        .select({ version: quizzes.version })
        .from(quizzes)
        .where(eq(quizzes.notebookId, notebookId))
        .orderBy(desc(quizzes.version))
        .limit(1)
        .get()

      const newVersion = (latestVersion?.version || 0) + 1

      // 根据语言生成标题
      const titleTemplate =
        language === 'en-US' ? `${notebook.title} Quiz` : `${notebook.title}的答题`

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

      // 创建对应的 item（添加到列表末尾）
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

      // 2. 聚合内容
      onProgress?.('aggregating_content', 10)
      const content = await this.aggregateNotebookContent(notebookId)

      // 3. 调用LLM生成
      const result = await this.callLLMForGeneration(content, options, onProgress)

      // 4. 验证和清洗数据
      onProgress?.('validating_data', 80)
      const validatedResult = await this.validateAndCleanQuiz(notebookId, result)

      // 5. 构建chunkMapping
      const chunkMapping: Record<string, string[]> = {}
      validatedResult.questions.forEach((question) => {
        if (question.metadata?.chunkIds && question.metadata.chunkIds.length > 0) {
          chunkMapping[question.id] = question.metadata.chunkIds
        }
      })

      // 6. 更新数据库
      onProgress?.('saving_quiz', 90)

      const generationTime = Date.now() - startTime

      db.update(quizzes)
        .set({
          questionsData: validatedResult.questions as any,
          chunkMapping: chunkMapping as any,
          metadata: {
            model: (await this.connectionManager.getChatClient())?.modelId || 'unknown',
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

      // 更新状态为失败
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
   * 获取题库
   */
  getQuiz(quizId: string): Quiz | undefined {
    const db = getDatabase()
    const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get()
    return quiz
  }

  /**
   * 获取笔记本最新版本题库
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
   * 提交答题会话
   */
  submitSession(quizId: string, answers: Record<string, number>): string {
    const db = getDatabase()
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    // 获取题库
    const quiz = this.getQuiz(quizId)
    if (!quiz) {
      throw new Error('题库不存在')
    }

    const questions = quiz.questionsData as QuizQuestion[]

    // 计算分数
    let correctCount = 0
    questions.forEach((question) => {
      const userAnswer = answers[question.id]
      if (userAnswer !== undefined && userAnswer === question.correctAnswer) {
        correctCount++
      }
    })

    const totalQuestions = questions.length
    const score = Math.round((correctCount / totalQuestions) * 100)

    // 创建会话记录
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
   * 获取答题会话
   */
  getSession(sessionId: string): QuizSession | undefined {
    const db = getDatabase()
    const session = db.select().from(quizSessions).where(eq(quizSessions.id, sessionId)).get()
    return session
  }

  /**
   * 更新题库
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
   * 删除题库
   */
  deleteQuiz(quizId: string): void {
    const db = getDatabase()

    // 先删除关联的 item
    db.delete(items)
      .where(and(eq(items.type, 'quiz'), eq(items.resourceId, quizId)))
      .run()
    Logger.info('QuizService', `Deleted item for quiz: ${quizId}`)

    // 删除题库本身（会级联删除quizSessions）
    db.delete(quizzes).where(eq(quizzes.id, quizId)).run()
    executeCheckpoint('PASSIVE')
    Logger.info('QuizService', `Quiz deleted: ${quizId}`)
  }
}
