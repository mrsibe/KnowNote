/**
 * AnkiCardService
 * Anki 카드 서비스 - 노트북의 Anki 카드 세트 생성 및 관리
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
 * 진행률 콜백 함수 타입
 */
export type AnkiProgressCallback = (stage: string, progress: number) => void

/**
 * Anki 생성 Prompt 조회 (국제화 및 사용자 정의 지원)
 */
async function getAnkiPrompt(customPrompt?: string): Promise<string> {
  // 사용자 정의 프롬프트가 제공된 경우 직접 사용
  if (customPrompt && customPrompt.trim()) {
    return customPrompt.trim()
  }

  // 그렇지 않으면 설정에서 조회
  const settings = await settingsManager.getAllSettings()
  const language = settings.language || 'ko-KR'

  const prompt = settings.prompts?.anki?.[language]

  if (!prompt) {
    throw new Error(`${language} 언어의 Anki 카드 생성 프롬프트를 찾을 수 없습니다`)
  }

  return prompt
}

/**
 * 세 가지 카드 타입을 정의하는 Zod Schema
 */
const BasicCardSchema = z.object({
  id: z.string().describe('카드 고유 ID'),
  type: z.literal('basic'),
  front: z.string().max(300).describe('앞면: 질문 텍스트'),
  back: z.string().max(500).describe('뒷면: 답변 텍스트'),
  tags: z.array(z.string()).optional().describe('태그 배열'),
  metadata: z
    .object({
      chunkIds: z.array(z.string()).describe('연관된 chunk ID 목록'),
      difficulty: z.enum(['easy', 'medium', 'hard']).optional()
    })
    .optional()
})

const ClozeCardSchema = z.object({
  id: z.string().describe('카드 고유 ID'),
  type: z.literal('cloze'),
  text: z.string().max(500).describe('{{c1::답변}} 형식의 텍스트'),
  backExtra: z.string().max(300).optional().describe('뒷면 추가 정보'),
  tags: z.array(z.string()).optional().describe('태그 배열'),
  metadata: z
    .object({
      chunkIds: z.array(z.string()).describe('연관된 chunk ID 목록'),
      difficulty: z.enum(['easy', 'medium', 'hard']).optional()
    })
    .optional()
})

const FillBlankCardSchema = z.object({
  id: z.string().describe('카드 고유 ID'),
  type: z.literal('fill-blank'),
  sentence: z.string().max(300).describe('_____가 포함된 문장'),
  answer: z.string().max(100).describe('빈칸 답변'),
  hint: z.string().max(100).optional().describe('선택적 힌트'),
  tags: z.array(z.string()).optional().describe('태그 배열'),
  metadata: z
    .object({
      chunkIds: z.array(z.string()).describe('연관된 chunk ID 목록'),
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
 * 동적 Anki Schema 생성
 */
function createAnkiSchema(cardCount: number) {
  return z.object({
    cards: z.array(AnkiCardItemSchema).min(1).describe(`${cardCount}장 카드 (가변 수량 허용)`),
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

      Logger.info('AnkiCardService', `Found ${docs.length} indexed documents`)

      if (docs.length === 0) {
        throw new Error(
          '노트북에 카드를 생성할 수 있는 콘텐츠가 없습니다. 먼저 문서를 지식 베이스에 추가하세요'
        )
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
        throw new Error('노트북에 카드를 생성할 수 있는 콘텐츠가 없습니다')
      }

      return contentParts.join('\n\n---\n\n')
    } catch (error) {
      Logger.error('AnkiCardService', 'Error aggregating content:', error)
      throw error
    }
  }

  /**
   * LLM을 호출하여 카드 생성 (streamObject 구조화 출력 사용)
   */
  private async callLLMForGeneration(
    content: string,
    options?: AnkiGenerationOptions,
    onProgress?: AnkiProgressCallback
  ): Promise<AnkiGenerationResult> {
    const provider = await this.providerManager.getActiveChatProvider()
    if (!provider) {
      throw new Error('사용 가능한 대화 모델이 없습니다. LLM 제공자를 먼저 설정하세요')
    }

    // provider가 AISDKProvider 인스턴스인지 확인
    if (!(provider instanceof AISDKProvider)) {
      throw new Error('현재 provider는 구조화 출력을 지원하지 않습니다')
    }

    Logger.info('AnkiCardService', `Using provider: ${provider.name}`)

    // 기본 프롬프트 조회
    const promptTemplate = await getAnkiPrompt(options?.customPrompt)

    // 생성 파라미터 조회
    const cardCount = options?.cardCount || 20

    // 변수 플레이스홀더 대체
    let prompt = promptTemplate.replace(/\{\{CARD_COUNT\}\}/g, cardCount.toString())

    // 내용 플레이스홀더 대체
    prompt = prompt.replace(/\{\{CONTENT\}\}/g, content)

    try {
      onProgress?.('generating_cards', 30)

      // AI SDK 모델 인스턴스 가져오기
      const model = provider.getAIModel()

      // 동적 Schema 생성
      const AnkiSchema = createAnkiSchema(cardCount)

      // streamObject를 사용하여 구조화 데이터 생성
      const { partialObjectStream, object } = streamObject({
        model: model,
        schema: AnkiSchema,
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
          onProgress?.('generating_cards', lastProgress)
        }
      }
      Logger.info('AnkiCardService', `Received ${chunkCount} partial updates`)

      onProgress?.('parsing_result', 70)

      // 완전한 객체 대기
      const result = await object
      Logger.info('AnkiCardService', `Generated cards: ${result.metadata.totalCards}`)

      // 기본 검증
      if (!result.cards || result.cards.length < 1) {
        throw new Error('생성된 카드 수가 올바르지 않습니다')
      }

      return {
        cards: result.cards,
        metadata: result.metadata
      }
    } catch (error) {
      Logger.error('AnkiCardService', 'Error calling LLM:', error)
      throw new Error(`카드 생성 실패: ${(error as Error).message}`)
    }
  }

  /**
   * 카드 데이터 검증 및 정리
   */
  private async validateAndCleanCards(
    notebookId: string,
    result: AnkiGenerationResult
  ): Promise<AnkiGenerationResult> {
    const db = getDatabase()

    // 모든 언급된 chunkIds 수집
    const allChunkIds = new Set<string>()
    result.cards.forEach((card) => {
      if (card.metadata?.chunkIds) {
        card.metadata.chunkIds.forEach((id) => allChunkIds.add(id))
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
      result.cards = result.cards.map((card) => {
        if (card.metadata?.chunkIds) {
          card.metadata.chunkIds = card.metadata.chunkIds.filter((id) => validChunkIds.has(id))
        }
        return card
      })
    }

    // 카드 중복 제거 (front/sentence/text 중복 확인)
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
   * 카드 세트 생성
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
      // 1. 레코드 생성
      onProgress?.('creating_record', 0)

      const notebook = db.select().from(notebooks).where(eq(notebooks.id, notebookId)).get()
      if (!notebook) {
        throw new Error('노트북이 존재하지 않습니다')
      }

      // 현재 언어 설정 조회
      const settings = await settingsManager.getAllSettings()
      const language = settings.language || 'ko-KR'

      // 현재 버전 번호 조회
      const latestVersion = db
        .select({ version: ankiCards.version })
        .from(ankiCards)
        .where(eq(ankiCards.notebookId, notebookId))
        .orderBy(desc(ankiCards.version))
        .limit(1)
        .get()

      const newVersion = (latestVersion?.version || 0) + 1

      // 언어에 따라 제목 생성
      const titleTemplate =
        language === 'en-US' ? `${notebook.title} Anki Cards` : `${notebook.title}의 Anki 카드`

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

      // 해당하는 item 생성 (목록 끝에 추가)
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

      // 2. 내용 집계
      onProgress?.('aggregating_content', 10)
      const content = await this.aggregateNotebookContent(notebookId)

      // 3. LLM 호출하여 생성
      const result = await this.callLLMForGeneration(content, options, onProgress)

      // 4. 데이터 검증 및 정리
      onProgress?.('validating_data', 80)
      const validatedResult = await this.validateAndCleanCards(notebookId, result)

      // 5. chunkMapping 구축
      const chunkMapping: Record<string, string[]> = {}
      validatedResult.cards.forEach((card) => {
        if (card.metadata?.chunkIds && card.metadata.chunkIds.length > 0) {
          chunkMapping[card.id] = card.metadata.chunkIds
        }
      })

      // 6. 데이터베이스 업데이트
      onProgress?.('saving_cards', 90)

      const generationTime = Date.now() - startTime

      // 현재 provider 이름 캡처, 업데이트 시 다시 비동기 호출 방지
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

      // 상태를 실패로 업데이트
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
   * 카드 세트 조회
   */
  getAnkiCards(ankiCardId: string): AnkiCard | undefined {
    const db = getDatabase()
    const ankiCard = db.select().from(ankiCards).where(eq(ankiCards.id, ankiCardId)).get()
    return ankiCard
  }

  /**
   * 노트북의 최신 버전 카드 세트 조회
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
   * 카드 세트 업데이트
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
   * 카드 세트 삭제
   */
  deleteAnkiCards(ankiCardId: string): void {
    const db = getDatabase()

    // 연관된 item 먼저 삭제
    db.delete(items)
      .where(and(eq(items.type, 'anki'), eq(items.resourceId, ankiCardId)))
      .run()
    Logger.info('AnkiCardService', `Deleted item for anki card: ${ankiCardId}`)

    // 카드 세트 자체 삭제
    db.delete(ankiCards).where(eq(ankiCards.id, ankiCardId)).run()
    executeCheckpoint('PASSIVE')
    Logger.info('AnkiCardService', `Anki cards deleted: ${ankiCardId}`)
  }
}
