/**
 * AnkiCardService
 * Anki卡片服务 - 生成和管理笔记本的Anki卡片集
 */

import { getDatabase, executeCheckpoint } from '../db'
import { ankiCards, documents, chunks, notebooks, items } from '../db/schema'
import type { AnkiCard, NewAnkiCard } from '../db/schema'
import type {
  AnkiCardItem,
  AnkiGenerationResult,
  AnkiGenerationOptions
} from '../../shared/types/anki'
import { eq, desc, and, inArray } from 'drizzle-orm'
import { ConnectionManager } from '../models/ConnectionManager'
import { streamObject } from 'ai'
import { z } from 'zod'
import Logger from '../../shared/utils/logger'
import { settingsManager } from '../config'

/**
 * 进度回调函数类型
 */
export type AnkiProgressCallback = (stage: string, progress: number) => void

/**
 * 获取Anki生成 Prompt（支持国际化和自定义）
 */
async function getAnkiPrompt(customPrompt?: string): Promise<string> {
  // 如果提供了自定义提示词，直接使用
  if (customPrompt && customPrompt.trim()) {
    return customPrompt.trim()
  }

  // 否则从设置中获取
  const settings = await settingsManager.getAllSettings()
  const language = settings.language || 'zh-CN'

  const prompt = settings.prompts?.anki?.[language]

  if (!prompt) {
    throw new Error(`未找到 ${language} 语言的Anki卡片生成提示词`)
  }

  return prompt
}

/**
 * Zod Schema 定义三种卡片类型
 */
const BasicCardSchema = z.object({
  id: z.string().describe('卡片唯一ID'),
  type: z.literal('basic'),
  front: z.string().max(300).describe('正面:问题文本'),
  back: z.string().max(500).describe('背面:答案文本'),
  tags: z.array(z.string()).optional().describe('标签数组'),
  metadata: z
    .object({
      chunkIds: z.array(z.string()).describe('关联的chunk ID列表'),
      difficulty: z.enum(['easy', 'medium', 'hard']).optional()
    })
    .optional()
})

const ClozeCardSchema = z.object({
  id: z.string().describe('卡片唯一ID'),
  type: z.literal('cloze'),
  text: z.string().max(500).describe('带有{{c1::答案}}格式的文本'),
  backExtra: z.string().max(300).optional().describe('背面额外信息'),
  tags: z.array(z.string()).optional().describe('标签数组'),
  metadata: z
    .object({
      chunkIds: z.array(z.string()).describe('关联的chunk ID列表'),
      difficulty: z.enum(['easy', 'medium', 'hard']).optional()
    })
    .optional()
})

const FillBlankCardSchema = z.object({
  id: z.string().describe('卡片唯一ID'),
  type: z.literal('fill-blank'),
  sentence: z.string().max(300).describe('带有_____的句子'),
  answer: z.string().max(100).describe('填空答案'),
  hint: z.string().max(100).optional().describe('可选提示'),
  tags: z.array(z.string()).optional().describe('标签数组'),
  metadata: z
    .object({
      chunkIds: z.array(z.string()).describe('关联的chunk ID列表'),
      difficulty: z.enum(['easy', 'medium', 'hard']).optional()
    })
    .optional()
})

const AnkiCardItemSchema: z.ZodType<AnkiCardItem> = z.discriminatedUnion('type', [
  BasicCardSchema,
  ClozeCardSchema,
  FillBlankCardSchema
])

/**
 * 创建动态Anki Schema
 */
function createAnkiSchema(cardCount: number) {
  return z.object({
    cards: z.array(AnkiCardItemSchema).min(1).describe(`${cardCount}张卡片（允许可变数量）`),
    metadata: z.object({
      totalCards: z.number().describe('总卡片数'),
      cardTypes: z.array(z.string()).describe('卡片类型列表')
    })
  })
}

/**
 * Anki卡片服务
 */
export class AnkiCardService {
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

      Logger.info('AnkiCardService', `Found ${docs.length} indexed documents`)

      if (docs.length === 0) {
        throw new Error('笔记本没有可用内容生成卡片，请先添加文档到知识库')
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
        throw new Error('笔记本没有可用内容生成卡片')
      }

      return contentParts.join('\n\n---\n\n')
    } catch (error) {
      Logger.error('AnkiCardService', 'Error aggregating content:', error)
      throw error
    }
  }

  /**
   * 调用LLM生成卡片 (使用 streamObject 结构化输出)
   */
  private async callLLMForGeneration(
    content: string,
    options?: AnkiGenerationOptions,
    onProgress?: AnkiProgressCallback
  ): Promise<AnkiGenerationResult> {
    const client = await this.connectionManager.getChatClient()
    if (!client) {
      throw new Error('没有可用的对话模型,请先在设置中配置模型连接')
    }

    Logger.info('AnkiCardService', `Using model: ${client.label}`)

    // 获取基础提示词
    const promptTemplate = await getAnkiPrompt(options?.customPrompt)

    // 获取生成参数
    const cardCount = options?.cardCount || 20

    // 替换变量占位符
    let prompt = promptTemplate.replace(/\{\{CARD_COUNT\}\}/g, cardCount.toString())

    // 替换内容占位符
    prompt = prompt.replace(/\{\{CONTENT\}\}/g, content)

    try {
      onProgress?.('generating_cards', 30)

      // 获取 AI SDK 模型实例
      const model = client.getAIModel()

      // 创建动态Schema
      const AnkiSchema = createAnkiSchema(cardCount)

      // 使用 streamObject 生成结构化数据
      const { partialObjectStream, object } = streamObject({
        model: model,
        schema: AnkiSchema,
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
          onProgress?.('generating_cards', lastProgress)
        }
      }
      Logger.info('AnkiCardService', `Received ${chunkCount} partial updates`)

      onProgress?.('parsing_result', 70)

      // 等待完整对象
      const result = await object
      Logger.info('AnkiCardService', `Generated cards: ${result.metadata.totalCards}`)

      // 基础验证
      if (!result.cards || result.cards.length < 1) {
        throw new Error('生成的卡片数量不正确')
      }

      return {
        cards: result.cards,
        metadata: result.metadata
      }
    } catch (error) {
      Logger.error('AnkiCardService', 'Error calling LLM:', error)
      throw new Error(`生成卡片失败: ${(error as Error).message}`)
    }
  }

  /**
   * 验证和清洗卡片数据
   */
  private async validateAndCleanCards(
    notebookId: string,
    result: AnkiGenerationResult
  ): Promise<AnkiGenerationResult> {
    const db = getDatabase()

    // 收集所有提到的chunkIds
    const allChunkIds = new Set<string>()
    result.cards.forEach((card) => {
      if (card.metadata?.chunkIds) {
        card.metadata.chunkIds.forEach((id) => allChunkIds.add(id))
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
      result.cards = result.cards.map((card) => {
        if (card.metadata?.chunkIds) {
          card.metadata.chunkIds = card.metadata.chunkIds.filter((id) => validChunkIds.has(id))
        }
        return card
      })
    }

    // 卡片去重（检查front/sentence/text是否重复）
    const uniqueCards: AnkiCardItem[] = []
    const seenContents = new Set<string>()
    result.cards.forEach((card) => {
      let content = ''
      if (card.type === 'basic') {
        content = card.front
      } else if (card.type === 'cloze') {
        content = card.text
      } else if (card.type === 'fill-blank') {
        content = card.sentence
      }

      if (!seenContents.has(content)) {
        seenContents.add(content)
        uniqueCards.push(card)
      }
    })

    result.cards = uniqueCards

    return result
  }

  /**
   * 生成卡片集
   */
  async generateAnkiCards(
    notebookId: string,
    options?: AnkiGenerationOptions,
    onProgress?: AnkiProgressCallback
  ): Promise<string> {
    const db = getDatabase()
    const ankiCardId = `anki_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
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
        .select({ version: ankiCards.version })
        .from(ankiCards)
        .where(eq(ankiCards.notebookId, notebookId))
        .orderBy(desc(ankiCards.version))
        .limit(1)
        .get()

      const newVersion = (latestVersion?.version || 0) + 1

      // 根据语言生成标题
      const titleTemplate =
        language === 'en-US' ? `${notebook.title} Anki Cards` : `${notebook.title}的Anki卡片`

      const newAnkiCard: NewAnkiCard = {
        id: ankiCardId,
        notebookId,
        title: titleTemplate,
        version: newVersion,
        cardsData: [] as any,
        chunkMapping: {} as any,
        status: 'generating',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      db.insert(ankiCards).values(newAnkiCard).run()
      Logger.info('AnkiCardService', `Created anki card: ${ankiCardId}, version: ${newVersion}`)

      // 创建对应的 item（添加到列表末尾）
      const existingItems = db.select().from(items).where(eq(items.notebookId, notebookId)).all()
      const maxOrder = existingItems.reduce((max, item) => Math.max(max, item.order), -1)
      const newOrder = maxOrder + 1

      const itemId = `item-anki-${ankiCardId}`
      db.insert(items)
        .values({
          id: itemId,
          notebookId,
          type: 'anki',
          resourceId: ankiCardId,
          order: newOrder,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .run()
      Logger.info(
        'AnkiCardService',
        `Created item for anki card: ${itemId} with order: ${newOrder}`
      )

      // 2. 聚合内容
      onProgress?.('aggregating_content', 10)
      const content = await this.aggregateNotebookContent(notebookId)

      // 3. 调用LLM生成
      const result = await this.callLLMForGeneration(content, options, onProgress)

      // 4. 验证和清洗数据
      onProgress?.('validating_data', 80)
      const validatedResult = await this.validateAndCleanCards(notebookId, result)

      // 5. 构建chunkMapping
      const chunkMapping: Record<string, string[]> = {}
      validatedResult.cards.forEach((card) => {
        if (card.metadata?.chunkIds && card.metadata.chunkIds.length > 0) {
          chunkMapping[card.id] = card.metadata.chunkIds
        }
      })

      // 6. 更新数据库
      onProgress?.('saving_cards', 90)

      const generationTime = Date.now() - startTime

      // 捕获当前模型 ID，避免在更新时再次异步调用
      const activeProvider = await this.connectionManager.getChatClient()
      const providerName = activeProvider?.modelId || 'unknown'

      db.update(ankiCards)
        .set({
          cardsData: validatedResult.cards as any,
          chunkMapping: chunkMapping as any,
          metadata: {
            model: providerName,
            totalCards: validatedResult.metadata.totalCards,
            cardTypes: validatedResult.metadata.cardTypes,
            generationTime
          } as any,
          status: 'completed',
          updatedAt: new Date()
        })
        .where(eq(ankiCards.id, ankiCardId))
        .run()

      executeCheckpoint('PASSIVE')
      onProgress?.('completed', 100)

      Logger.info('AnkiCardService', `Anki cards generated successfully: ${ankiCardId}`)
      return ankiCardId
    } catch (error) {
      Logger.error('AnkiCardService', 'Error generating anki cards:', error)

      // 更新状态为失败
      db.update(ankiCards)
        .set({
          status: 'failed',
          errorMessage: (error as Error).message,
          updatedAt: new Date()
        })
        .where(eq(ankiCards.id, ankiCardId))
        .run()

      throw error
    }
  }

  /**
   * 获取卡片集
   */
  getAnkiCards(ankiCardId: string): AnkiCard | undefined {
    const db = getDatabase()
    const ankiCard = db.select().from(ankiCards).where(eq(ankiCards.id, ankiCardId)).get()
    return ankiCard
  }

  /**
   * 获取笔记本最新版本卡片集
   */
  getLatestAnkiCards(notebookId: string): AnkiCard | undefined {
    const db = getDatabase()
    const ankiCard = db
      .select()
      .from(ankiCards)
      .where(and(eq(ankiCards.notebookId, notebookId), eq(ankiCards.status, 'completed')))
      .orderBy(desc(ankiCards.version))
      .limit(1)
      .get()
    return ankiCard
  }

  /**
   * 更新卡片集
   */
  updateAnkiCards(ankiCardId: string, updates: Partial<{ title: string }>): void {
    const db = getDatabase()
    db.update(ankiCards)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(ankiCards.id, ankiCardId))
      .run()
    executeCheckpoint('PASSIVE')
    Logger.info('AnkiCardService', `Anki cards updated: ${ankiCardId}`)
  }

  /**
   * 删除卡片集
   */
  deleteAnkiCards(ankiCardId: string): void {
    const db = getDatabase()

    // 先删除关联的 item
    db.delete(items)
      .where(and(eq(items.type, 'anki'), eq(items.resourceId, ankiCardId)))
      .run()
    Logger.info('AnkiCardService', `Deleted item for anki card: ${ankiCardId}`)

    // 删除卡片集本身
    db.delete(ankiCards).where(eq(ankiCards.id, ankiCardId)).run()
    executeCheckpoint('PASSIVE')
    Logger.info('AnkiCardService', `Anki cards deleted: ${ankiCardId}`)
  }
}
