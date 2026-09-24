/**
 * MindMapService
 * 思维导图服务 - 生成和管理笔记本的派生知识结构
 */

import { getDatabase, executeCheckpoint } from '../db'
import { mindMaps, documents, chunks, notebooks, items } from '../db/schema'
import type { MindMap, NewMindMap } from '../db/schema'
import type { MindMapTreeNode, MindMapGenerationResult } from '../../shared/types/mindmap'
import { eq, desc, and, inArray } from 'drizzle-orm'
import { ConnectionManager } from '../models/ConnectionManager'
// import { KnowledgeService } from './KnowledgeService'
import { streamObject } from 'ai'
import { z } from 'zod'
import Logger from '../../shared/utils/logger'
import { settingsManager } from '../config'

/**
 * 进度回调函数类型
 */
export type MindMapProgressCallback = (stage: string, progress: number) => void

/**
 * Zod Schema 定义思维导图结构
 */
const MindMapNodeSchema: z.ZodType<MindMapTreeNode> = z.lazy(() =>
  z.object({
    id: z.string().describe('节点唯一ID'),
    label: z.string().max(24).describe('节点标签，中文≤12字，英文≤24字符'),
    children: z.array(MindMapNodeSchema).optional().describe('子节点数组,每个父节点2-5个子节点'),
    metadata: z
      .object({
        level: z.number().min(0).max(3).describe('层级深度 0-3'),
        chunkIds: z.array(z.string()).describe('关联的chunk ID列表'),
        keywords: z.array(z.string()).optional().describe('关键词')
      })
      .optional()
  })
)

const MindMapSchema = z.object({
  rootNode: MindMapNodeSchema.describe('根节点'),
  metadata: z.object({
    totalNodes: z.number().describe('总节点数'),
    maxDepth: z.number().describe('最大深度')
  })
})

/**
 * 获取思维导图生成 Prompt（支持国际化）
 * 从设置中获取对应语言的提示词
 */
async function getMindMapPrompt(): Promise<string> {
  const settings = await settingsManager.getAllSettings()
  const language = settings.language || 'zh-CN'

  // 直接从 settings 获取提示词，mergeSettings 已经确保了默认值存在
  const prompt = settings.prompts?.mindMap?.[language]

  if (!prompt) {
    throw new Error(`未找到 ${language} 语言的思维导图提示词`)
  }

  return prompt
}

/**
 * 思维导图服务
 */
export class MindMapService {
  constructor(
    private connectionManager: ConnectionManager
    // Reserved for future use

    // private _knowledgeService: KnowledgeService
  ) {}

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

      Logger.info('MindMapService', `Found ${docs.length} indexed documents`)

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
        throw new Error('笔记本没有可用内容生成思维导图')
      }

      return contentParts.join('\n\n---\n\n')
    } catch (error) {
      Logger.error('MindMapService', 'Error aggregating content:', error)
      throw error
    }
  }

  /**
   * 调用LLM生成思维导图 (使用 streamObject 结构化输出)
   */
  private async callLLMForGeneration(
    content: string,
    onProgress?: MindMapProgressCallback
  ): Promise<MindMapGenerationResult> {
    const client = await this.connectionManager.getChatClient()
    if (!client) {
      throw new Error('没有可用的对话模型,请先在设置中配置模型连接')
    }

    Logger.info('MindMapService', `Using model: ${client.label}`)

    const promptTemplate = await getMindMapPrompt()
    const prompt = promptTemplate.replace('{{CONTENT}}', content)

    try {
      onProgress?.('generating_mindmap', 30)

      // 获取 AI SDK 模型实例
      const model = client.getAIModel()

      // 使用 streamObject 生成结构化数据
      const { partialObjectStream, object } = streamObject({
        model: model,
        schema: MindMapSchema,
        prompt: prompt
      })

      // 监听流式更新 (可选,用于显示进度)
      let lastProgress = 30
      let chunkCount = 0
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _partialObject of partialObjectStream) {
        // 根据生成进度更新
        chunkCount++
        if (chunkCount % 5 === 0) {
          // 每5个chunk才更新一次进度，减少日志
          lastProgress = Math.min(lastProgress + 5, 65)
          onProgress?.('generating_mindmap', lastProgress)
        }
      }
      Logger.info('MindMapService', `Received ${chunkCount} partial updates`)

      onProgress?.('parsing_result', 70)

      // 等待完整对象
      const result = await object
      Logger.info(
        'MindMapService',
        `Generated mind map: ${result.metadata.totalNodes} nodes, depth ${result.metadata.maxDepth}`
      )

      // 基础验证
      if (!result.rootNode || !result.rootNode.id || !result.rootNode.label) {
        throw new Error('生成的思维导图格式不正确')
      }

      // 构建 chunkMapping (收集所有节点的 chunkIds)
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
      throw new Error(`生成思维导图失败: ${(error as Error).message}`)
    }
  }

  /**
   * 验证和清洗思维导图数据
   */
  private async validateAndCleanMindMap(
    notebookId: string,
    result: MindMapGenerationResult
  ): Promise<MindMapGenerationResult> {
    const db = getDatabase()

    // 收集所有提到的chunkIds
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

    // 验证chunkIds是否存在
    if (allChunkIds.size > 0) {
      const validChunks = db
        .select({ id: chunks.id })
        .from(chunks)
        .where(and(eq(chunks.notebookId, notebookId), inArray(chunks.id, Array.from(allChunkIds))))
        .all()

      const validChunkIds = new Set(validChunks.map((c) => c.id))

      // 过滤无效的chunkIds
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

    // 重新计算chunkMapping
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
   * 生成思维导图
   */
  async generateMindMap(notebookId: string, onProgress?: MindMapProgressCallback): Promise<string> {
    const db = getDatabase()
    const mindMapId = `mindmap_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
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
        .select({ version: mindMaps.version })
        .from(mindMaps)
        .where(eq(mindMaps.notebookId, notebookId))
        .orderBy(desc(mindMaps.version))
        .limit(1)
        .get()

      const newVersion = (latestVersion?.version || 0) + 1

      // 根据语言生成标题
      const titleTemplate =
        language === 'en-US' ? `${notebook.title} Mind Map` : `${notebook.title}的思维导图`

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

      // 创建对应的 item（添加到列表末尾）
      // 获取当前笔记本的最大 order 值
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

      // 2. 聚合内容
      onProgress?.('aggregating_content', 10)
      const content = await this.aggregateNotebookContent(notebookId)

      // 3. 调用LLM生成
      const result = await this.callLLMForGeneration(content, onProgress)

      // 4. 验证和清洗数据
      onProgress?.('validating_data', 80)
      const validatedResult = await this.validateAndCleanMindMap(notebookId, result)

      // 5. 更新数据库
      onProgress?.('saving_mindmap', 90)

      const generationTime = Date.now() - startTime

      db.update(mindMaps)
        .set({
          treeData: validatedResult.rootNode as any,
          chunkMapping: validatedResult.chunkMapping as any,
          metadata: {
            model: (await this.connectionManager.getChatClient())?.modelId || 'unknown',
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

      // 更新状态为失败
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
   * 获取思维导图
   */
  getMindMap(mindMapId: string): MindMap | undefined {
    const db = getDatabase()
    const mindMap = db.select().from(mindMaps).where(eq(mindMaps.id, mindMapId)).get()
    return mindMap
  }

  /**
   * 获取笔记本最新版本思维导图
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
   * 获取节点关联的chunks
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

    // 获取文档标题
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
   * 更新思维导图
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
   * 删除思维导图
   */
  deleteMindMap(mindMapId: string): void {
    const db = getDatabase()

    // 先删除关联的 item
    db.delete(items)
      .where(and(eq(items.type, 'mindmap'), eq(items.resourceId, mindMapId)))
      .run()
    Logger.info('MindMapService', `Deleted item for mind map: ${mindMapId}`)

    // 删除思维导图本身
    db.delete(mindMaps).where(eq(mindMaps.id, mindMapId)).run()
    executeCheckpoint('PASSIVE')
    Logger.info('MindMapService', `Mind map deleted: ${mindMapId}`)
  }
}
