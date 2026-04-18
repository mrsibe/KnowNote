import { getSqlite } from '../db'
import { vectorStoreManager } from '../vectorstore'
import { EmbeddingService } from './EmbeddingService'
import Logger from '../../shared/utils/logger'

export type SearchMode = 'semantic' | 'keyword' | 'hybrid'

export interface HybridSearchOptions {
  topK?: number
  threshold?: number
  searchMode?: SearchMode
}

export interface HybridSearchResult {
  chunkId: string
}

export class HybridSearchService {
  private embeddingService: EmbeddingService

  constructor(embeddingService: EmbeddingService) {
    this.embeddingService = embeddingService
  }

  /**
   * 하이브리드 검색 → chunkId 목록 반환 (결과 조립은 KnowledgeService에서)
   */
  async search(
    notebookId: string,
    query: string,
    options: HybridSearchOptions = {}
  ): Promise<HybridSearchResult[]> {
    const { topK = 20, threshold = 0.3, searchMode = 'hybrid' } = options

    let ftsResults: { chunkId: string; rank: number }[] = []
    let vectorResults: { chunkId: string; score: number; rank: number }[] = []

    if (searchMode === 'keyword' || searchMode === 'hybrid') {
      ftsResults = this.ftsSearch(notebookId, query, topK)
      Logger.debug('HybridSearch', `FTS5 returned ${ftsResults.length} results`)
    }

    if (searchMode === 'semantic' || searchMode === 'hybrid') {
      try {
        const queryEmbedding = await this.embeddingService.embed(query)
        const vectorStore = await vectorStoreManager.getStore(notebookId)
        const rawResults = await vectorStore.query(queryEmbedding.embedding, {
          topK,
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

    let rankedChunkIds: string[]
    if (searchMode === 'hybrid' && ftsResults.length > 0 && vectorResults.length > 0) {
      rankedChunkIds = this.rrfFusion(ftsResults, vectorResults, topK)
    } else if (vectorResults.length > 0) {
      rankedChunkIds = vectorResults.slice(0, topK).map((r) => r.chunkId)
    } else {
      rankedChunkIds = ftsResults.slice(0, topK).map((r) => r.chunkId)
    }

    return rankedChunkIds.map((chunkId) => ({ chunkId }))
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
}
