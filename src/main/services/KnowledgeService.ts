/**
 * KnowledgeService
 * 知识库核心服务，整合文档管理、分块、嵌入和检索
 */

import { createHash } from 'crypto'
import { app } from 'electron'
import { join, basename } from 'path'
import { mkdir, copyFile, unlink, stat } from 'fs/promises'
import {
  getDatabase,
  executeCheckpoint,
  getNotebookVectorTable,
  rebuildNotebookVectorTable
} from '../db'
import {
  documents,
  chunks,
  embeddings,
  notes,
  notebookEmbeddingSpaces,
  documentBlocks
} from '../db/schema'
import type {
  Document,
  Chunk,
  DocumentBlock,
  NewDocument,
  NewChunk,
  NewEmbedding,
  NewDocumentBlock
} from '../db/schema'
import { eq, desc, inArray, sql } from 'drizzle-orm'
import { EmbeddingService } from './EmbeddingService'
import type { EmbeddingSpace } from '../../shared/types'
import { ChunkingService, type ChunkOptions } from './ChunkingService'
import { FileParserService } from './FileParserService'
import { buildDocumentBlocks, type DocumentBlockDraft } from './blocks/documentBlocks'
import { WebFetchService } from './WebFetchService'
import { vectorStoreManager } from '../vectorstore'
import Logger from '../../shared/utils/logger'

/**
 * 添加文档选项
 */
export interface AddDocumentOptions {
  title: string
  type: 'file' | 'note' | 'url' | 'text'
  content: string
  sourceUri?: string
  sourceNoteId?: string
  mimeType?: string
  fileSize?: number
  metadata?: Record<string, unknown>
  chunkOptions?: ChunkOptions
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  topK?: number // 返回结果数量，默认 5
  threshold?: number // 相似度阈值，默认 0.5
  includeContent?: boolean // 是否包含 chunk 内容，默认 true
}

/**
 * 搜索结果
 */
export interface SearchResult {
  chunkId: string
  documentId: string
  documentTitle: string
  documentType: string
  content: string
  score: number
  chunkIndex: number
  metadata?: Record<string, unknown>
}

/**
 * 索引进度回调
 */
export type IndexProgressCallback = (stage: string, progress: number) => void

/**
 * 知识库服务
 * 管理文档、分块、嵌入和检索
 */
export class KnowledgeService {
  private embeddingService: EmbeddingService
  private chunkingService: ChunkingService
  private fileParserService: FileParserService
  private webFetchService: WebFetchService
  private knowledgeFilesDir: string

  constructor(embeddingService: EmbeddingService) {
    this.embeddingService = embeddingService
    this.chunkingService = new ChunkingService()
    this.fileParserService = new FileParserService()
    this.webFetchService = new WebFetchService()
    // 知识库文件存储目录
    this.knowledgeFilesDir = join(app.getPath('userData'), 'knowledge-files')
    this.ensureKnowledgeFilesDir()
  }

  /**
   * 确保知识库文件目录存在
   */
  private async ensureKnowledgeFilesDir() {
    try {
      await mkdir(this.knowledgeFilesDir, { recursive: true })
    } catch (error) {
      Logger.error('KnowledgeService', 'Failed to create knowledge files directory:', error)
    }
  }

  /**
   * 拷贝文件到知识库目录
   * @param sourceFilePath 源文件路径
   * @param documentId 文档 ID
   * @returns 本地文件路径
   */
  private async copyFileToKnowledgeDir(
    sourceFilePath: string,
    documentId: string
  ): Promise<string> {
    await this.ensureKnowledgeFilesDir()

    // 提取文件扩展名
    const extension = sourceFilePath.split('.').pop() || 'bin'
    const localFileName = `${documentId}.${extension}`
    const localFilePath = join(this.knowledgeFilesDir, localFileName)

    // 拷贝文件
    await copyFile(sourceFilePath, localFilePath)
    Logger.info('KnowledgeService', `File copied: ${sourceFilePath} -> ${localFilePath}`)

    return localFilePath
  }

  /**
   * 删除知识库中的本地文件
   * @param localFilePath 本地文件路径
   */
  private async deleteLocalFile(localFilePath: string): Promise<void> {
    try {
      const fileExists = await stat(localFilePath)
        .then(() => true)
        .catch(() => false)
      if (fileExists) {
        await unlink(localFilePath)
        Logger.info('KnowledgeService', `Local file deleted: ${localFilePath}`)
      }
    } catch (error) {
      Logger.error('KnowledgeService', 'Failed to delete local file:', error)
    }
  }

  /**
   * 添加文档到知识库
   */
  async addDocument(
    notebookId: string,
    options: AddDocumentOptions,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    const db = getDatabase()
    const documentId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const now = new Date()

    // 计算内容哈希
    const contentHash = createHash('md5').update(options.content).digest('hex')

    try {
      // 1. 创建文档记录
      onProgress?.('creating_document', 0)

      const newDoc: NewDocument = {
        id: documentId,
        notebookId,
        title: options.title,
        type: options.type,
        sourceUri: options.sourceUri,
        sourceNoteId: options.sourceNoteId,
        content: options.content,
        contentHash,
        mimeType: options.mimeType,
        fileSize: options.fileSize,
        metadata: options.metadata,
        status: 'processing',
        chunkCount: 0,
        createdAt: now,
        updatedAt: now
      }

      db.insert(documents).values(newDoc).run()

      // 1b. 持久化文档块（文本/URL/笔记没有结构，按段落平铺）
      this.persistDocumentBlocks(documentId, buildDocumentBlocks({ content: options.content }))

      // 2. 分块
      onProgress?.('chunking', 10)
      const chunkResults = this.chunkingService.chunk(options.content, options.chunkOptions)

      if (chunkResults.length === 0) {
        throw new Error('No chunks generated from document')
      }

      Logger.info('KnowledgeService', `Document ${documentId}: ${chunkResults.length} chunks`)

      // 3. 保存分块
      onProgress?.('saving_chunks', 20)
      const chunkIds: string[] = []
      const chunkContents: string[] = []

      for (const chunk of chunkResults) {
        const chunkId = `chunk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
        chunkIds.push(chunkId)
        chunkContents.push(chunk.content)

        const newChunk: NewChunk = {
          id: chunkId,
          documentId,
          notebookId,
          content: chunk.content,
          chunkIndex: chunk.index,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          tokenCount: chunk.tokenCount,
          createdAt: now
        }

        db.insert(chunks).values(newChunk).run()
      }

      // 4. 生成嵌入向量
      // 不指定维度:维度由 embedding 模型决定,写死维度会让用别的模型的笔记本直接
      // 索引失败(vec0 表的宽度在创建时固定,见 #33)。测出真实维度之后再用它建表。
      const embeddingResults = await this.embedDocumentChunks(notebookId, chunkContents, onProgress)

      if (embeddingResults.length === 0) {
        throw new Error('Embedding 服务没有返回任何向量')
      }

      // space 由模型决定;与既有 space 不一致时重建向量表并把文档标回待索引
      const detectedDimensions = embeddingResults[0].dimensions
      await this.reconcileEmbeddingSpace(
        notebookId,
        await this.embeddingService.getSpace(),
        detectedDimensions
      )
      Logger.info('KnowledgeService', `Embedding dimensions: ${detectedDimensions}`)

      // 5. 保存嵌入元数据并添加到向量存储
      onProgress?.('saving_embeddings', 85)
      const vectorStore = await vectorStoreManager.getStore(
        notebookId,
        undefined,
        detectedDimensions
      )
      const vectorItems: Array<{
        id: string
        chunkId: string
        vector: Float32Array
        metadata?: Record<string, unknown>
      }> = []

      for (let i = 0; i < chunkIds.length; i++) {
        const embeddingId = `emb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
        const embResult = embeddingResults[i]

        // 保存嵌入元数据到数据库
        const newEmbedding: NewEmbedding = {
          id: embeddingId,
          chunkId: chunkIds[i],
          notebookId,
          model: embResult.model,
          dimensions: embResult.dimensions,
          createdAt: now
        }

        db.insert(embeddings).values(newEmbedding).run()

        // 准备向量数据
        vectorItems.push({
          id: embeddingId,
          chunkId: chunkIds[i],
          vector: embResult.embedding,
          metadata: { model: embResult.model, documentId }
        })
      }

      // 批量添加到向量存储
      await vectorStore.upsert(vectorItems)

      // 6. 更新文档状态
      onProgress?.('finalizing', 95)
      db.update(documents)
        .set({
          status: 'indexed',
          chunkCount: chunkResults.length,
          updatedAt: new Date()
        })
        .where(eq(documents.id, documentId))
        .run()

      executeCheckpoint('PASSIVE')
      onProgress?.('completed', 100)

      Logger.info(
        'KnowledgeService',
        `Document indexed: ${documentId}, ${chunkResults.length} chunks`
      )
      return documentId
    } catch (error) {
      // 更新文档状态为失败
      db.update(documents)
        .set({
          status: 'failed',
          errorMessage: (error as Error).message,
          updatedAt: new Date()
        })
        .where(eq(documents.id, documentId))
        .run()

      Logger.error('KnowledgeService', 'Failed to add document:', error)
      throw error
    }
  }

  /**
   * 从文件添加文档
   */
  async addDocumentFromFile(
    notebookId: string,
    filePath: string,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    const db = getDatabase()
    const documentId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    let localFilePath: string | undefined

    try {
      onProgress?.('parsing_file', 0)

      // 先拷贝文件到知识库目录
      localFilePath = await this.copyFileToKnowledgeDir(filePath, documentId)

      const parseResult = await this.fileParserService.parseFile(filePath)

      // 计算内容哈希
      const contentHash = createHash('md5').update(parseResult.content).digest('hex')
      const now = new Date()

      // 1. 创建文档记录（包含 localFilePath）
      onProgress?.('creating_document', 0)

      // 根据 MIME 类型决定文档类型
      // text/plain 和 text/markdown 可以直接预览
      const docType =
        parseResult.mimeType === 'text/plain' || parseResult.mimeType === 'text/markdown'
          ? 'text'
          : 'file'

      const newDoc: NewDocument = {
        id: documentId,
        notebookId,
        title: parseResult.title || basename(filePath) || 'Untitled',
        type: docType,
        sourceUri: filePath,
        localFilePath: localFilePath,
        content: parseResult.content,
        contentHash,
        mimeType: parseResult.mimeType,
        fileSize: parseResult.metadata?.fileSize as number | undefined,
        metadata: parseResult.metadata,
        status: 'processing',
        chunkCount: 0,
        createdAt: now,
        updatedAt: now
      }

      db.insert(documents).values(newDoc).run()

      // 1b. 持久化文档块，保留解析器给出的页/标题结构
      this.persistDocumentBlocks(
        documentId,
        buildDocumentBlocks({ content: parseResult.content, structure: parseResult.structure })
      )

      // 2. 分块
      onProgress?.('chunking', 10)
      const chunkResults = this.chunkingService.chunk(parseResult.content)

      if (chunkResults.length === 0) {
        throw new Error('No chunks generated from document')
      }

      Logger.info('KnowledgeService', `Document ${documentId}: ${chunkResults.length} chunks`)

      // 3. 保存分块
      onProgress?.('saving_chunks', 20)
      const chunkIds: string[] = []
      const chunkContents: string[] = []

      for (const chunk of chunkResults) {
        const chunkId = `chunk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
        chunkIds.push(chunkId)
        chunkContents.push(chunk.content)

        const newChunk: NewChunk = {
          id: chunkId,
          documentId,
          notebookId,
          content: chunk.content,
          chunkIndex: chunk.index,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          tokenCount: chunk.tokenCount,
          createdAt: now
        }

        db.insert(chunks).values(newChunk).run()
      }

      // 4. 生成嵌入向量
      // 不指定维度:维度由 embedding 模型决定,写死维度会让用别的模型的笔记本直接
      // 索引失败(vec0 表的宽度在创建时固定,见 #33)。测出真实维度之后再用它建表。
      const embeddingResults = await this.embedDocumentChunks(notebookId, chunkContents, onProgress)

      if (embeddingResults.length === 0) {
        throw new Error('Embedding 服务没有返回任何向量')
      }

      // space 由模型决定;与既有 space 不一致时重建向量表并把文档标回待索引
      const detectedDimensions = embeddingResults[0].dimensions
      await this.reconcileEmbeddingSpace(
        notebookId,
        await this.embeddingService.getSpace(),
        detectedDimensions
      )
      Logger.info('KnowledgeService', `Embedding dimensions: ${detectedDimensions}`)

      // 5. 保存嵌入元数据并添加到向量存储
      onProgress?.('saving_embeddings', 85)
      const vectorStore = await vectorStoreManager.getStore(
        notebookId,
        undefined,
        detectedDimensions
      )
      const vectorItems: Array<{
        id: string
        chunkId: string
        vector: Float32Array
        metadata?: Record<string, unknown>
      }> = []

      for (let i = 0; i < chunkIds.length; i++) {
        const embeddingId = `emb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
        const embResult = embeddingResults[i]

        // 保存嵌入元数据到数据库
        const newEmbedding: NewEmbedding = {
          id: embeddingId,
          chunkId: chunkIds[i],
          notebookId,
          model: embResult.model,
          dimensions: embResult.dimensions,
          createdAt: now
        }

        db.insert(embeddings).values(newEmbedding).run()

        // 准备向量数据
        vectorItems.push({
          id: embeddingId,
          chunkId: chunkIds[i],
          vector: embResult.embedding,
          metadata: { model: embResult.model, documentId }
        })
      }

      // 批量添加到向量存储
      await vectorStore.upsert(vectorItems)

      // 6. 更新文档状态
      onProgress?.('finalizing', 95)
      db.update(documents)
        .set({
          status: 'indexed',
          chunkCount: chunkResults.length,
          updatedAt: new Date()
        })
        .where(eq(documents.id, documentId))
        .run()

      executeCheckpoint('PASSIVE')
      onProgress?.('completed', 100)

      Logger.info(
        'KnowledgeService',
        `Document indexed: ${documentId}, ${chunkResults.length} chunks`
      )
      return documentId
    } catch (error) {
      // 失败时删除已拷贝的文件
      if (localFilePath) {
        await this.deleteLocalFile(localFilePath)
      }

      // 更新文档状态为失败
      db.update(documents)
        .set({
          status: 'failed',
          errorMessage: (error as Error).message,
          updatedAt: new Date()
        })
        .where(eq(documents.id, documentId))
        .run()

      Logger.error('KnowledgeService', 'Failed to add document from file:', error)
      throw error
    }
  }

  /**
   * 持久化文档块。块 id 由 documentId 与顺序确定，天然唯一且可读；
   * 重新索引会换新 documentId，不会与旧块冲突。
   */
  private persistDocumentBlocks(documentId: string, drafts: DocumentBlockDraft[]): void {
    if (drafts.length === 0) return

    const rows: NewDocumentBlock[] = drafts.map((draft) => ({
      id: `blk_${documentId}_${draft.order}`,
      documentId,
      kind: draft.kind,
      order: draft.order,
      page: draft.page,
      level: draft.level,
      text: draft.text,
      startOffset: draft.startOffset,
      endOffset: draft.endOffset,
      bbox: draft.bbox,
      metadata: draft.metadata
    }))

    getDatabase().insert(documentBlocks).values(rows).run()
    Logger.debug('KnowledgeService', `Document ${documentId}: ${rows.length} blocks`)
  }

  /**
   * 获取文档的所有块，按阅读顺序返回。
   */
  getDocumentBlocks(documentId: string): DocumentBlock[] {
    return getDatabase()
      .select()
      .from(documentBlocks)
      .where(eq(documentBlocks.documentId, documentId))
      .orderBy(documentBlocks.order)
      .all()
  }

  /**
   * 从 URL 添加文档
   */
  async addDocumentFromUrl(
    notebookId: string,
    url: string,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    onProgress?.('fetching_url', 0)

    const fetchResult = await this.webFetchService.fetchUrl(url)

    return this.addDocument(
      notebookId,
      {
        title: fetchResult.title || url,
        type: 'url',
        content: fetchResult.content,
        sourceUri: url,
        mimeType: fetchResult.mimeType,
        metadata: {
          ...fetchResult.metadata,
          description: fetchResult.description
        }
      },
      onProgress
    )
  }

  /**
   * 从 Note 添加到知识库
   */
  async addNoteToKnowledge(
    notebookId: string,
    noteId: string,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    const db = getDatabase()
    const note = db.select().from(notes).where(eq(notes.id, noteId)).get()

    if (!note) {
      throw new Error(`Note ${noteId} not found`)
    }

    // 验证笔记内容不为空
    const trimmedContent = note.content.trim()
    if (!trimmedContent || trimmedContent.length === 0) {
      throw new Error('Note content is empty. Cannot add empty note to knowledge base.')
    }

    return this.addDocument(
      notebookId,
      {
        title: note.title,
        type: 'note',
        content: note.content,
        sourceNoteId: noteId
      },
      onProgress
    )
  }

  /**
   * 索引前把 chunk 转成向量。
   *
   * 内置本地模型未安装时会触发按需下载（第一次使用 RAG 的动作），下载进度映射到
   * 0-30%，之后的推理映射到 30-80%。索引文本走 document 前缀。
   */
  private async embedDocumentChunks(
    notebookId: string,
    chunkContents: string[],
    onProgress?: IndexProgressCallback
  ): Promise<Array<{ embedding: Float32Array; model: string; dimensions: number }>> {
    Logger.debug(
      'KnowledgeService',
      `Embedding ${chunkContents.length} chunks for notebook ${notebookId}`
    )

    await this.embeddingService.ensureReady((progress) => {
      onProgress?.('preparing_embedding_model', Math.round(progress.progress * 30))
    })

    onProgress?.('generating_embeddings', 30)
    return await this.embeddingService.embedBatch(chunkContents, 'document', (completed, total) => {
      const progress = 30 + (completed / total) * 50
      onProgress?.('generating_embeddings', Math.round(progress))
    })
  }

  /**
   * embedding space 是索引身份：向量只有在同一个 space 内才可比。仅比维度不够 —— 换了
   * 模型但维度恰好相同时（例如 768 → 768），旧向量与新查询向量已经不可比却检测不到。
   *
   * space 变化时，维度不同就重建向量表，维度相同就清空向量，并把该 notebook 的文档标回
   * 待索引。只有索引链路（刚量到真实 space/维度）能走到这里，搜索与删除不会误删向量。
   */
  private async reconcileEmbeddingSpace(
    notebookId: string,
    space: EmbeddingSpace,
    dimensions: number
  ): Promise<void> {
    const db = getDatabase()
    const stored = db
      .select()
      .from(notebookEmbeddingSpaces)
      .where(eq(notebookEmbeddingSpaces.notebookId, notebookId))
      .get()
    const existingTable = getNotebookVectorTable(notebookId)

    const spaceChanged = Boolean(stored) && stored!.spaceId !== space.id
    const dimensionsChanged = Boolean(existingTable) && existingTable!.dimensions !== dimensions

    if (spaceChanged || dimensionsChanged) {
      if (dimensionsChanged && existingTable) {
        Logger.warn(
          'KnowledgeService',
          `Embedding dimensions for ${notebookId} changed from ${existingTable.dimensions} to ${dimensions}, rebuilding its vector table`
        )
        rebuildNotebookVectorTable(notebookId, dimensions)
      } else if (existingTable) {
        Logger.warn(
          'KnowledgeService',
          `Embedding space for ${notebookId} changed (${stored?.spaceId ?? 'unknown'} -> ${space.id}); clearing incomparable vectors`
        )
        const store = await vectorStoreManager.getStore(notebookId)
        await store.clear()
      }

      // 向量已不可用（重建或清空），该 notebook 的所有文档都需要重新索引
      db.delete(embeddings).where(eq(embeddings.notebookId, notebookId)).run()
      db.update(documents)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(documents.notebookId, notebookId))
        .run()
    }

    const now = new Date()
    db.insert(notebookEmbeddingSpaces)
      .values({
        notebookId,
        spaceId: space.id,
        backend: space.backend,
        model: space.model,
        revision: space.revision,
        dimensions,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: notebookEmbeddingSpaces.notebookId,
        set: {
          spaceId: space.id,
          backend: space.backend,
          model: space.model,
          revision: space.revision,
          dimensions,
          updatedAt: now
        }
      })
      .run()
  }

  /**
   * 语义搜索
   */
  async search(
    notebookId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const { topK = 5, threshold = 0.5, includeContent = true } = options
    const db = getDatabase()

    // 0. 索引身份校验：当前模型与建索引时不一致，向量不可比，明确要求重新索引
    const space = await this.embeddingService.getSpace()
    const storedSpace = db
      .select()
      .from(notebookEmbeddingSpaces)
      .where(eq(notebookEmbeddingSpaces.notebookId, notebookId))
      .get()
    if (storedSpace && storedSpace.spaceId !== space.id) {
      throw new Error(
        'The search model has changed since this notebook was indexed. Re-index the notebook before searching.'
      )
    }

    // 1. 生成查询向量（E5 要求 query 前缀，与索引时的 document 前缀区分）
    await this.embeddingService.ensureReady()
    const queryEmbedding = await this.embeddingService.embed(query, 'query')

    // 2. 向量检索
    const vectorStore = await vectorStoreManager.getStore(notebookId)
    const vectorResults = await vectorStore.query(queryEmbedding.embedding, {
      topK,
      threshold
    })

    if (vectorResults.length === 0) {
      return []
    }

    // 3. 获取 chunk 详情
    const chunkIds = vectorResults.map((r) => r.chunkId)

    const chunkDetails = db.select().from(chunks).where(inArray(chunks.id, chunkIds)).all()

    // 获取文档信息
    const documentIds = [...new Set(chunkDetails.map((c) => c.documentId))]
    const documentDetails = db
      .select()
      .from(documents)
      .where(inArray(documents.id, documentIds))
      .all()

    const documentMap = new Map(documentDetails.map((d) => [d.id, d]))
    const chunkMap = new Map(chunkDetails.map((c) => [c.id, c]))

    // 4. 组装结果
    const results: SearchResult[] = []

    for (const vr of vectorResults) {
      const chunk = chunkMap.get(vr.chunkId)
      if (!chunk) continue

      const doc = documentMap.get(chunk.documentId)

      const result: SearchResult = {
        chunkId: vr.chunkId,
        documentId: chunk.documentId,
        documentTitle: doc?.title || 'Unknown',
        documentType: doc?.type || 'unknown',
        content: includeContent ? chunk.content : '',
        score: vr.score,
        chunkIndex: chunk.chunkIndex
      }

      if (chunk.metadata) {
        result.metadata = chunk.metadata
      }

      results.push(result)
    }

    return results
  }

  /**
   * 获取 notebook 的所有文档
   */
  getDocuments(notebookId: string): Document[] {
    const db = getDatabase()
    return db
      .select()
      .from(documents)
      .where(eq(documents.notebookId, notebookId))
      .orderBy(desc(documents.updatedAt))
      .all()
  }

  /**
   * 获取单个文档
   */
  getDocument(documentId: string): Document | undefined {
    const db = getDatabase()
    return db.select().from(documents).where(eq(documents.id, documentId)).get()
  }

  /**
   * 获取文档的所有 chunks
   */
  getDocumentChunks(documentId: string): Chunk[] {
    const db = getDatabase()
    return db.select().from(chunks).where(eq(chunks.documentId, documentId)).all()
  }

  /**
   * 删除文档
   */
  async deleteDocument(documentId: string): Promise<void> {
    const db = getDatabase()

    // 获取文档信息
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc) return

    // 获取所有 chunk IDs
    const docChunks = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .all()

    // 从向量存储删除
    if (docChunks.length > 0) {
      const vectorStore = await vectorStoreManager.getStore(doc.notebookId)
      await vectorStore.deleteByChunkIds(docChunks.map((c) => c.id))
    }

    // 删除本地拷贝的文件（如果存在）
    if (doc.localFilePath) {
      await this.deleteLocalFile(doc.localFilePath)
    }

    // 块没有依赖向量表，显式删除而不依赖外键级联（连接上 foreign_keys 默认是关的）
    db.delete(documentBlocks).where(eq(documentBlocks.documentId, documentId)).run()

    // 级联删除会自动清理 chunks 和 embeddings
    db.delete(documents).where(eq(documents.id, documentId)).run()

    executeCheckpoint('PASSIVE')
    Logger.info('KnowledgeService', `Document deleted: ${documentId}`)
  }

  /**
   * 重建文档索引
   */
  async reindexDocument(documentId: string, onProgress?: IndexProgressCallback): Promise<void> {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()

    if (!doc || !doc.content) {
      throw new Error(`Document ${documentId} not found or has no content`)
    }

    // 删除旧的 chunks 和 embeddings
    const oldChunks = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .all()

    if (oldChunks.length > 0) {
      const vectorStore = await vectorStoreManager.getStore(doc.notebookId)
      await vectorStore.deleteByChunkIds(oldChunks.map((c) => c.id))
    }

    db.delete(chunks).where(eq(chunks.documentId, documentId)).run()
    db.delete(embeddings)
      .where(
        inArray(
          embeddings.chunkId,
          oldChunks.map((c) => c.id)
        )
      )
      .run()

    // 更新状态
    db.update(documents)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(documents.id, documentId))
      .run()

    // 重新索引（复用 addDocument 逻辑的核心部分）
    // 为简化实现，这里直接调用内部处理
    await this.addDocument(
      doc.notebookId,
      {
        title: doc.title,
        type: doc.type as 'file' | 'note' | 'url' | 'text',
        content: doc.content,
        sourceUri: doc.sourceUri || undefined,
        sourceNoteId: doc.sourceNoteId || undefined,
        mimeType: doc.mimeType || undefined,
        metadata: doc.metadata || undefined
      },
      onProgress
    )
  }

  /**
   * 获取知识库统计信息
   */
  getStats(notebookId: string): {
    documentCount: number
    chunkCount: number
    embeddingCount: number
  } {
    const db = getDatabase()

    const docCount = db
      .select({ count: sql<number>`count(*)` })
      .from(documents)
      .where(eq(documents.notebookId, notebookId))
      .get()

    const chunkCount = db
      .select({ count: sql<number>`count(*)` })
      .from(chunks)
      .where(eq(chunks.notebookId, notebookId))
      .get()

    const embCount = db
      .select({ count: sql<number>`count(*)` })
      .from(embeddings)
      .where(eq(embeddings.notebookId, notebookId))
      .get()

    return {
      documentCount: docCount?.count || 0,
      chunkCount: chunkCount?.count || 0,
      embeddingCount: embCount?.count || 0
    }
  }
}
