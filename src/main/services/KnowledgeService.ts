/**
 * KnowledgeService
 * 지식 베이스 핵심 서비스, 문서 관리, 청킹, 임베딩 및 검색 통합
 */

import { createHash } from 'crypto'
import { app } from 'electron'
import { join, basename } from 'path'
import { mkdir, copyFile, unlink, stat } from 'fs/promises'
import { getDatabase, getSqlite, executeCheckpoint } from '../db'
import { documents, chunks, embeddings, notes } from '../db/schema'
import type { Document, Chunk, NewDocument, NewChunk, NewEmbedding } from '../db/schema'
import { eq, desc, inArray, sql } from 'drizzle-orm'
import { EmbeddingService } from './EmbeddingService'
import { ChunkingService, type ChunkOptions } from './ChunkingService'
import { FileParserService } from './FileParserService'
import { WebFetchService } from './WebFetchService'
import { HybridSearchService, type SearchMode } from './HybridSearchService'
import { RerankService } from './RerankService'
import { vectorStoreManager } from '../vectorstore'
import { ProviderManager } from '../providers/ProviderManager'
import Logger from '../../shared/utils/logger'

/**
 * 문서 추가 옵션
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
 * 검색 옵션
 */
export interface SearchOptions {
  topK?: number // 반환 결과 수, 기본값 5
  threshold?: number // 유사도 임계값, 기본값 0.5
  includeContent?: boolean // chunk 내용 포함 여부, 기본값 true
  searchMode?: SearchMode // 검색 모드: 'semantic' | 'keyword' | 'hybrid'
}

/**
 * 검색 결과
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
 * 인덱싱 진행률 콜백
 */
export type IndexProgressCallback = (stage: string, progress: number) => void

/**
 * 지식 베이스 서비스
 * 문서, 청킹, 임베딩 및 검색 관리
 */
export class KnowledgeService {
  private embeddingService: EmbeddingService
  private chunkingService: ChunkingService
  private fileParserService: FileParserService
  private webFetchService: WebFetchService
  private hybridSearchService: HybridSearchService
  private rerankService: RerankService
  private knowledgeFilesDir: string

  constructor(providerManager: ProviderManager) {
    this.embeddingService = new EmbeddingService(providerManager)
    this.chunkingService = new ChunkingService()
    this.fileParserService = new FileParserService()
    this.webFetchService = new WebFetchService()
    this.hybridSearchService = new HybridSearchService(this.embeddingService)
    this.rerankService = new RerankService(this.embeddingService)
    // 지식 베이스 파일 저장 디렉토리
    this.knowledgeFilesDir = join(app.getPath('userData'), 'knowledge-files')
    this.ensureKnowledgeFilesDir()
  }

  /**
   * 지식 베이스 파일 디렉토리가 존재하는지 확인
   */
  private async ensureKnowledgeFilesDir() {
    try {
      await mkdir(this.knowledgeFilesDir, { recursive: true })
    } catch (error) {
      Logger.error('KnowledgeService', 'Failed to create knowledge files directory:', error)
    }
  }

  /**
   * 파일을 지식 베이스 디렉토리로 복사
   * @param sourceFilePath 원본 파일 경로
   * @param documentId 문서 ID
   * @returns 로컬 파일 경로
   */
  private async copyFileToKnowledgeDir(
    sourceFilePath: string,
    documentId: string
  ): Promise<string> {
    await this.ensureKnowledgeFilesDir()

    // 파일 확장자 추출
    const extension = sourceFilePath.split('.').pop() || 'bin'
    const localFileName = `${documentId}.${extension}`
    const localFilePath = join(this.knowledgeFilesDir, localFileName)

    // 파일 복사
    await copyFile(sourceFilePath, localFilePath)
    Logger.info('KnowledgeService', `File copied: ${sourceFilePath} -> ${localFilePath}`)

    return localFilePath
  }

  /**
   * 지식 베이스의 로컬 파일 삭제
   * @param localFilePath 로컬 파일 경로
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
   * 지식 베이스에 문서 추가
   */
  async addDocument(
    notebookId: string,
    options: AddDocumentOptions,
    onProgress?: IndexProgressCallback
  ): Promise<string> {
    const db = getDatabase()
    const documentId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const now = new Date()

    // 콘텐츠 해시 계산
    const contentHash = createHash('md5').update(options.content).digest('hex')

    try {
      // 1. 문서 레코드 생성
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

      // 2. 청킹
      onProgress?.('chunking', 10)
      const chunkResults = this.chunkingService.chunk(options.content, options.chunkOptions)

      if (chunkResults.length === 0) {
        throw new Error('No chunks generated from document')
      }

      Logger.info('KnowledgeService', `Document ${documentId}: ${chunkResults.length} chunks`)

      // 3. 청크 저장
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

      this.indexChunksToFts(chunkContents, chunkIds, notebookId)

      // 4. 임베딩 벡터 생성
      onProgress?.('generating_embeddings', 30)

      // Contextual chunk enrichment: prepend document title for better embedding quality
      const enrichedContents = chunkContents.map(
        (content) => `제목: ${options.title}\n\n${content}`
      )

      const embeddingResults = await this.embeddingService.embedBatch(
        enrichedContents,
        {},
        (completed, total) => {
          const progress = 30 + (completed / total) * 50
          onProgress?.('generating_embeddings', Math.round(progress))
        }
      )

      // 벡터 차원 감지 및 VectorStoreManager 업데이트
      const detectedDimensions = embeddingResults.length > 0 ? embeddingResults[0].dimensions : 1536
      if (embeddingResults.length > 0) {
        vectorStoreManager.setDefaultDimensions(detectedDimensions)
        Logger.debug('KnowledgeService', `Detected embedding dimensions: ${detectedDimensions}`)
      }

      // 5. 임베딩 메타데이터 저장 및 벡터 스토어에 추가
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

        // 임베딩 메타데이터를 데이터베이스에 저장
        const newEmbedding: NewEmbedding = {
          id: embeddingId,
          chunkId: chunkIds[i],
          notebookId,
          model: embResult.model,
          dimensions: embResult.dimensions,
          createdAt: now
        }

        db.insert(embeddings).values(newEmbedding).run()

        // 벡터 데이터 준비
        vectorItems.push({
          id: embeddingId,
          chunkId: chunkIds[i],
          vector: embResult.embedding,
          metadata: { model: embResult.model, documentId }
        })
      }

      // 벡터 스토어에 일괄 추가
      await vectorStore.upsert(vectorItems)

      // 6. 문서 상태 업데이트
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
      // 문서 상태를 실패로 업데이트
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
   * 파일에서 문서 추가
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

      // 먼저 파일을 지식 베이스 디렉토리로 복사
      localFilePath = await this.copyFileToKnowledgeDir(filePath, documentId)

      const parseResult = await this.fileParserService.parseFile(filePath)

      // 콘텐츠 해시 계산
      const contentHash = createHash('md5').update(parseResult.content).digest('hex')
      const now = new Date()

      // 1. 문서 레코드 생성 (localFilePath 포함)
      onProgress?.('creating_document', 0)

      // MIME 타입에 따라 문서 타입 결정
      // text/plain 및 text/markdown은 직접 미리보기 가능
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

      // 2. 청킹
      onProgress?.('chunking', 10)
      const chunkResults = this.chunkingService.chunk(parseResult.content)

      if (chunkResults.length === 0) {
        throw new Error('No chunks generated from document')
      }

      const title = parseResult.title || basename(filePath) || 'Untitled'
      Logger.info('KnowledgeService', `Document ${documentId}: ${chunkResults.length} chunks`)

      // 3. 청크 저장
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

      this.indexChunksToFts(chunkContents, chunkIds, notebookId)

      // 4. 임베딩 벡터 생성
      onProgress?.('generating_embeddings', 30)

      // Contextual chunk enrichment: prepend document title for better embedding quality
      const enrichedContents = chunkContents.map((content) => `제목: ${title}\n\n${content}`)

      const embeddingResults = await this.embeddingService.embedBatch(
        enrichedContents,
        {},
        (completed, total) => {
          const progress = 30 + (completed / total) * 50
          onProgress?.('generating_embeddings', Math.round(progress))
        }
      )

      // 벡터 차원 감지 및 VectorStoreManager 업데이트
      const detectedDimensions = embeddingResults.length > 0 ? embeddingResults[0].dimensions : 1536
      if (embeddingResults.length > 0) {
        vectorStoreManager.setDefaultDimensions(detectedDimensions)
        Logger.debug('KnowledgeService', `Detected embedding dimensions: ${detectedDimensions}`)
      }

      // 5. 임베딩 메타데이터 저장 및 벡터 스토어에 추가
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

        // 임베딩 메타데이터를 데이터베이스에 저장
        const newEmbedding: NewEmbedding = {
          id: embeddingId,
          chunkId: chunkIds[i],
          notebookId,
          model: embResult.model,
          dimensions: embResult.dimensions,
          createdAt: now
        }

        db.insert(embeddings).values(newEmbedding).run()

        // 벡터 데이터 준비
        vectorItems.push({
          id: embeddingId,
          chunkId: chunkIds[i],
          vector: embResult.embedding,
          metadata: { model: embResult.model, documentId }
        })
      }

      // 벡터 스토어에 일괄 추가
      await vectorStore.upsert(vectorItems)

      // 6. 문서 상태 업데이트
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
      // 실패 시 복사된 파일 삭제
      if (localFilePath) {
        await this.deleteLocalFile(localFilePath)
      }

      // 문서 상태를 실패로 업데이트
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
   * URL에서 문서 추가
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
   * 노트를 지식 베이스에 추가
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

    // 노트 내용이 비어있지 않은지 확인
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
   * FTS5 인덱스에 청크 일괄 삽입
   */
  private indexChunksToFts(contents: string[], chunkIds: string[], notebookId: string): void {
    const sqliteDb = getSqlite()
    if (!sqliteDb) return
    try {
      const stmt = sqliteDb.prepare(
        'INSERT INTO chunks_fts(content, chunk_id, notebook_id) VALUES (?, ?, ?)'
      )
      for (let i = 0; i < chunkIds.length; i++) {
        stmt.run(contents[i], chunkIds[i], notebookId)
      }
    } catch (error) {
      Logger.warn('KnowledgeService', 'FTS5 indexing failed (non-critical):', error)
    }
  }

  /**
   * 검색 (hybrid/keyword/semantic)
   */
  async search(
    notebookId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const { topK = 5, threshold = 0.3, includeContent = true, searchMode = 'hybrid' } = options

    Logger.info('RAG', `Search: mode=${searchMode}, query="${query.substring(0, 50)}..."`)

    // 1. 검색 실행 → chunkId[] 획득
    const candidateChunkIds = await this.retrieveChunkIds(
      notebookId,
      query,
      searchMode,
      topK,
      threshold
    )

    if (candidateChunkIds.length === 0) {
      Logger.info('RAG', `Results: candidates=0, after_rerank=0`)
      return []
    }

    // 2. 결과 조립 (1곳에서만)
    let results = this.assembleSearchResults(candidateChunkIds, includeContent)

    // 3. 재순위화 (후보가 topK보다 많을 때)
    if (results.length > topK) {
      results = await this.applyReranking(query, results, topK)
    }

    Logger.info(
      'RAG',
      `Results: candidates=${candidateChunkIds.length}, after_rerank=${results.length}`
    )
    return results
  }

  /**
   * 검색 모드에 따라 chunkId 목록 획득
   */
  private async retrieveChunkIds(
    notebookId: string,
    query: string,
    searchMode: SearchMode,
    topK: number,
    threshold: number
  ): Promise<string[]> {
    if (searchMode === 'hybrid' || searchMode === 'keyword') {
      const hybridResults = await this.hybridSearchService.search(notebookId, query, {
        topK: topK * 4,
        threshold,
        searchMode
      })
      return hybridResults.map((r) => r.chunkId)
    }

    // semantic: 벡터 검색만
    const queryEmbedding = await this.embeddingService.embed(query)
    const vectorStore = await vectorStoreManager.getStore(notebookId)
    const vectorResults = await vectorStore.query(queryEmbedding.embedding, {
      topK: topK * 4,
      threshold
    })
    return vectorResults.map((r) => r.chunkId)
  }

  /**
   * chunkId 목록으로 SearchResult 조립 (단일 코드 경로)
   */
  private assembleSearchResults(chunkIds: string[], includeContent: boolean): SearchResult[] {
    const db = getDatabase()
    const chunkDetails = db.select().from(chunks).where(inArray(chunks.id, chunkIds)).all()

    const documentIds = [...new Set(chunkDetails.map((c) => c.documentId))]
    const documentDetails = db
      .select()
      .from(documents)
      .where(inArray(documents.id, documentIds))
      .all()

    const documentMap = new Map(documentDetails.map((d) => [d.id, d]))
    const chunkMap = new Map(chunkDetails.map((c) => [c.id, c]))

    const results: SearchResult[] = []
    for (let i = 0; i < chunkIds.length; i++) {
      const chunk = chunkMap.get(chunkIds[i])
      if (!chunk) continue
      const doc = documentMap.get(chunk.documentId)

      results.push({
        chunkId: chunkIds[i],
        documentId: chunk.documentId,
        documentTitle: doc?.title || 'Unknown',
        documentType: doc?.type || 'unknown',
        content: includeContent ? chunk.content : '',
        score: 1 - i * 0.01,
        chunkIndex: chunk.chunkIndex,
        metadata: chunk.metadata
          ? typeof chunk.metadata === 'string'
            ? JSON.parse(chunk.metadata as string)
            : chunk.metadata
          : undefined
      })
    }

    return results
  }

  /**
   * 재순위화 적용
   */
  private async applyReranking(
    query: string,
    results: SearchResult[],
    topN: number
  ): Promise<SearchResult[]> {
    try {
      const candidates = results.map((r) => ({
        chunkId: r.chunkId,
        content: r.content,
        score: r.score,
        documentId: r.documentId,
        documentTitle: r.documentTitle,
        documentType: r.documentType,
        chunkIndex: r.chunkIndex,
        metadata: r.metadata
      }))

      const reranked = await this.rerankService.rerank(query, candidates, topN)

      return reranked.map((r) => ({
        chunkId: r.chunkId,
        documentId: r.documentId as string,
        documentTitle: r.documentTitle as string,
        documentType: r.documentType as string,
        content: r.content,
        score: r.score,
        chunkIndex: r.chunkIndex as number,
        metadata: r.metadata as Record<string, unknown> | undefined
      }))
    } catch (error) {
      Logger.warn('RAG', 'Reranking failed, using original order:', error)
      return results.slice(0, topN)
    }
  }

  /**
   * notebook의 모든 문서 조회
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
   * 단일 문서 조회
   */
  getDocument(documentId: string): Document | undefined {
    const db = getDatabase()
    return db.select().from(documents).where(eq(documents.id, documentId)).get()
  }

  /**
   * 문서의 모든 chunks 조회
   */
  getDocumentChunks(documentId: string): Chunk[] {
    const db = getDatabase()
    return db.select().from(chunks).where(eq(chunks.documentId, documentId)).all()
  }

  /**
   * 문서 삭제
   */
  async deleteDocument(documentId: string): Promise<void> {
    const db = getDatabase()

    // 문서 정보 조회
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
    if (!doc) return

    // 모든 chunk ID 조회
    const docChunks = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .all()

    // 벡터 스토어에서 삭제
    if (docChunks.length > 0) {
      const vectorStore = await vectorStoreManager.getStore(doc.notebookId)
      await vectorStore.deleteByChunkIds(docChunks.map((c) => c.id))

      // FTS5 인덱스에서 삭제
      const sqliteDbDel = getSqlite()
      if (sqliteDbDel) {
        const ftsDelStmt = sqliteDbDel.prepare('DELETE FROM chunks_fts WHERE chunk_id = ?')
        for (const c of docChunks) {
          ftsDelStmt.run(c.id)
        }
      }
    }

    // 로컬 복사 파일 삭제 (존재하는 경우)
    if (doc.localFilePath) {
      await this.deleteLocalFile(doc.localFilePath)
    }

    // 캐스케이드 삭제가 자동으로 chunks와 embeddings를 정리
    db.delete(documents).where(eq(documents.id, documentId)).run()

    executeCheckpoint('PASSIVE')
    Logger.info('KnowledgeService', `Document deleted: ${documentId}`)
  }

  /**
   * 문서 인덱스 재구축
   */
  async reindexDocument(documentId: string, onProgress?: IndexProgressCallback): Promise<void> {
    const db = getDatabase()
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()

    if (!doc || !doc.content) {
      throw new Error(`Document ${documentId} not found or has no content`)
    }

    // 기존 chunks와 embeddings 삭제
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

    // 상태 업데이트
    db.update(documents)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(documents.id, documentId))
      .run()

    // 재인덱싱 (addDocument 로직의 핵심 부분 재사용)
    // 구현 간소화를 위해 내부 처리를 직접 호출
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
   * 지식 베이스 통계 정보 조회
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
