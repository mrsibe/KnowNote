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
  documentBlocks,
  chunkBlocks
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
import { ChunkingService, type ChunkOptions, type ChunkResult } from './ChunkingService'
import { FileParserService } from './FileParserService'
import type { DocumentStructure } from './loaders/types'
import {
  buildDocumentBlocks,
  assignBlockIds,
  type IdentifiedBlockDraft
} from './blocks/documentBlocks'
import { resolveChunkProvenance, type ChunkProvenance } from './chunkProvenance'
import { HybridRetriever, hydrateEvidence, type RetrievalStrategy } from './retrieval'
import {
  advanceRun,
  completeRun,
  failRun,
  runsFor,
  startRun,
  type IngestionRunKind
} from './ingestion'
import type {
  EvidenceLocator,
  RetrievalRequest,
  RetrievalResult,
  RetrievedEvidence,
  Retriever
} from './retrieval'
import { WebFetchService } from './WebFetchService'
import { deleteDocumentChunksFts, ensureChunksFts, indexChunksFts, searchChunksFts } from './fts'
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
  /** 只在这些来源里检索（#94）；为空/缺省表示整个 notebook。 */
  documentIds?: string[]
  /** 检索策略（#77）；缺省 `dense`，与引入策略之前一致。 */
  strategy?: RetrievalStrategy
}

/**
 * 搜索结果
 *
 * `locator` 是检索 → 引用的 seam：页码区间与块区间随结果一起交付，#69 直接用它
 * 组装 citation，不必再回头查库。
 */
export interface SearchResult {
  chunkId: string
  documentId: string
  documentTitle: string
  documentType: string
  content: string
  score: number
  chunkIndex: number
  locator: EvidenceLocator
  metadata?: Record<string, unknown>
}

/**
 * 索引进度回调
 */
export type IndexProgressCallback = (stage: string, progress: number) => void

/**
 * `RetrievedEvidence` → 兼容的 `SearchResult` 形状。
 *
 * 抽成纯函数是因为现在有两个调用点：legacy `search()`，以及 chat 的 RAG —— 后者直接
 * 走 `retrieve()` 以拿到 trace（#157），再自己映射，而不是为了 trace 多检索一次。
 */
export function toSearchResults(
  evidence: readonly RetrievedEvidence[],
  options: { includeContent?: boolean } = {}
): SearchResult[] {
  const { includeContent = true } = options

  return evidence.map((item) => {
    const result: SearchResult = {
      chunkId: item.chunkId,
      documentId: item.documentId,
      documentTitle: item.source.title,
      documentType: item.source.type,
      content: includeContent ? item.content : '',
      score: item.score,
      chunkIndex: item.chunkIndex,
      locator: item.locator
    }

    if (item.metadata) result.metadata = item.metadata

    return result
  })
}

/**
 * 知识库服务
 * 管理文档、分块、嵌入和检索
 */
export class KnowledgeService {
  private embeddingService: EmbeddingService
  private chunkingService: ChunkingService
  private retriever: Retriever
  private fileParserService: FileParserService
  private webFetchService: WebFetchService
  private knowledgeFilesDir: string

  constructor(embeddingService: EmbeddingService) {
    this.embeddingService = embeddingService
    this.chunkingService = new ChunkingService()
    this.retriever = new HybridRetriever(embeddingService)
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

    // 1. 创建 source 记录。Document 是 source identity：之后的每一次重新索引都复用
    //    这一行，不会再生成新的 documentId。
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

    // 2. 建立派生索引（blocks → chunks → embeddings → 向量表）。失败时由
    //    `indexDocument()` 把这一行标成 failed，source 行保留以便重试或重新索引。
    const runId = startRun(documentId, 'import')
    try {
      await this.indexDocument(
        documentId,
        runId,
        options.content,
        undefined,
        { chunkOptions: options.chunkOptions },
        onProgress
      )
      completeRun(runId)
    } catch (error) {
      failRun(runId, (error as Error).message)
      throw error
    }

    return documentId
  }

  /**
   * 从文件添加文档
   */
  async addDocumentFromFile(
    notebookId: string,
    filePath: string,
    onProgress?: IndexProgressCallback,
    chunkOptions?: ChunkOptions
  ): Promise<string> {
    const db = getDatabase()
    const documentId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const now = new Date()

    // source 行在**解析之前**就存在（#95）。以前解析失败时更新的是还没插入的行，
    // 失败因此丢失，文档也无法重试。解析成功后再把解析结果回填。
    db.insert(documents)
      .values({
        id: documentId,
        notebookId,
        title: basename(filePath) || 'Untitled',
        type: 'file',
        sourceUri: filePath,
        status: 'processing',
        chunkCount: 0,
        createdAt: now,
        updatedAt: now
      })
      .run()

    // 先拷贝，再解析原文件：本地副本是重新索引/结构恢复时读取的东西。
    await this.ingestFile(
      documentId,
      filePath,
      { copyFrom: filePath, chunkOptions },
      'import',
      onProgress
    )

    return documentId
  }

  /**
   * 一条 ingestion pipeline：copy（可选）→ parse → chunk → embed → 写入派生索引。
   *
   * 导入与「解析阶段失败后的重试」共用它：后者已经有本地副本，直接解析副本，不再拷贝。
   * run 的生命周期也在这里维护（#95）—— 每条路径都必须留下一次完整的尝试记录。
   */
  private async ingestFile(
    documentId: string,
    filePath: string,
    options: { copyFrom?: string; chunkOptions?: ChunkOptions },
    kind: IngestionRunKind,
    onProgress?: IndexProgressCallback
  ): Promise<void> {
    const db = getDatabase()
    const runId = startRun(documentId, kind)

    try {
      if (options.copyFrom) {
        advanceRun(runId, 'copying', 0)
        onProgress?.('copying', 0)
        const localFilePath = await this.copyFileToKnowledgeDir(options.copyFrom, documentId)
        db.update(documents)
          .set({ localFilePath, updatedAt: new Date() })
          .where(eq(documents.id, documentId))
          .run()
      }

      advanceRun(runId, 'parsing', 5)
      onProgress?.('parsing', 5)
      const parseResult = await this.fileParserService.parseFile(filePath)

      // 计算内容哈希
      const contentHash = createHash('md5').update(parseResult.content).digest('hex')
      const docType =
        parseResult.mimeType === 'text/plain' || parseResult.mimeType === 'text/markdown'
          ? 'text'
          : 'file'

      db.update(documents)
        .set({
          title: parseResult.title || basename(filePath) || 'Untitled',
          type: docType,
          content: parseResult.content,
          // 结构随 source 一起持久化，重新索引才能不加解析地重建同一批块
          structure: parseResult.structure ?? undefined,
          contentHash,
          mimeType: parseResult.mimeType,
          fileSize: parseResult.metadata?.fileSize as number | undefined,
          metadata: parseResult.metadata,
          errorMessage: null,
          updatedAt: new Date()
        })
        .where(eq(documents.id, documentId))
        .run()

      await this.indexDocument(
        documentId,
        runId,
        parseResult.content,
        parseResult.structure ?? undefined,
        { chunkOptions: options.chunkOptions },
        onProgress
      )

      completeRun(runId)
    } catch (error) {
      const message = (error as Error).message
      // 保留 source 行与本地副本：来源身份在一次失败的 run 后依然存在，重试可以直接
      // 解析副本，不必再向用户要一次文件。
      db.update(documents)
        .set({ status: 'failed', errorMessage: message, updatedAt: new Date() })
        .where(eq(documents.id, documentId))
        .run()
      failRun(runId, message)
      Logger.error('KnowledgeService', 'Failed to ingest document:', error)
      throw error
    }
  }

  /**
   * 为一份已经存在的 source（`documents` 行）建立派生索引：
   * blocks → chunks → embeddings → 向量表。
   *
   * Document 是 source identity，blocks/chunks/embeddings 是派生索引。这个方法只写
   * 派生索引，从不插入或删除 `documents` 行，所以对同一个 documentId 反复调用不会改
   * 变来源身份（历史 citation 仍然指向同一个来源）。
   *
   * 顺序是 #95 的核心保证：**先把 blocks / chunks / embeddings 全部算出来**（这些是
   * 会慢、会失败的步骤），全部成功之后才动旧的派生索引。这样「embedding 跑到 70%
   * 失败」不会删掉一份还能检索的旧索引 —— 一次失败的 reindex 不破坏上一份可用索引。
   *
   * 代价要说清楚：替换阶段本身（clear → 写入 → 向量）不是单个事务，因为向量写入是
   * 异步的。所以这个保证覆盖 parse/chunk/embed，而不是「替换中途断电」。真正的原子
   * 切换需要给派生数据加 generation，是后续工作。
   */
  private async indexDocument(
    documentId: string,
    runId: string,
    content: string,
    structure: DocumentStructure | undefined,
    options: { chunkOptions?: ChunkOptions } = {},
    onProgress?: IndexProgressCallback
  ): Promise<number> {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc) throw new Error(`Document ${documentId} not found`)

    const notebookId = doc.notebookId
    const now = new Date()

    try {
      // 1. 文档块（内存）。偏移锚定 content，即 documents.content。
      const blocks = assignBlockIds(documentId, buildDocumentBlocks({ content, structure }))

      // 2. 分块（内存，偏移同样锚定 content）
      advanceRun(runId, 'chunking', 10)
      onProgress?.('chunking', 10)
      const chunkResults = this.chunkingService.chunkBlocks(content, blocks, options.chunkOptions)

      if (chunkResults.length === 0) {
        throw new Error('No chunks generated from document')
      }

      Logger.info('KnowledgeService', `Document ${documentId}: ${chunkResults.length} chunks`)

      // 3. 生成嵌入向量（异步，最可能失败的一步）—— 在动旧索引之前完成。
      // 不指定维度:维度由 embedding 模型决定,写死维度会让用别的模型的笔记本直接
      // 索引失败(vec0 表的宽度在创建时固定,见 #33)。测出真实维度之后再用它建表。
      advanceRun(runId, 'embedding', 20)
      const chunkContents = chunkResults.map((chunk) => chunk.content)
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

      // 4. 到此为止没有破坏任何东西。现在才替换旧的派生索引。
      advanceRun(runId, 'finalizing', 85)
      onProgress?.('saving_chunks', 85)
      ensureChunksFts()
      await this.clearDerivedIndex(documentId)

      this.persistDocumentBlocks(blocks)

      // 保存分块与 chunk↔block 映射（同一事务，不会出现没有映射的 chunk）
      const { chunkIds } = this.saveChunks(documentId, notebookId, chunkResults, now)

      // 字面检索索引（#96）。与 chunk 写入在同一个 pipeline 里，所以两者不会各自
      // 漂移；就算漂移，`ensureChunksFts()` 的补齐也会在下次索引时自愈。
      indexChunksFts(
        chunkResults.map((chunk, index) => ({
          chunkId: chunkIds[index],
          notebookId,
          documentId,
          content: chunk.content
        }))
      )

      // 5. 保存嵌入元数据并添加到向量存储
      onProgress?.('saving_embeddings', 90)
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
          errorMessage: null,
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
      return chunkResults.length
    } catch (error) {
      // 派生索引可以重建，所以失败只是状态问题，不需要删掉 source 行
      db.update(documents)
        .set({
          status: 'failed',
          errorMessage: (error as Error).message,
          updatedAt: new Date()
        })
        .where(eq(documents.id, documentId))
        .run()

      Logger.error('KnowledgeService', 'Failed to index document:', error)
      throw error
    }
  }

  /**
   * 删除一份文档的全部派生索引（向量、chunk↔block 映射、chunks、embeddings、
   * document_blocks），并把它标回 `processing`。`documents` 行本身保留。
   */
  private async clearDerivedIndex(documentId: string): Promise<void> {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc) return

    // 字面索引与 chunk 一起清掉；表不存在时先建出来，免得删除本身成了第一个错误。
    ensureChunksFts()
    deleteDocumentChunksFts(documentId)

    const oldChunks = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .all()

    if (oldChunks.length > 0) {
      const chunkIds = oldChunks.map((chunk) => chunk.id)

      const vectorStore = await vectorStoreManager.getStore(doc.notebookId)
      await vectorStore.deleteByChunkIds(chunkIds)

      // 映射与 embeddings 不依赖外键级联（连接上 foreign_keys 默认是关的），显式删除
      db.delete(chunkBlocks).where(inArray(chunkBlocks.chunkId, chunkIds)).run()
      db.delete(embeddings).where(inArray(embeddings.chunkId, chunkIds)).run()
      db.delete(chunks).where(eq(chunks.documentId, documentId)).run()
    }

    db.delete(documentBlocks).where(eq(documentBlocks.documentId, documentId)).run()

    db.update(documents)
      .set({ status: 'processing', errorMessage: null, chunkCount: 0, updatedAt: new Date() })
      .where(eq(documents.id, documentId))
      .run()
  }

  /**
   * 持久化文档块。id 已由 `assignBlockIds()` 生成，与分块器看到的是同一批块。
   */
  private persistDocumentBlocks(blocks: IdentifiedBlockDraft[]): void {
    if (blocks.length === 0) return

    const rows: NewDocumentBlock[] = blocks.map((block) => ({
      id: block.id,
      documentId: block.documentId,
      kind: block.kind,
      order: block.order,
      page: block.page,
      level: block.level,
      text: block.text,
      startOffset: block.startOffset,
      endOffset: block.endOffset,
      bbox: block.bbox,
      metadata: block.metadata
    }))

    getDatabase().insert(documentBlocks).values(rows).run()
    Logger.debug('KnowledgeService', `Document ${blocks[0].documentId}: ${rows.length} blocks`)
  }

  /**
   * 写入分块与 chunk↔block 映射。两者放在同一个事务里，所以不会出现没有映射的
   * chunk；`page_start/page_end` 直接取分块器算好的覆盖块页码区间。
   */
  private saveChunks(
    documentId: string,
    notebookId: string,
    chunkResults: ChunkResult[],
    now: Date
  ): { chunkIds: string[]; chunkContents: string[] } {
    const db = getDatabase()
    const chunkIds: string[] = []
    const chunkContents: string[] = []

    db.transaction((tx) => {
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
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          tokenCount: chunk.tokenCount,
          createdAt: now
        }

        tx.insert(chunks).values(newChunk).run()

        for (const span of chunk.blockSpans) {
          tx.insert(chunkBlocks)
            .values({
              chunkId,
              blockId: span.blockId,
              startInBlock: span.startInBlock,
              endInBlock: span.endInBlock
            })
            .run()
        }
      }
    })

    return { chunkIds, chunkContents }
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
   * 解析一个 chunk 的来源：文档 id、页码区间，以及按文档顺序排列的块区间。
   */
  getChunkProvenance(chunkId: string): ChunkProvenance | undefined {
    return resolveChunkProvenance(getDatabase(), chunkId)
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
   * RAG 是否能跑：远程 embedding connection 已配置，或内置本地模型已安装。
   *
   * 不能用 `ConnectionManager.getEmbeddingClient()` 判断 —— 那个只看远程 connection，
   * 本地模型时为 null，会把整条 RAG 路径关掉（本地是默认配置）。
   */
  async isEmbeddingAvailable(): Promise<boolean> {
    return await this.embeddingService.isAvailable()
  }

  /**
   * 检索：embedding space 前置校验 + 委托给当前 `Retriever`，并带回本次检索的
   * trace（#157 会把它快照到回答上）。
   *
   * embedding space 校验留在这里：它是前置条件，不是检索策略的一部分。旧的
   * `search()` 形状保持不变，只是改为经这里委托。
   */
  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const db = getDatabase()

    // 0. 索引身份校验：当前模型与建索引时不一致，向量不可比，明确要求重新索引
    const space = await this.embeddingService.getSpace()
    const storedSpace = db
      .select()
      .from(notebookEmbeddingSpaces)
      .where(eq(notebookEmbeddingSpaces.notebookId, request.notebookId))
      .get()
    if (storedSpace && storedSpace.spaceId !== space.id) {
      throw new Error(
        'The search model has changed since this notebook was indexed. Re-index the notebook before searching.'
      )
    }

    return this.retriever.search(request)
  }

  /**
   * 语义搜索。
   *
   * 保持原有签名与返回形状，内部委托给 `retrieve()`（默认策略是
   * `DenseRetriever`），再映射成兼容的 `SearchResult` 形状。
   */
  async search(
    notebookId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const { includeContent = true } = options

    // 1. 检索（向量 → 批量补齐来源/定位信息）
    const { evidence } = await this.retrieve({
      notebookId,
      query,
      topK: options.topK,
      threshold: options.threshold,
      strategy: options.strategy,
      filter: options.documentIds ? { documentIds: options.documentIds } : undefined
    })

    // 2. 映射回兼容的 SearchResult 形状
    return toSearchResults(evidence, { includeContent })
  }

  /**
   * 字面检索（#96）：BM25 over `chunks_fts`，可限定来源（#94 的 scope）。
   *
   * 与向量检索共用 `SearchResult` 形状，所以引用/定位链路不需要第二套。两个信号在
   * UI 里分开呈现，**不**做融合 —— 融合是 chat 检索（#77）的事。
   */
  async searchText(
    notebookId: string,
    query: string,
    options: { limit?: number; documentIds?: string[] } = {}
  ): Promise<SearchResult[]> {
    ensureChunksFts()
    const hits = searchChunksFts(notebookId, query, options)
    if (hits.length === 0) return []

    return toSearchResults(hydrateEvidence(getDatabase(), hits))
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
   * 只取一份来源的可读文件路径（#60）。
   *
   * 刻意做成一个窄查询，而不是让 `knownote-doc://` 的协议 handler 调 `getDocument()`：
   * 那个 handler 是 Electron plumbing，它只需要「按 id 找一个能读的文件」，把整行
   * `Document` 交给它会把依赖面撑得比实际需要宽。
   *
   * 存在的意义是固定依赖方向：protocol → Document 层 → database，而不是 protocol 自己
   * 去 `getDatabase()`。不用为它另建 SourceStore 之类的 repository —— 一个方法就够。
   */
  getDocumentLocalFilePath(documentId: string): string | null {
    const db = getDatabase()
    const row = db
      .select({ localFilePath: documents.localFilePath })
      .from(documents)
      .where(eq(documents.id, documentId))
      .get()
    return row?.localFilePath ?? null
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

    // 删除全部派生索引（向量、映射、chunks、embeddings、blocks）
    await this.clearDerivedIndex(documentId)

    // 删除本地拷贝的文件（如果存在）
    if (doc.localFilePath) {
      await this.deleteLocalFile(doc.localFilePath)
    }

    db.delete(documents).where(eq(documents.id, documentId)).run()

    executeCheckpoint('PASSIVE')
    Logger.info('KnowledgeService', `Document deleted: ${documentId}`)
  }

  /**
   * 重建文档索引。
   *
   * 只重建派生索引：documentId、localFilePath、sourceUri、metadata 与解析结构都
   * 保持不变。重新索引不会让历史 citation 指向另一个来源。
   *
   * 升级前导入的文档 `structure` 为 NULL（migration 只加列，不回填）。这时先从本地
   * 副本恢复结构，再进入 pipeline：恢复失败时还没动旧索引（#95）。
   */
  async reindexDocument(documentId: string, onProgress?: IndexProgressCallback): Promise<void> {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()

    if (!doc || !doc.content) {
      throw new Error(`Document ${documentId} not found or has no content`)
    }

    let structure = doc.structure ?? undefined
    if (!structure) {
      structure = await this.recoverStructure(doc)
      if (structure) {
        db.update(documents).set({ structure }).where(eq(documents.id, documentId)).run()
        Logger.info('KnowledgeService', `Recovered structure for legacy document ${documentId}`)
      }
    }

    const runId = startRun(documentId, 'reindex')
    try {
      await this.indexDocument(documentId, runId, doc.content, structure, {}, onProgress)
      completeRun(runId)
    } catch (error) {
      failRun(runId, (error as Error).message)
      throw error
    }
  }

  /**
   * 对一份失败的 source 再试一次（#95）。
   *
   * 已经解析过的（有 `content`）从分块开始重来；解析前就失败的只有本地副本，重新解析。
   * 两条路径都复用同一条 pipeline，不需要用户再选一次文件。
   */
  async retryDocument(documentId: string, onProgress?: IndexProgressCallback): Promise<void> {
    const doc = this.getDocument(documentId)
    if (!doc) throw new Error(`Document ${documentId} not found`)

    if (doc.content) {
      await this.reindexDocument(documentId, onProgress)
      return
    }

    if (!doc.localFilePath) {
      throw new Error('This source has no local copy to retry from')
    }

    await this.ingestFile(documentId, doc.localFilePath, {}, 'import', onProgress)
  }

  /** 一份 source 的索引尝试历史，最近优先（#95）。 */
  getIngestionRuns(documentId: string) {
    return runsFor(documentId)
  }

  /**
   * 从本地副本重新解析出结构，用于升级前没有持久化 `structure` 的文档。
   *
   * 只在 `localFilePath` 存在且重新解析出的内容与规范内容完全一致时采用 —— 文件被改
   * 过的话 offsets 就指不到同一份文本，宁可退化成平铺块也不能错误对齐。
   */
  private async recoverStructure(doc: Document): Promise<DocumentStructure | undefined> {
    if (!doc.localFilePath || !doc.content) return undefined

    try {
      const parsed = await this.fileParserService.parseFile(doc.localFilePath)
      if (parsed.content !== doc.content) {
        Logger.warn(
          'KnowledgeService',
          `Cannot recover structure for ${doc.id}: content changed since import`
        )
        return undefined
      }
      return parsed.structure ?? undefined
    } catch (error) {
      Logger.warn('KnowledgeService', `Cannot recover structure for ${doc.id}:`, error)
      return undefined
    }
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
