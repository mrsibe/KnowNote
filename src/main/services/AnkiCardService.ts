/**
 * AnkiCardService
 * Anki 카드 서비스 - 생성및관리노트북의Anki카드세트
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
import { ProviderManager } from '../providers/ProviderManager'
import { AISDKProvider } from '../providers/base/AISDKProvider'
import { streamObject } from 'ai'
import { z } from 'zod'
import Logger from '../../shared/utils/logger'
import { settingsManager } from '../config'

/**
 * 진행콜백함수타입
 */
export type AnkiProgressCallback = (stage: string, progress: number) => void

/**
 * 조회Anki생성 Prompt（지원국실제화및자체정의）
 */
async function getAnkiPrompt(customPrompt?: string): Promise<string> {
  // 만약제공자체정의힌트，직접사용
  if (customPrompt && customPrompt.trim()) {
    return customPrompt.trim()
  }

  // 아니오에서설정에서조회
  const settings = await settingsManager.getAllSettings()
  const language = settings.language || 'ko-KR'

  const prompt = settings.prompts?.anki?.[language]

  if (!prompt) {
    throw new Error(`찾을 수 없음 ${language} 언어의Anki카드생성힌트`)
  }

  return prompt
}

/**
 * Zod Schema 정의세종류카드타입
 */
const BasicCardSchema = z.object({
  id: z.string().describe('카드 고유 ID'),
  type: z.literal('basic'),
  front: z.string().max(300).describe('앞면: 질문 텍스트'),
  back: z.string().max(500).describe('뒷면: 답변 텍스트'),
  tags: z.array(z.string()).optional().describe('태그 배열'),
  metadata: z
    .object({
      chunkIds: z.array(z.string()).describe('관련 chunk ID 목록'),
      difficulty: z.enum(['easy', 'medium', 'hard']).optional()
    })
    .optional()
})

const ClozeCardSchema = z.object({
  id: z.string().describe('카드 고유 ID'),
  type: z.literal('cloze'),
  text: z.string().max(500).describe('{{c1::답변}} 형식을 포함하는 텍스트'),
  backExtra: z.string().max(300).optional().describe('뒷면 추가 정보'),
  tags: z.array(z.string()).optional().describe('태그 배열'),
  metadata: z
    .object({
      chunkIds: z.array(z.string()).describe('관련 chunk ID 목록'),
      difficulty: z.enum(['easy', 'medium', 'hard']).optional()
    })
    .optional()
})

const FillBlankCardSchema = z.object({
  id: z.string().describe('카드 고유 ID'),
  type: z.literal('fill-blank'),
  sentence: z.string().max(300).describe('_____를 포함하는 문장'),
  answer: z.string().max(100).describe('빈칸 답변'),
  hint: z.string().max(100).optional().describe('선택적 힌트'),
  tags: z.array(z.string()).optional().describe('태그 배열'),
  metadata: z
    .object({
      chunkIds: z.array(z.string()).describe('관련 chunk ID 목록'),
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
 * 생성동상태Anki Schema
 */
function createAnkiSchema(cardCount: number) {
  return z.object({
    cards: z.array(AnkiCardItemSchema).min(1).describe(`${cardCount}장 카드 (변동 수량 허용)`),
    metadata: z.object({
      totalCards: z.number().describe('총 카드 수'),
      cardTypes: z.array(z.string()).describe('카드 타입 목록')
    })
  })
}

/**
 * Anki 카드 서비스
 */
export class AnkiCardService {
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

      Logger.info('AnkiCardService', `Found ${docs.length} indexed documents`)

      if (docs.length === 0) {
        throw new Error('노트북없있는사용 가능내용생성카드，요청먼저문서 추가에지식 베이스')
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
        throw new Error('노트북없있는사용 가능내용생성카드')
      }

      return contentParts.join('\n\n---\n\n')
    } catch (error) {
      Logger.error('AnkiCardService', 'Error aggregating content:', error)
      throw error
    }
  }

  /**
   * 호출LLM생성카드 (사용 streamObject 결구조화출력)
   */
  private async callLLMForGeneration(
    content: string,
    options?: AnkiGenerationOptions,
    onProgress?: AnkiProgressCallback
  ): Promise<AnkiGenerationResult> {
    const provider = await this.providerManager.getActiveChatProvider()
    if (!provider) {
      throw new Error('없있는사용 가능의대화모델,요청먼저설정LLM제공자')
    }

    // 보장 provider 예 AISDKProvider 인스턴스
    if (!(provider instanceof AISDKProvider)) {
      throw new Error('현재 provider 미지원결구조화출력')
    }

    Logger.info('AnkiCardService', `Using provider: ${provider.name}`)

    // 조회기본힌트
    const promptTemplate = await getAnkiPrompt(options?.customPrompt)

    // 조회생성매개변수
    const cardCount = options?.cardCount || 20

    // 치환변수플레이스홀더
    let prompt = promptTemplate.replace(/\{\{CARD_COUNT\}\}/g, cardCount.toString())

    // 치환내용플레이스홀더
    prompt = prompt.replace(/\{\{CONTENT\}\}/g, content)

    try {
      onProgress?.('generating_cards', 30)

      // 조회 AI SDK 모델인스턴스
      const model = provider.getAIModel()

      // 생성동상태Schema
      const AnkiSchema = createAnkiSchema(cardCount)

      // 사용 streamObject 생성결구조화데이터
      const { partialObjectStream, object } = streamObject({
        model: model,
        schema: AnkiSchema,
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
          onProgress?.('generating_cards', lastProgress)
        }
      }
      Logger.info('AnkiCardService', `Received ${chunkCount} partial updates`)

      onProgress?.('parsing_result', 70)

      // 등대기완전한객체
      const result = await object
      Logger.info('AnkiCardService', `Generated cards: ${result.metadata.totalCards}`)

      // 기본검증
      if (!result.cards || result.cards.length < 1) {
        throw new Error('생성의카드수량아닌정확인')
      }

      return {
        cards: result.cards,
        metadata: result.metadata
      }
    } catch (error) {
      Logger.error('AnkiCardService', 'Error calling LLM:', error)
      throw new Error(`생성카드실패: ${(error as Error).message}`)
    }
  }

  /**
   * 검증및정리세척카드데이터
   */
  private async validateAndCleanCards(
    notebookId: string,
    result: AnkiGenerationResult
  ): Promise<AnkiGenerationResult> {
    const db = getDatabase()

    // 수세트모든제에의chunkIds
    const allChunkIds = new Set<string>()
    result.cards.forEach((card) => {
      if (card.metadata?.chunkIds) {
        card.metadata.chunkIds.forEach((id) => allChunkIds.add(id))
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
      result.cards = result.cards.map((card) => {
        if (card.metadata?.chunkIds) {
          card.metadata.chunkIds = card.metadata.chunkIds.filter((id) => validChunkIds.has(id))
        }
        return card
      })
    }

    // 카드제거재（확인front/sentence/text예아니오재복）
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
   * 생성카드세트
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
        .select({ version: ankiCards.version })
        .from(ankiCards)
        .where(eq(ankiCards.notebookId, notebookId))
        .orderBy(desc(ankiCards.version))
        .limit(1)
        .get()

      const newVersion = (latestVersion?.version || 0) + 1

      // 기반으로언어생성제목
      const titleTemplate =
        language === 'en-US' ? `${notebook.title} Anki Cards` : `${notebook.title}의Anki카드`

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

      // 생성의 item（추가에목록끝끝）
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

      // 2. 집계내용
      onProgress?.('aggregating_content', 10)
      const content = await this.aggregateNotebookContent(notebookId)

      // 3. 호출LLM생성
      const result = await this.callLLMForGeneration(content, options, onProgress)

      // 4. 검증및정리세척데이터
      onProgress?.('validating_data', 80)
      const validatedResult = await this.validateAndCleanCards(notebookId, result)

      // 5. 빌드chunkMapping
      const chunkMapping: Record<string, string[]> = {}
      validatedResult.cards.forEach((card) => {
        if (card.metadata?.chunkIds && card.metadata.chunkIds.length > 0) {
          chunkMapping[card.id] = card.metadata.chunkIds
        }
      })

      // 6. 업데이트데이터베이스
      onProgress?.('saving_cards', 90)

      const generationTime = Date.now() - startTime

      // 캡처획득현재 provider 이름，회피면업데이트시다시번비동기호출
      const activeProvider = await this.providerManager.getActiveChatProvider()
      const providerName = activeProvider?.name || 'unknown'

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

      // 업데이트상태실패
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
   * 조회카드세트
   */
  getAnkiCards(ankiCardId: string): AnkiCard | undefined {
    const db = getDatabase()
    const ankiCard = db.select().from(ankiCards).where(eq(ankiCards.id, ankiCardId)).get()
    return ankiCard
  }

  /**
   * 노트북 조회최신버전카드세트
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
   * 업데이트카드세트
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
   * 삭제카드세트
   */
  deleteAnkiCards(ankiCardId: string): void {
    const db = getDatabase()

    // 먼저삭제연관된 item
    db.delete(items)
      .where(and(eq(items.type, 'anki'), eq(items.resourceId, ankiCardId)))
      .run()
    Logger.info('AnkiCardService', `Deleted item for anki card: ${ankiCardId}`)

    // 삭제카드세트자
    db.delete(ankiCards).where(eq(ankiCards.id, ankiCardId)).run()
    executeCheckpoint('PASSIVE')
    Logger.info('AnkiCardService', `Anki cards deleted: ${ankiCardId}`)
  }
}
