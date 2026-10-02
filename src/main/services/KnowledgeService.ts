/**
 * KnowledgeService
 * 知识库核心服务，整合文档管理、分块、嵌入和检索
 */

import { createHash } from 'crypto'
import { app } from 'electron'
import { join, basename, sep } from 'path'
import { mkdir, copyFile, unlink, stat } from 'fs/promises'
import type Database from 'better-sqlite3'
import {
  getDatabase,
  executeCheckpoint,
  getNotebookVectorTable,
  createNotebookVectorTable,
  rebuildNotebookVectorTable,
  getSqlite
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
import type { LibrarySourceSummary, DocumentType } from '../../shared/types/knowledge'
import {
  attachLibrarySource as attachLibrarySourceMembership,
  countMemberships,
  deleteLibrarySource as deleteLibrarySourceRecord,
  insertLibrarySource as insertLibrarySourceRow,
  listLibrarySources as listLibrarySourceSummaries,
  planSnapshotWrite,
  updateLibrarySource as updateLibrarySourceRow,
  type EmbeddingSpaceIdentity,
  type VectorTableAccess
} from './librarySources'
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
import type { WatchedDocument } from './ingestion/folderWatch'
import {
  FolderWatchService,
  addFolderWatch,
  listFolderWatchesForNotebook,
  removeFolderWatch,
  type FolderWatchRecord,
  type ReconcileResult
} from './ingestion/folderWatch'
import { scanFolder } from './ingestion/folderScan'
import { IngestionQueue } from './ingestion/IngestionQueue'
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
  /**
   * 第一阶段每个通道的宽度（#77）。缺省 `DEFAULT_CANDIDATE_K`，且不会小于 `topK`。
   * 搜索面板与 eval harness 用它把「找多宽」和「交多少」分开。
   */
  candidateK?: number
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
 * 后台导入的进度回调（#176）。
 *
 * 带 `documentId`：一份 source 的进度要能落在它自己的那一行上，而不是只能让整个
 * notebook 共用一个布尔值。
 */
export type DocumentIndexProgressCallback = (
  documentId: string,
  stage: string,
  progress: number
) => void

/** 批量导入里被跳过的文件（#98）：已经在同一个 notebook 里。 */
export interface BatchImportSkip {
  path: string
  reason: string
}

/** 批量导入里失败的文件。每个文件都有自己的 ingestion run，这里只汇总。 */
export interface BatchImportFailure {
  path: string
  error: string
}

/**
 * 一次批量导入的结果。
 *
 * 三组互斥：`added` 是新建的 documentId，`skipped` 是重复路径，`failed` 是解析/索引
 * 阶段失败的路径。调用方永远知道「42 个里成功多少、跳过多少、失败多少」，而不是只
 * 看到一个总数。
 */
export interface BatchImportResult {
  added: string[]
  skipped: BatchImportSkip[]
  failed: BatchImportFailure[]
}

/**
 * 一个库 snapshot 的可选字段（#99）。导入/刷新在解析或内容确定之后用它建 snapshot，
 * membership 再缓存同一批字段，检索/阅读器继续读 `documents` 上的兼容投影。
 */
interface LibrarySnapshotFields {
  title: string
  type: DocumentType
  sourceUri?: string
  localFilePath?: string
  content?: string
  structure?: DocumentStructure
  contentHash?: string
  mimeType?: string
  fileSize?: number
  metadata?: Record<string, unknown>
}

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
  private folderWatch: FolderWatchService
  /** 后台索引队列（#176）：登记完就返回，解析/嵌入在这里继续。 */
  private readonly ingestionQueue: IngestionQueue

  constructor(embeddingService: EmbeddingService) {
    this.embeddingService = embeddingService
    this.chunkingService = new ChunkingService()
    this.retriever = new HybridRetriever(embeddingService)
    this.fileParserService = new FileParserService()
    this.webFetchService = new WebFetchService()
    // 知识库文件存储目录
    this.knowledgeFilesDir = join(app.getPath('userData'), 'knowledge-files')
    this.ensureKnowledgeFilesDir()
    // 监听服务只持有本服务的引用，构造本身没有副作用（不会开数据库、不会开始监听）。
    this.folderWatch = new FolderWatchService(this)
    this.ingestionQueue = new IngestionQueue()
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
   * 拷贝文件到知识库目录。
   *
   * 文件按 `ownerId`（库 snapshot 的 id）命名，而不是 document id：文件归 snapshot 所有，
   * 复制式刷新会为新 snapshot 生成新文件名，不会覆盖别的 notebook 正在用的物理文件。
   *
   * @param sourceFilePath 源文件路径
   * @param ownerId 拥有这份拷贝的库 snapshot id
   * @returns 本地文件路径
   */
  private async copyFileToKnowledgeDir(sourceFilePath: string, ownerId: string): Promise<string> {
    await this.ensureKnowledgeFilesDir()

    // 提取文件扩展名
    const extension = sourceFilePath.split('.').pop() || 'bin'
    const localFileName = `${ownerId}.${extension}`
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

    // 库 snapshot 在解析/内容确定之后、索引之前建立（#99）：这份内容从此可以被别的
    // notebook 复用，且复用不依赖原始可变文件。
    const sourceId = this.createLibrarySnapshot({
      title: options.title,
      type: options.type,
      sourceUri: options.sourceUri,
      content: options.content,
      contentHash,
      mimeType: options.mimeType,
      fileSize: options.fileSize,
      metadata: options.metadata
    })

    const newDoc: NewDocument = {
      id: documentId,
      notebookId,
      title: options.title,
      type: options.type,
      sourceUri: options.sourceUri,
      sourceNoteId: options.sourceNoteId,
      sourceId,
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
   * 从文件添加文档。
   *
   * 这条路保持同步（smoke test / eval harness / 监听刷新需要它跑完再往下），后台
   * 队列只服务 `knowledge:add-files` 这类批量导入。
   */
  async addDocumentFromFile(
    notebookId: string,
    filePath: string,
    onProgress?: IndexProgressCallback,
    chunkOptions?: ChunkOptions
  ): Promise<string> {
    const documentId = this.createPendingFileDocument(notebookId, filePath)
    await this.ingestPendingDocument(documentId, filePath, onProgress, chunkOptions)
    return documentId
  }

  /**
   * 批量导入（#176）：同步登记，后台索引。
   *
   * 返回时每个文件都已经是一个 `pending` 的 source；解析 / 分块 / 嵌入在
   * `IngestionQueue` 里继续，进度仍走 `knowledge:index-progress`。IPCC 不再把一次
   * book-sized 导入挂在调用栈上。
   */
  enqueueDocumentsFromPaths(
    notebookId: string,
    paths: readonly string[],
    onProgress?: DocumentIndexProgressCallback
  ): BatchImportResult {
    const db = getDatabase()
    const existing = new Set(
      db
        .select({ sourceUri: documents.sourceUri })
        .from(documents)
        .where(eq(documents.notebookId, notebookId))
        .all()
        .map((row) => row.sourceUri)
        .filter((uri): uri is string => typeof uri === 'string' && uri.length > 0)
    )

    const added: string[] = []
    const skipped: BatchImportSkip[] = []
    const failed: BatchImportFailure[] = []

    for (const filePath of paths) {
      if (existing.has(filePath)) {
        skipped.push({ path: filePath, reason: 'already imported into this notebook' })
        continue
      }

      try {
        const documentId = this.createPendingFileDocument(notebookId, filePath)
        existing.add(filePath)
        added.push(documentId)
        this.ingestionQueue.enqueue({
          documentId,
          onProgress: (stage, progress) => onProgress?.(documentId, stage, progress),
          run: async (jobProgress) => {
            try {
              await this.ingestPendingDocument(documentId, filePath, jobProgress)
            } catch (error) {
              // 失败也要给前台一个信号，否则后台跑挂的那一行会一直停在 pending。
              jobProgress('failed', 100)
              throw error
            }
          }
        })
      } catch (error) {
        failed.push({ path: filePath, error: (error as Error).message })
      }
    }

    return { added, skipped, failed }
  }

  /**
   * 登记一份 `pending` 的 source 行（不解析）。
   *
   * source 行必须在解析之前存在（#95）：后台索引期间用户已经能在列表里看到它，也
   * 让失败有地方落。
   */
  private createPendingFileDocument(notebookId: string, filePath: string): string {
    const documentId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const now = new Date()

    getDatabase()
      .insert(documents)
      .values({
        id: documentId,
        notebookId,
        title: basename(filePath) || 'Untitled',
        type: 'file',
        sourceUri: filePath,
        status: 'pending',
        chunkCount: 0,
        createdAt: now,
        updatedAt: now
      })
      .run()

    return documentId
  }

  /** 解析一份已登记的文件 source（同步与后台队列共用）。 */
  private async ingestPendingDocument(
    documentId: string,
    filePath: string,
    onProgress?: IndexProgressCallback,
    chunkOptions?: ChunkOptions
  ): Promise<void> {
    const doc = this.getDocument(documentId)
    if (!doc) {
      Logger.warn('KnowledgeService', `Pending document ${documentId} disappeared before indexing`)
      return
    }

    getDatabase()
      .update(documents)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(documents.id, documentId))
      .run()

    // 先拷贝，再解析原文件：本地副本是重新索引/结构恢复时读取的东西。
    await this.ingestFile(
      documentId,
      filePath,
      { copyFrom: filePath, chunkOptions },
      'import',
      onProgress
    )
  }

  /**
   * 把一个文件夹导入为**一次快照**（#98）。
   *
   * 扫描只挑解析器认识的扩展名，其余文件被跳过并计数，而不是静默忽略。这是一次快照
   * —— 之后新增到文件夹里的文件不会被自动带走，那是 #158 的监听。
   *
   * 登记完成后立即返回，索引在后台队列里继续（#176）。
   */
  async addFolder(
    notebookId: string,
    folderPath: string,
    onProgress?: DocumentIndexProgressCallback
  ): Promise<BatchImportResult> {
    const scanned = await scanFolder(folderPath, this.fileParserService.supportedExtensions())
    return this.enqueueDocumentsFromPaths(
      notebookId,
      scanned.map((file) => file.path),
      onProgress
    )
  }

  /**
   * 一条 ingestion pipeline：copy（可选）→ parse → snapshot → chunk → embed → 写入派生索引。
   *
   * 导入与「解析阶段失败后的重试」共用它：后者已经有本地副本，直接解析副本，不再拷贝。
   * run 的生命周期也在这里维护（#95）—— 每条路径都必须留下一次完整的尝试记录。
   *
   * 库 snapshot 在**解析之后、索引之前**建立（#99）：内容一旦确定就能被复用，而索引
   * 失败也不会留下一个空 snapshot。`refresh` 为真时走 copy-on-write，新开一个
   * snapshot，旧 snapshot 与它正在服务的别的 notebook 完全不受影响。
   */
  private async ingestFile(
    documentId: string,
    filePath: string,
    options: { copyFrom?: string; chunkOptions?: ChunkOptions; refresh?: boolean },
    kind: IngestionRunKind,
    onProgress?: IndexProgressCallback
  ): Promise<void> {
    const db = getDatabase()
    const existing = this.getDocument(documentId)
    if (!existing) throw new Error(`Document ${documentId} not found`)

    const runId = startRun(documentId, kind)

    // snapshot 计划：刷新/首次/被共享 -> 新开；一份从未解析成功的独占空快照 -> 原地补齐；
    // 已解析且独占 -> 保持不动。共享期间快照不可变，任何路径都不会原地改写别人的快照。
    const plan = planSnapshotWrite({
      refresh: options.refresh === true,
      hasSourceId: Boolean(existing.sourceId),
      hasContent: Boolean(existing.content),
      membershipCount: existing.sourceId
        ? countMemberships(this.requireRawSqlite(), existing.sourceId)
        : 0
    })
    const isNewSnapshot = plan === 'new'
    const sourceId = isNewSnapshot ? this.newLibrarySourceId() : existing.sourceId!
    let localFilePath = existing.localFilePath
    let snapshotCommitted = false

    try {
      if (plan === 'keep') {
        // 当前调用图不会走到这里（retryDocument 对已解析来源直接转 reindexDocument），但保留
        // 这条路径：已解析的独占快照按 ADR 从持久化快照重建，绝不因重试而漂移。
        await this.indexDocument(
          documentId,
          runId,
          existing.content!,
          existing.structure ?? undefined,
          { chunkOptions: options.chunkOptions },
          onProgress
        )
        completeRun(runId)
        return
      }

      if (options.copyFrom) {
        advanceRun(runId, 'copying', 0)
        onProgress?.('copying', 0)
        // 文件归 snapshot 所有：新 snapshot 得到新文件名，不会覆盖共享的物理文件。
        localFilePath = await this.copyFileToKnowledgeDir(options.copyFrom, sourceId)
        // Stage the file until parsing succeeds: failed refresh must keep the old
        // canonical text and the matching old file together.
      }

      advanceRun(runId, 'parsing', 5)
      onProgress?.('parsing', 5)
      const parseResult = await this.fileParserService.parseFile(filePath)

      // 计算内容哈希
      const contentHash = createHash('md5').update(parseResult.content).digest('hex')
      const docType: DocumentType =
        parseResult.mimeType === 'text/plain' || parseResult.mimeType === 'text/markdown'
          ? 'text'
          : 'file'
      const title = parseResult.title || basename(filePath) || 'Untitled'
      const sourceMtimeMs = (await stat(filePath).catch(() => null))?.mtimeMs

      // 解析完成之后、索引之前：先落 snapshot，再让 membership 指向它。
      const snapshotFields: LibrarySnapshotFields = {
        title,
        type: docType,
        sourceUri: existing.sourceUri ?? filePath,
        localFilePath: localFilePath ?? undefined,
        content: parseResult.content,
        structure: parseResult.structure ?? undefined,
        contentHash,
        mimeType: parseResult.mimeType,
        fileSize: parseResult.metadata?.fileSize as number | undefined,
        metadata: parseResult.metadata
      }
      if (isNewSnapshot) {
        this.insertLibrarySnapshot(sourceId, snapshotFields)
      } else {
        // plan === 'fill'：升级前解析失败、迁移只给它一个空的独占 snapshot（content = NULL）。
        // 重试成功后原地补齐，这份快照才真正可复用；空快照没有任何 citation 引用。
        this.updateLibrarySnapshot(sourceId, snapshotFields)
      }

      db.update(documents)
        .set({
          title,
          type: docType,
          sourceId,
          localFilePath,
          status: 'processing',
          content: parseResult.content,
          // 结构随 source 一起持久化，重新索引才能不加解析地重建同一批块
          structure: parseResult.structure ?? undefined,
          contentHash,
          mimeType: parseResult.mimeType,
          fileSize: parseResult.metadata?.fileSize as number | undefined,
          metadata: parseResult.metadata,
          errorMessage: null,
          // 文件回到 available，并记下这次看到的 mtime：watch（#158）靠它判断是否被改过。
          sourceState: 'available',
          sourceMtimeMs,
          updatedAt: new Date()
        })
        .where(eq(documents.id, documentId))
        .run()

      snapshotCommitted = true
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
      if (!snapshotCommitted && localFilePath) {
        if (existing.content) {
          // A failed refresh never publishes its staged file over the old snapshot.
          if (localFilePath !== existing.localFilePath) await this.deleteLocalFile(localFilePath)
        } else {
          // Keep failed imports library-owned too, so detach/notebook deletion
          // cannot strand a file with no path to confirmed permanent deletion.
          const emptySnapshot: LibrarySnapshotFields = {
            title: existing.title,
            type: existing.type,
            sourceUri: existing.sourceUri ?? filePath,
            localFilePath,
            mimeType: existing.mimeType ?? undefined,
            fileSize: existing.fileSize ?? undefined,
            metadata: existing.metadata ?? undefined
          }
          if (isNewSnapshot) this.insertLibrarySnapshot(sourceId, emptySnapshot)
          else this.updateLibrarySnapshot(sourceId, emptySnapshot)
          db.update(documents)
            .set({ sourceId, localFilePath })
            .where(eq(documents.id, documentId))
            .run()
        }
      }
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
   * 统一后台导入（#176）：登记 `pending` 行，解析 / 分块 / 嵌入在队列里继续。
   *
   * 内容已经可用的来源（粘贴文本 / 笔记）走这里；URL 要先抓取，见
   * `enqueueDocumentFromUrl`。返回时列表里已经有这一行，Dialog 不必再等索引结束。
   */
  enqueueContentDocument(
    notebookId: string,
    options: AddDocumentOptions,
    onProgress?: DocumentIndexProgressCallback
  ): string {
    const db = getDatabase()
    const documentId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const now = new Date()
    const contentHash = createHash('md5').update(options.content).digest('hex')

    // 内容已经可用，snapshot 立刻建立（#99）：列表里这一行就是可复用的库来源。
    const sourceId = this.createLibrarySnapshot({
      title: options.title,
      type: options.type,
      sourceUri: options.sourceUri,
      content: options.content,
      contentHash,
      mimeType: options.mimeType,
      fileSize: options.fileSize,
      metadata: options.metadata
    })

    const newDoc: NewDocument = {
      id: documentId,
      notebookId,
      title: options.title,
      type: options.type,
      sourceUri: options.sourceUri,
      sourceNoteId: options.sourceNoteId,
      sourceId,
      content: options.content,
      contentHash,
      mimeType: options.mimeType,
      fileSize: options.fileSize,
      metadata: options.metadata,
      status: 'pending',
      chunkCount: 0,
      createdAt: now,
      updatedAt: now
    }
    db.insert(documents).values(newDoc).run()

    this.ingestionQueue.enqueue({
      documentId,
      onProgress: (stage, progress) => onProgress?.(documentId, stage, progress),
      run: async (jobProgress) => {
        const runId = startRun(documentId, 'import')
        try {
          await this.indexDocument(
            documentId,
            runId,
            options.content,
            undefined,
            { chunkOptions: options.chunkOptions },
            jobProgress
          )
          completeRun(runId)
        } catch (error) {
          failRun(runId, (error as Error).message)
          jobProgress('failed', 100)
          throw error
        }
      }
    })

    return documentId
  }

  /**
   * 从 Note 后台导入。空笔记在登记前就拒绝 —— 那不是延迟反馈，是输入本身不合法。
   */
  enqueueNoteDocument(
    notebookId: string,
    noteId: string,
    onProgress?: DocumentIndexProgressCallback
  ): string {
    const note = getDatabase().select().from(notes).where(eq(notes.id, noteId)).get()
    if (!note) throw new Error(`Note ${noteId} not found`)

    if (note.content.trim().length === 0) {
      throw new Error('Note content is empty. Cannot add empty note to knowledge base.')
    }

    return this.enqueueContentDocument(
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
   * 从 URL 后台导入：先登记 `pending` 行，抓取 / 解析 / 嵌入都在队列里。
   *
   * URL 校验（协议、可解析）应在调用前完成；这里只负责登记与后台处理。
   */
  enqueueDocumentFromUrl(
    notebookId: string,
    url: string,
    onProgress?: DocumentIndexProgressCallback
  ): string {
    const db = getDatabase()
    const documentId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const now = new Date()

    const newDoc: NewDocument = {
      id: documentId,
      notebookId,
      title: url,
      type: 'url',
      sourceUri: url,
      status: 'pending',
      chunkCount: 0,
      createdAt: now,
      updatedAt: now
    }
    db.insert(documents).values(newDoc).run()

    this.ingestionQueue.enqueue({
      documentId,
      onProgress: (stage, progress) => onProgress?.(documentId, stage, progress),
      run: async (jobProgress) => {
        const runId = startRun(documentId, 'import')
        try {
          jobProgress('fetching_url', 0)
          const fetchResult = await this.webFetchService.fetchUrl(url)
          const content = fetchResult.content
          const title = fetchResult.title || url
          const metadata = {
            ...fetchResult.metadata,
            description: fetchResult.description
          }

          // 抓取完成之后、索引之前建立 snapshot（#99）。
          const sourceId = this.createLibrarySnapshot({
            title,
            type: 'url',
            sourceUri: url,
            content,
            contentHash: createHash('md5').update(content).digest('hex'),
            mimeType: fetchResult.mimeType,
            metadata
          })

          db.update(documents)
            .set({
              title,
              sourceId,
              content,
              contentHash: createHash('md5').update(content).digest('hex'),
              mimeType: fetchResult.mimeType,
              metadata,
              updatedAt: new Date()
            })
            .where(eq(documents.id, documentId))
            .run()

          await this.indexDocument(documentId, runId, content, undefined, {}, jobProgress)
          completeRun(runId)
        } catch (error) {
          failRun(runId, (error as Error).message)
          jobProgress('failed', 100)
          throw error
        }
      }
    })

    return documentId
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
      candidateK: options.candidateK,
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
   * 从一个 notebook 解除挂载（#99）。
   *
   * 只删这个 membership 及其派生索引：库 snapshot 与它的物理文件保留（可能还有别的
   * notebook 在用，也可能只是留着以后复用）。永久删除库来源是另一个显式、已确认的
   * 操作（`deleteLibrarySource`）。notebook 删除走同样的 detach-only 语义。
   */
  async deleteDocument(documentId: string): Promise<void> {
    const db = getDatabase()

    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc) return

    // 删除全部派生索引（向量、映射、chunks、embeddings、blocks）。
    await this.clearDerivedIndex(documentId)

    // 只删 membership 行：文件名归库 snapshot 所有，这里绝不能 unlink。
    db.delete(documents).where(eq(documents.id, documentId)).run()

    executeCheckpoint('PASSIVE')
    Logger.info('KnowledgeService', `Document detached: ${documentId}`)
  }

  /**
   * 列出这个 notebook 还没挂载的库 snapshot（#99）。
   *
   * `canReuseIndex` 需要「当前配置的 space」，所以它是异步的：只有 donor 持久化的
   * space 与当前模型一致、且目标 notebook 能接住时，才可能不调用 embedding 直接复用。
   */
  async listLibrarySources(notebookId: string): Promise<LibrarySourceSummary[]> {
    const space = await this.embeddingService.getSpace()
    return listLibrarySourceSummaries(
      this.requireRawSqlite(),
      notebookId,
      this.embeddingSpaceIdentity(space),
      this.vectorTableAccess()
    )
  }

  /**
   * 把一个库 snapshot 挂载到 notebook（#99）。
   *
   * 可复用时只复制 donor 的派生索引与向量，**绝不调用 embedding**；不可复用（模型/
   * 维度不匹配，或没有 donor）时落一个 pending membership，等用户显式重新索引（这条
   * 路径不碰任何已有向量）。重复挂载幂等。所有 DB 操作在 `getSpace()` 之后同步完成，
   * 所以挂载与删除不会交错。
   */
  async attachLibrarySource(
    notebookId: string,
    sourceId: string
  ): Promise<{ documentId: string; indexed: boolean }> {
    const space = await this.embeddingService.getSpace()
    const result = attachLibrarySourceMembership(this.requireRawSqlite(), {
      notebookId,
      sourceId,
      currentSpace: this.embeddingSpaceIdentity(space),
      tables: this.vectorTableAccess()
    })
    // 空目标会在 attach 里新建向量表，而 vectorStoreManager 可能已经缓存了一个
    // 无向量表的 store（初始化时读过 vec_metadata 为空）。丢掉缓存，下一次检索/写入
    // 会从新的元数据重新初始化，否则会以为目标还没有向量表。
    await vectorStoreManager.closeStore(notebookId)
    Logger.info(
      'KnowledgeService',
      `Library source attached: ${sourceId} -> ${notebookId} (indexed: ${result.indexed})`
    )
    return { documentId: result.documentId, indexed: result.indexed }
  }

  /**
   * 永久删除一个库 snapshot（#99）。未确认或仍被挂载时拒绝；删成功后 unlink 它的
   * 本地文件。这是唯一会删库文件的路径。
   */
  async deleteLibrarySource(sourceId: string, confirmed: boolean): Promise<void> {
    const { localFilePath, deleted } = deleteLibrarySourceRecord(
      this.requireRawSqlite(),
      sourceId,
      confirmed
    )
    if (deleted && localFilePath) {
      await this.deleteLocalFile(localFilePath)
    }
    Logger.info('KnowledgeService', `Library source deleted: ${sourceId}`)
  }

  /** 当前 embedding 空间的身份，库复用用它判断向量可比性。 */
  private embeddingSpaceIdentity(space: EmbeddingSpace): EmbeddingSpaceIdentity {
    return { id: space.id, dimensions: space.dimensions }
  }

  /** 库复用边界需要的向量表读写，从 db 层注入。 */
  private vectorTableAccess(): VectorTableAccess {
    return {
      read: (notebookId) => getNotebookVectorTable(notebookId),
      ensure: (notebookId, dimensions) => createNotebookVectorTable(notebookId, dimensions)
    }
  }

  private requireRawSqlite(): Database.Database {
    const sqlite = getSqlite()
    if (!sqlite) throw new Error('Database not initialized')
    return sqlite
  }

  private newLibrarySourceId(): string {
    return `lib_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  private createLibrarySnapshot(fields: LibrarySnapshotFields): string {
    const id = this.newLibrarySourceId()
    this.insertLibrarySnapshot(id, fields)
    return id
  }

  /** 插入一个库 snapshot 行。调用方负责在解析/内容确定之后、索引之前调用。 */
  private insertLibrarySnapshot(id: string, fields: LibrarySnapshotFields): void {
    insertLibrarySourceRow(this.requireRawSqlite(), id, this.snapshotRowFields(fields))
  }

  /** 原地补齐一份从没有过内容的 snapshot（迁移回填的解析失败来源）。 */
  private updateLibrarySnapshot(id: string, fields: LibrarySnapshotFields): void {
    updateLibrarySourceRow(this.requireRawSqlite(), id, this.snapshotRowFields(fields))
  }

  /** `LibrarySnapshotFields` → 落库字段；structure/metadata 与 drizzle 的 json 模式一致。 */
  private snapshotRowFields(
    fields: LibrarySnapshotFields
  ): Parameters<typeof insertLibrarySourceRow>[2] {
    return {
      title: fields.title,
      type: fields.type,
      sourceUri: fields.sourceUri ?? null,
      localFilePath: fields.localFilePath ?? null,
      content: fields.content ?? null,
      structure: fields.structure ? JSON.stringify(fields.structure) : null,
      contentHash: fields.contentHash ?? null,
      mimeType: fields.mimeType ?? null,
      fileSize: fields.fileSize ?? null,
      metadata: fields.metadata ? JSON.stringify(fields.metadata) : null
    }
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

  /** 当前所有已注册 loader 认识的扩展名（#98 / #158 的扫描用它）。 */
  supportedExtensions(): string[] {
    return this.fileParserService.supportedExtensions()
  }

  /**
   * 一个被监听文件夹下的所有 source（#158）。
   *
   * 按 `sourceUri` 前缀匹配：文件导入后 sourceUri 仍是原路径，所以「这个文件夹下的
   * 来源」可以直接算出来，不需要另存一份父子关系。
   */
  getWatchedDocuments(notebookId: string, folderPath: string): WatchedDocument[] {
    const prefix = folderPath.endsWith(sep) ? folderPath : folderPath + sep

    return getDatabase()
      .select({
        documentId: documents.id,
        sourceUri: documents.sourceUri,
        sourceMtimeMs: documents.sourceMtimeMs,
        sourceState: documents.sourceState,
        metadata: documents.metadata
      })
      .from(documents)
      .where(eq(documents.notebookId, notebookId))
      .all()
      .map(({ metadata, ...row }) => ({
        ...row,
        snapshotOnly: metadata?.librarySnapshotOnly === true
      }))
      .filter(
        (row): row is WatchedDocument & { snapshotOnly: boolean } =>
          typeof row.sourceUri === 'string' &&
          (row.sourceUri === folderPath || row.sourceUri.startsWith(prefix))
      )
  }

  /** 标记来源文件本身的状态（#158）：`missing` 不删行，也不碰笔记与 citation。 */
  markSourceState(documentId: string, state: 'available' | 'missing' | 'changed'): void {
    getDatabase()
      .update(documents)
      .set({ sourceState: state, updatedAt: new Date() })
      .where(eq(documents.id, documentId))
      .run()
  }

  /**
   * 来源文件变了：重新拷贝、解析并索引**同一个** membership（#158）。
   *
   * 与 reindex 的区别：reindex 用的是已持久化的 content，而这里文件本身被改过，必须
   * 重新解析。刷新是 copy-on-write（#99）：新开一个库 snapshot（新文件、新 id），旧
   * snapshot 与它正在服务的别的 notebook 的文本/页偏移完全不变。membership 的 ID
   * 不变，所以历史 citation 与摘录仍然指向同一个来源行。
   */
  async refreshDocumentFromFile(documentId: string, filePath: string): Promise<void> {
    await this.ingestFile(documentId, filePath, { copyFrom: filePath, refresh: true }, 'reindex')
  }

  /**
   * 监听一个文件夹（#158）：持久化监听关系，立刻对齐一次，然后开始实时监听。
   * 立刻对齐是必要的：watch 建立之前的改动也要被覆盖，而不仅仅依赖之后的 fs 事件。
   */
  async watchFolder(notebookId: string, folderPath: string): Promise<ReconcileResult> {
    addFolderWatch(notebookId, folderPath)
    const result = await this.folderWatch.reconcileFolder(notebookId, folderPath)
    this.folderWatch.start()
    return result
  }

  unwatchFolder(watchId: string): void {
    removeFolderWatch(watchId)
    this.folderWatch.stopWatch(watchId)
  }

  listFolderWatches(notebookId: string): FolderWatchRecord[] {
    return listFolderWatchesForNotebook(notebookId)
  }

  /** 启动时对齐一次（#158）：app 关着的时候发生的改动不会被漏掉。 */
  async reconcileWatchedFolders(): Promise<ReconcileResult[]> {
    return this.folderWatch.reconcileAll()
  }

  startFolderWatching(): void {
    this.folderWatch.start()
  }

  stopFolderWatching(): void {
    this.folderWatch.stop()
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
