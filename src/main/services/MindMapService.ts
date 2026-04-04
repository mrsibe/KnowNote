/**
 * MindMapService
 * 마인드맵 서비스 - 생성및관리노트북의파견생지식결구조
 */

import { getDatabase, executeCheckpoint } from '../db'
import { mindMaps, documents, chunks, notebooks, items } from '../db/schema'
import type { MindMap, NewMindMap } from '../db/schema'
import type { MindMapTreeNode, MindMapGenerationResult } from '../../shared/types/mindmap'
import { eq, desc, and, inArray } from 'drizzle-orm'
import { ProviderManager } from '../providers/ProviderManager'
// import { KnowledgeService } from './KnowledgeService'
import { AISDKProvider } from '../providers/base/AISDKProvider'
import { streamObject } from 'ai'
import { z } from 'zod'
import Logger from '../../shared/utils/logger'
import { settingsManager } from '../config'

/**
 * 진행콜백함수타입
 */
export type MindMapProgressCallback = (stage: string, progress: number) => void

/**
 * Zod Schema 정의마인드맵결구조
 */
const MindMapNodeSchema: z.ZodType<MindMapTreeNode> = z.lazy(() =>
  z.object({
    id: z.string().describe('노드 고유 ID'),
    label: z.string().max(24).describe('노드 라벨, 한국어 ≤12자, 영어 ≤24자'),
    children: z.array(MindMapNodeSchema).optional().describe('자식 노드 배열, 각 부모 노드는 2-5개의 자식 노드'),
    metadata: z
      .object({
        level: z.number().min(0).max(3).describe('계층 깊이 0-3'),
        chunkIds: z.array(z.string()).describe('관련 chunk ID 목록'),
        keywords: z.array(z.string()).optional().describe('키워드')
      })
      .optional()
  })
)

const MindMapSchema = z.object({
  rootNode: MindMapNodeSchema.describe('루트 노드'),
  metadata: z.object({
    totalNodes: z.number().describe('총 노드 수'),
    maxDepth: z.number().describe('최대 깊이')
  })
})

/**
 * 마인드맵 조회생성 Prompt（지원국실제화）
 * 에서설정에서조회언어의힌트
 */
async function getMindMapPrompt(): Promise<string> {
  const settings = await settingsManager.getAllSettings()
  const language = settings.language || 'ko-KR'

  // 직접에서 settings 조회힌트，mergeSettings 이미보장기본값존재
  const prompt = settings.prompts?.mindMap?.[language]

  if (!prompt) {
    throw new Error(`찾을 수 없음 ${language} 언어의마인드맵힌트`)
  }

  return prompt
}

/**
 * 마인드맵 서비스
 */
export class MindMapService {
  constructor(
    private providerManager: ProviderManager
    // Reserved for future use

    // private _knowledgeService: KnowledgeService
  ) {}

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

      Logger.info('MindMapService', `Found ${docs.length} indexed documents`)

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
        throw new Error('노트북없있는사용 가능내용마인드맵 생성')
      }

      return contentParts.join('\n\n---\n\n')
    } catch (error) {
      Logger.error('MindMapService', 'Error aggregating content:', error)
      throw error
    }
  }

  /**
   * 호출LLM마인드맵 생성 (사용 streamObject 결구조화출력)
   */
  private async callLLMForGeneration(
    content: string,
    onProgress?: MindMapProgressCallback
  ): Promise<MindMapGenerationResult> {
    const provider = await this.providerManager.getActiveChatProvider()
    if (!provider) {
      throw new Error('없있는사용 가능의대화모델,요청먼저설정LLM제공자')
    }

    // 보장 provider 예 AISDKProvider 인스턴스
    if (!(provider instanceof AISDKProvider)) {
      throw new Error('현재 provider 미지원결구조화출력')
    }

    Logger.info('MindMapService', `Using provider: ${provider.name}`)

    const promptTemplate = await getMindMapPrompt()
    const prompt = promptTemplate.replace('{{CONTENT}}', content)

    try {
      onProgress?.('generating_mindmap', 30)

      // 조회 AI SDK 모델인스턴스
      const model = provider.getAIModel()

      // 사용 streamObject 생성결구조화데이터
      const { partialObjectStream, object } = streamObject({
        model: model,
        schema: MindMapSchema,
        prompt: prompt
      })

      // 감시스트림형식업데이트 (선택,용도:표시진행)
      let lastProgress = 30
      let chunkCount = 0
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _partialObject of partialObjectStream) {
        // 기반으로생성진행업데이트
        chunkCount++
        if (chunkCount % 5 === 0) {
          // 매5개chunk업데이트하나번진행，감소적은로그
          lastProgress = Math.min(lastProgress + 5, 65)
          onProgress?.('generating_mindmap', lastProgress)
        }
      }
      Logger.info('MindMapService', `Received ${chunkCount} partial updates`)

      onProgress?.('parsing_result', 70)

      // 등대기완전한객체
      const result = await object
      Logger.info(
        'MindMapService',
        `Generated mind map: ${result.metadata.totalNodes} nodes, depth ${result.metadata.maxDepth}`
      )

      // 기본검증
      if (!result.rootNode || !result.rootNode.id || !result.rootNode.label) {
        throw new Error('생성의마인드맵형식아닌정확인')
      }

      // 빌드 chunkMapping (수세트모든노드의 chunkIds)
      const chunkMapping: Record<string, string[]> = {}
      const collectChunkMapping = (node: MindMapTreeNode) => {
        if (node.metadata?.chunkIds && node.metadata.chunkIds.length > 0) {
          chunkMapping[node.id] = node.metadata.chunkIds
        }
        node.children?.forEach(collectChunkMapping)
      }
      collectChunkMapping(result.rootNode)

      return {
        rootNode: result.rootNode,
        chunkMapping: chunkMapping,
        metadata: result.metadata
      }
    } catch (error) {
      Logger.error('MindMapService', 'Error calling LLM:', error)
      throw new Error(`마인드맵 생성실패: ${(error as Error).message}`)
    }
  }

  /**
   * 검증및정리세척마인드맵데이터
   */
  private async validateAndCleanMindMap(
    notebookId: string,
    result: MindMapGenerationResult
  ): Promise<MindMapGenerationResult> {
    const db = getDatabase()

    // 수세트모든제에의chunkIds
    const allChunkIds = new Set<string>()
    const collectChunkIds = (node: MindMapTreeNode) => {
      if (node.metadata?.chunkIds) {
        node.metadata.chunkIds.forEach((id) => allChunkIds.add(id))
      }
      if (node.children) {
        node.children.forEach(collectChunkIds)
      }
    }
    collectChunkIds(result.rootNode)

    // 검증chunkIds예아니오존재
    if (allChunkIds.size > 0) {
      const validChunks = db
        .select({ id: chunks.id })
        .from(chunks)
        .where(and(eq(chunks.notebookId, notebookId), inArray(chunks.id, Array.from(allChunkIds))))
        .all()

      const validChunkIds = new Set(validChunks.map((c) => c.id))

      // 필터링유효하지 않음의chunkIds
      const cleanNode = (node: MindMapTreeNode): MindMapTreeNode => {
        const cleanedNode = { ...node }
        if (cleanedNode.metadata?.chunkIds) {
          cleanedNode.metadata.chunkIds = cleanedNode.metadata.chunkIds.filter((id) =>
            validChunkIds.has(id)
          )
        }
        if (cleanedNode.children) {
          cleanedNode.children = cleanedNode.children.map(cleanNode)
        }
        return cleanedNode
      }

      result.rootNode = cleanNode(result.rootNode)
    }

    // 재새계산chunkMapping
    result.chunkMapping = {}
    const buildMapping = (node: MindMapTreeNode) => {
      if (node.metadata?.chunkIds && node.metadata.chunkIds.length > 0) {
        result.chunkMapping[node.id] = node.metadata.chunkIds
      }
      if (node.children) {
        node.children.forEach(buildMapping)
      }
    }
    buildMapping(result.rootNode)

    return result
  }

  /**
   * 마인드맵 생성
   */
  async generateMindMap(notebookId: string, onProgress?: MindMapProgressCallback): Promise<string> {
    const db = getDatabase()
    const mindMapId = `mindmap_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
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
        .select({ version: mindMaps.version })
        .from(mindMaps)
        .where(eq(mindMaps.notebookId, notebookId))
        .orderBy(desc(mindMaps.version))
        .limit(1)
        .get()

      const newVersion = (latestVersion?.version || 0) + 1

      // 기반으로언어생성제목
      const titleTemplate =
        language === 'en-US' ? `${notebook.title} Mind Map` : `${notebook.title}의마인드맵`

      const newMindMap: NewMindMap = {
        id: mindMapId,
        notebookId,
        title: titleTemplate,
        version: newVersion,
        treeData: { id: 'root', label: '', children: [] } as any,
        chunkMapping: {} as any,
        status: 'generating',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      db.insert(mindMaps).values(newMindMap).run()
      Logger.info('MindMapService', `Created mind map: ${mindMapId}, version: ${newVersion}`)

      // 생성의 item（추가에목록끝끝）
      // 현재 조회노트북의최대 order 값
      const existingItems = db.select().from(items).where(eq(items.notebookId, notebookId)).all()
      const maxOrder = existingItems.reduce((max, item) => Math.max(max, item.order), -1)
      const newOrder = maxOrder + 1

      const itemId = `item-mindmap-${mindMapId}`
      db.insert(items)
        .values({
          id: itemId,
          notebookId,
          type: 'mindmap',
          resourceId: mindMapId,
          order: newOrder,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .run()
      Logger.info('MindMapService', `Created item for mind map: ${itemId} with order: ${newOrder}`)

      // 2. 집계내용
      onProgress?.('aggregating_content', 10)
      const content = await this.aggregateNotebookContent(notebookId)

      // 3. 호출LLM생성
      const result = await this.callLLMForGeneration(content, onProgress)

      // 4. 검증및정리세척데이터
      onProgress?.('validating_data', 80)
      const validatedResult = await this.validateAndCleanMindMap(notebookId, result)

      // 5. 업데이트데이터베이스
      onProgress?.('saving_mindmap', 90)

      const generationTime = Date.now() - startTime

      db.update(mindMaps)
        .set({
          treeData: validatedResult.rootNode as any,
          chunkMapping: validatedResult.chunkMapping as any,
          metadata: {
            model: (await this.providerManager.getActiveChatProvider())?.name || 'unknown',
            totalNodes: validatedResult.metadata.totalNodes,
            maxDepth: validatedResult.metadata.maxDepth,
            generationTime
          } as any,
          status: 'completed',
          updatedAt: new Date()
        })
        .where(eq(mindMaps.id, mindMapId))
        .run()

      executeCheckpoint('PASSIVE')
      onProgress?.('completed', 100)

      Logger.info('MindMapService', `Mind map generated successfully: ${mindMapId}`)
      return mindMapId
    } catch (error) {
      Logger.error('MindMapService', 'Error generating mind map:', error)

      // 업데이트상태실패
      db.update(mindMaps)
        .set({
          status: 'failed',
          errorMessage: (error as Error).message,
          updatedAt: new Date()
        })
        .where(eq(mindMaps.id, mindMapId))
        .run()

      throw error
    }
  }

  /**
   * 마인드맵 조회
   */
  getMindMap(mindMapId: string): MindMap | undefined {
    const db = getDatabase()
    const mindMap = db.select().from(mindMaps).where(eq(mindMaps.id, mindMapId)).get()
    return mindMap
  }

  /**
   * 노트북 조회최신버전마인드맵
   */
  getLatestMindMap(notebookId: string): MindMap | undefined {
    const db = getDatabase()
    const mindMap = db
      .select()
      .from(mindMaps)
      .where(and(eq(mindMaps.notebookId, notebookId), eq(mindMaps.status, 'completed')))
      .orderBy(desc(mindMaps.version))
      .limit(1)
      .get()
    return mindMap
  }

  /**
   * 조회노드연관된chunks
   */
  async getNodeChunks(
    mindMapId: string,
    nodeId: string
  ): Promise<Array<{ id: string; content: string; documentTitle: string }>> {
    const db = getDatabase()
    const mindMap = this.getMindMap(mindMapId)
    if (!mindMap) return []

    const chunkIds = (mindMap.chunkMapping as Record<string, string[]>)[nodeId] || []
    if (chunkIds.length === 0) return []

    const chunkData = db
      .select({
        id: chunks.id,
        content: chunks.content,
        documentId: chunks.documentId
      })
      .from(chunks)
      .where(inArray(chunks.id, chunkIds))
      .all()

    // 문서 조회제목
    const docIds = Array.from(new Set(chunkData.map((c) => c.documentId)))
    const docs = db.select().from(documents).where(inArray(documents.id, docIds)).all()

    const docMap = new Map(docs.map((d) => [d.id, d.title]))

    return chunkData.map((c) => ({
      id: c.id,
      content: c.content,
      documentTitle: docMap.get(c.documentId) || 'Unknown'
    }))
  }

  /**
   * 업데이트마인드맵
   */
  updateMindMap(mindMapId: string, updates: Partial<{ title: string }>): void {
    const db = getDatabase()
    db.update(mindMaps)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(mindMaps.id, mindMapId))
      .run()
    executeCheckpoint('PASSIVE')
    Logger.info('MindMapService', `Mind map updated: ${mindMapId}`)
  }

  /**
   * 마인드맵 삭제
   */
  deleteMindMap(mindMapId: string): void {
    const db = getDatabase()

    // 먼저삭제연관된 item
    db.delete(items)
      .where(and(eq(items.type, 'mindmap'), eq(items.resourceId, mindMapId)))
      .run()
    Logger.info('MindMapService', `Deleted item for mind map: ${mindMapId}`)

    // 마인드맵 삭제자
    db.delete(mindMaps).where(eq(mindMaps.id, mindMapId)).run()
    executeCheckpoint('PASSIVE')
    Logger.info('MindMapService', `Mind map deleted: ${mindMapId}`)
  }
}
