import { getDatabase, getSqlite } from '../db'
import { chunks, documents } from '../db/schema'
import { inArray } from 'drizzle-orm'
import { vectorStoreManager } from '../vectorstore'
import { EmbeddingService } from './EmbeddingService'
import Logger from '../../shared/utils/logger'

export type SearchMode = 'semantic' | 'keyword' | 'hybrid'

export interface HybridSearchOptions {
  topK?: number
  threshold?: number
  searchMode?: SearchMode
  includeContent?: boolean
}

export interface HybridSearchResult {
  chunkId: string
  documentId: string
  documentTitle: string
  documentType: string
  content: string
  score: number
  chunkIndex: number
  metadata?: Record<string, unknown>
  source: 'fts' | 'vector' | 'hybrid'
}

export class HybridSearchService {
  private embeddingService: EmbeddingService

  constructor(embeddingService: EmbeddingService) {
    this.embeddingService = embeddingService
  }

  async search(
    notebookId: string,
    query: string,
    options: HybridSearchOptions = {}
  ): Promise<HybridSearchResult[]> {
    const { topK = 5, threshold = 0.3, searchMode = 'hybrid', includeContent = true } = options

    const overRetrievalK = topK * 4 // Over-retrieval: fetch 4x candidates

    let ftsResults: { chunkId: string; rank: number }[] = []
    let vectorResults: { chunkId: string; score: number; rank: number }[] = []

    // FTS5 keyword search
    if (searchMode === 'keyword' || searchMode === 'hybrid') {
      ftsResults = this.ftsSearch(notebookId, query, overRetrievalK)
      Logger.debug('HybridSearch', `FTS5 returned ${ftsResults.length} results`)
    }

    // Vector semantic search
    if (searchMode === 'semantic' || searchMode === 'hybrid') {
      try {
        const queryEmbedding = await this.embeddingService.embed(query)
        const vectorStore = await vectorStoreManager.getStore(notebookId)
        const rawResults = await vectorStore.query(queryEmbedding.embedding, {
          topK: overRetrievalK,
          threshold
        })
        vectorResults = rawResults.map((r, i) => ({
          chunkId: r.chunkId,
          score: r.score,
          rank: i
        }))
        Logger.debug('HybridSearch', `Vector search returned ${vectorResults.length} results`)
      } catch (error) {
        Logger.warn('HybridSearch', 'Vector search failed, falling back to FTS only:', error)
      }
    }

    // Combine results using RRF (Reciprocal Rank Fusion)
    let rankedChunkIds: string[]
    if (searchMode === 'hybrid' && ftsResults.length > 0 && vectorResults.length > 0) {
      rankedChunkIds = this.rrfFusion(ftsResults, vectorResults, topK)
    } else if (vectorResults.length > 0) {
      rankedChunkIds = vectorResults.slice(0, topK).map((r) => r.chunkId)
    } else {
      rankedChunkIds = ftsResults.slice(0, topK).map((r) => r.chunkId)
    }

    if (rankedChunkIds.length === 0) return []

    // Fetch chunk and document details
    return this.assembleResults(
      rankedChunkIds,
      includeContent,
      searchMode === 'hybrid' ? 'hybrid' : searchMode === 'keyword' ? 'fts' : 'vector'
    )
  }

  /**
   * FTS5 full-text search
   */
  private ftsSearch(
    notebookId: string,
    query: string,
    limit: number
  ): { chunkId: string; rank: number }[] {
    const sqlite = getSqlite()
    if (!sqlite) return []

    try {
      // Escape FTS5 special characters
      const escapedQuery = query.replace(/['"*()]/g, ' ').trim()
      if (!escapedQuery) return []

      const stmt = sqlite.prepare(
        `SELECT chunk_id, rank
         FROM chunks_fts
         WHERE chunks_fts MATCH ?
           AND notebook_id = ?
         ORDER BY rank
         LIMIT ?`
      )

      const rows = stmt.all(escapedQuery, notebookId, limit) as any[]

      return rows.map((row: any, i: number) => ({
        chunkId: row.chunk_id,
        rank: i
      }))
    } catch (error) {
      Logger.warn('HybridSearch', 'FTS5 search failed:', error)
      return []
    }
  }

  /**
   * Reciprocal Rank Fusion - combine FTS and vector results
   */
  private rrfFusion(
    ftsResults: { chunkId: string; rank: number }[],
    vectorResults: { chunkId: string; rank: number }[],
    topK: number,
    k: number = 60
  ): string[] {
    const scores = new Map<string, number>()

    for (const r of ftsResults) {
      const current = scores.get(r.chunkId) || 0
      scores.set(r.chunkId, current + 1 / (k + r.rank + 1))
    }

    for (const r of vectorResults) {
      const current = scores.get(r.chunkId) || 0
      scores.set(r.chunkId, current + 1 / (k + r.rank + 1))
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([chunkId]) => chunkId)
  }

  /**
   * Assemble search results with chunk and document details
   */
  private assembleResults(
    chunkIds: string[],
    includeContent: boolean,
    source: 'fts' | 'vector' | 'hybrid'
  ): HybridSearchResult[] {
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

    // Preserve the original ordering from chunkIds
    const results: HybridSearchResult[] = []
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
        score: 1 - i * 0.05, // Approximate score based on rank position
        chunkIndex: chunk.chunkIndex,
        metadata: chunk.metadata
          ? typeof chunk.metadata === 'string'
            ? JSON.parse(chunk.metadata)
            : chunk.metadata
          : undefined,
        source
      })
    }

    return results
  }
}
