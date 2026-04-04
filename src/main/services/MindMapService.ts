/**
 * MindMapService
 * 마인드맵 서비스 - 노트북의 파생 지식 구조 생성 및 관리
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
 * 진행률 콜백 함수 타입
 */
export type MindMapProgressCallback = (stage: string, progress: number) => void

/**
 * 마인드맵 구조를 정의하는 Zod Schema
 */
const MindMapNodeSchema: z.ZodType<MindMapTreeNode> = z.lazy(() =>
  z.object({
    id: z.string().describe('노드 고유 ID'),
    label: z.string().max(24).describe('노드 라벨, 한국어 12자 이하, 영어 24자 이하'),
    children: z.array(MindMapNodeSchema).optional().describe('자식 노드 배열, 부모 노드당 2-5개'),
    metadata: z
      .object({
        level: z.number().min(0).max(3).describe('계층 깊이 0-3'),
        chunkIds: z.array(z.string()).describe('연관된 chunk ID 목록'),
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
 * 마인드맵 생성 Prompt 조회 (국제화 지원)
 * 설정에서 해당 언어의 프롬프트를 가져옵니다
 */
async function getMindMapPrompt(): Promise<string> {
  const settings = await settingsManager.getAllSettings()
  const language = settings.language || 'zh-CN'

  // settings에서 직접 프롬프트 조회, mergeSettings가 이미 기본값 보장
  const prompt = settings.prompts?.mindMap?.[language]

  if (!prompt) {
    throw new Error(`${language} 언어의 마인드맵 프롬프트를 찾을 수 없습니다`)
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

      Logger.info('MindMapService', `Found ${docs.length} indexed documents`)

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
        throw new Error('노트북에 마인드맵을 생성할 수 있는 콘텐츠가 없습니다')
      }

      return contentParts.join('\n\n---\n\n')
    } catch (error) {
      Logger.error('MindMapService', 'Error aggregating content:', error)
      throw error
    }
  }

  /**
   * LLM을 호출하여 마인드맵 생성 (streamObject 구조화 출력 사용)
   */
  private async callLLMForGeneration(
    content: string,
    onProgress?: MindMapProgressCallback
  ): Promise<MindMapGenerationResult> {
    const provider = await this.providerManager.getActiveChatProvider()
    if (!provider) {
      throw new Error('사용 가능한 대화 모델이 없습니다. LLM 제공자를 먼저 설정하세요')
    }

    // provider가 AISDKProvider 인스턴스인지 확인
    if (!(provider instanceof AISDKProvider)) {
      throw new Error('현재 provider는 구조화 출력을 지원하지 않습니다')
    }

    Logger.info('MindMapService', `Using provider: ${provider.name}`)

    const promptTemplate = await getMindMapPrompt()
    const prompt = promptTemplate.replace('{{CONTENT}}', content)

    try {
      onProgress?.('generating_mindmap', 30)

      // AI SDK 모델 인스턴스 가져오기
      const model = provider.getAIModel()

      // streamObject를 사용하여 구조화 데이터 생성
      const { partialObjectStream, object } = streamObject({
        model: model,
        schema: MindMapSchema,
        prompt: prompt
      })

      // 스트리밍 업데이트 모니터링 (선택, 진행률 표시용)
      let lastProgress = 30
      let chunkCount = 0
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _partialObject of partialObjectStream) {
        // 생성 진행률에 따라 업데이트
        chunkCount++
        if (chunkCount % 5 === 0) {
          // 5개 chunk마다 진행률 업데이트, 로그 감소
          lastProgress = Math.min(lastProgress + 5, 65)
          onProgress?.('generating_mindmap', lastProgress)
        }
      }
      Logger.info('MindMapService', `Received ${chunkCount} partial updates`)

      onProgress?.('parsing_result', 70)

      // 완전한 객체 대기
      const result = await object
      Logger.info(
        'MindMapService',
        `Generated mind map: ${result.metadata.totalNodes} nodes, depth ${result.metadata.maxDepth}`
      )

      // 기본 검증
      if (!result.rootNode || !result.rootNode.id || !result.rootNode.label) {
        throw new Error('생성된 마인드맵 형식이 올바르지 않습니다')
      }

      // chunkMapping 구축 (모든 노드의 chunkIds 수집)
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
      throw new Error(`마인드맵 생성 실패: ${(error as Error).message}`)
    }
  }

  /**
   * 마인드맵 데이터 검증 및 정리
   */
  private async validateAndCleanMindMap(
    notebookId: string,
    result: MindMapGenerationResult
  ): Promise<MindMapGenerationResult> {
    const db = getDatabase()

    // 모든 언급된 chunkIds 수집
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

    // chunkIds 존재 여부 검증
    if (allChunkIds.size > 0) {
      const validChunks = db
        .select({ id: chunks.id })
        .from(chunks)
        .where(and(eq(chunks.notebookId, notebookId), inArray(chunks.id, Array.from(allChunkIds))))
        .all()

      const validChunkIds = new Set(validChunks.map((c) => c.id))

      // 유효하지 않은 chunkIds 필터링
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

    // chunkMapping 재계산
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
        .select({ version: mindMaps.version })
        .from(mindMaps)
        .where(eq(mindMaps.notebookId, notebookId))
        .orderBy(desc(mindMaps.version))
        .limit(1)
        .get()

      const newVersion = (latestVersion?.version || 0) + 1

      // 언어에 따라 제목 생성
      const titleTemplate =
        language === 'en-US' ? `${notebook.title} Mind Map` : `${notebook.title}의 마인드맵`

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

      // 해당하는 item 생성 (목록 끝에 추가)
      // 현재 노트북의 최대 order 값 조회
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

      // 2. 내용 집계
      onProgress?.('aggregating_content', 10)
      const content = await this.aggregateNotebookContent(notebookId)

      // 3. LLM 호출하여 생성
      const result = await this.callLLMForGeneration(content, onProgress)

      // 4. 데이터 검증 및 정리
      onProgress?.('validating_data', 80)
      const validatedResult = await this.validateAndCleanMindMap(notebookId, result)

      // 5. 데이터베이스 업데이트
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

      // 상태를 실패로 업데이트
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
   * 노트북의 최신 버전 마인드맵 조회
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
   * 노드에 연관된 chunks 조회
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

    // 문서 제목 조회
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
   * 마인드맵 업데이트
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

    // 연관된 item 먼저 삭제
    db.delete(items)
      .where(and(eq(items.type, 'mindmap'), eq(items.resourceId, mindMapId)))
      .run()
    Logger.info('MindMapService', `Deleted item for mind map: ${mindMapId}`)

    // 마인드맵 자체 삭제
    db.delete(mindMaps).where(eq(mindMaps.id, mindMapId)).run()
    executeCheckpoint('PASSIVE')
    Logger.info('MindMapService', `Mind map deleted: ${mindMapId}`)
  }
}
