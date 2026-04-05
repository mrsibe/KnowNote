/**
 * SQLiteVectorStore
 * sqlite-vec 확장 기반의 벡터 스토어 구현
 */

import { getSqlite } from '../db'
import type { VectorStore, VectorItem, QueryResult, QueryOptions, VectorStoreConfig } from './types'
import { float32ToInt8 } from './quantize'
import Logger from '../../shared/utils/logger'

/**
 * SQLite 벡터 스토어 구현
 * sqlite-vec의 vec0 가상 테이블을 사용한 고성능 벡터 검색
 */
export class SQLiteVectorStore implements VectorStore {
  private notebookId: string = ''
  private dimensions: number = 1024
  private initialized: boolean = false

  async initialize(config: VectorStoreConfig): Promise<void> {
    this.notebookId = config.notebookId
    this.dimensions = config.dimensions || 1024
    this.initialized = true
    Logger.info('SQLiteVectorStore', `Initialized for notebook: ${this.notebookId}`)
  }

  async upsert(items: VectorItem[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    const insertStmt = sqlite.prepare(`
      INSERT OR REPLACE INTO vec_embeddings (embedding_id, chunk_id, notebook_id, embedding)
      VALUES (?, ?, ?, ?)
    `)

    const insertMany = sqlite.transaction((items: VectorItem[]) => {
      for (const item of items) {
        // 벡터 차원 검증
        if (item.vector.length !== this.dimensions) {
          Logger.warn(
            'SQLiteVectorStore',
            `Vector dimension mismatch: expected ${this.dimensions}, got ${item.vector.length}`
          )
        }

        // sqlite-vec는 Float32Array를 직접 받음
        insertStmt.run(item.id, item.chunkId, this.notebookId, item.vector)
      }
    })

    try {
      insertMany(items)
      Logger.debug('SQLiteVectorStore', `Upserted ${items.length} vectors`)
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to upsert vectors:', error)
      throw error
    }

    // Also insert INT8 quantized vectors for fast search
    try {
      const int8Stmt = sqlite.prepare(
        `INSERT OR REPLACE INTO vec_embeddings_int8(embedding_id, chunk_id, notebook_id, embedding) VALUES (?, ?, ?, ?)`
      )
      for (const item of items) {
        const int8Vector = float32ToInt8(item.vector)
        int8Stmt.run(item.id, item.chunkId, this.notebookId, int8Vector)
      }
    } catch (error) {
      Logger.warn('SQLiteVectorStore', 'INT8 table insert failed (non-critical):', error)
    }
  }

  async delete(ids: string[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    if (ids.length === 0) return

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    const placeholders = ids.map(() => '?').join(',')
    const deleteStmt = sqlite.prepare(`
      DELETE FROM vec_embeddings WHERE embedding_id IN (${placeholders})
    `)

    try {
      deleteStmt.run(...ids)
      Logger.debug('SQLiteVectorStore', `Deleted ${ids.length} vectors`)
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to delete vectors:', error)
      throw error
    }

    // Also delete from INT8 table
    try {
      const deleteInt8Stmt = sqlite.prepare(
        `DELETE FROM vec_embeddings_int8 WHERE embedding_id IN (${placeholders})`
      )
      deleteInt8Stmt.run(...ids)
    } catch (error) {
      Logger.warn('SQLiteVectorStore', 'INT8 table delete failed (non-critical):', error)
    }
  }

  async deleteByChunkIds(chunkIds: string[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    if (chunkIds.length === 0) return

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    const placeholders = chunkIds.map(() => '?').join(',')
    const deleteStmt = sqlite.prepare(`
      DELETE FROM vec_embeddings WHERE chunk_id IN (${placeholders})
    `)

    try {
      deleteStmt.run(...chunkIds)
      Logger.debug('SQLiteVectorStore', `Deleted vectors for ${chunkIds.length} chunks`)
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to delete vectors by chunk IDs:', error)
      throw error
    }

    // Also delete from INT8 table
    try {
      const deleteInt8Stmt = sqlite.prepare(
        `DELETE FROM vec_embeddings_int8 WHERE chunk_id IN (${placeholders})`
      )
      deleteInt8Stmt.run(...chunkIds)
    } catch (error) {
      Logger.warn(
        'SQLiteVectorStore',
        'INT8 table delete by chunk IDs failed (non-critical):',
        error
      )
    }
  }

  async query(queryVector: Float32Array, options: QueryOptions = {}): Promise<QueryResult[]> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    const { topK = 5, threshold } = options

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    // Try INT8 dual-table search first: fast candidate retrieval with INT8, then rescore with float32
    try {
      const candidates = this.queryInt8Candidates(sqlite, queryVector, topK)
      if (candidates && candidates.length > 0) {
        // Rescore candidates using float32 vectors
        const rescored = this.rescoreWithFloat32(sqlite, queryVector, candidates)

        // Sort by score descending and take topK
        rescored.sort((a, b) => b.score - a.score)
        const topResults = rescored.slice(0, topK)

        // Apply threshold filtering
        const filteredResults = threshold
          ? topResults.filter((r) => r.score >= threshold)
          : topResults

        Logger.debug(
          'SQLiteVectorStore',
          `INT8 dual-table query returned ${filteredResults.length} results (threshold: ${threshold})`
        )

        return filteredResults
      }
    } catch (error) {
      Logger.warn('SQLiteVectorStore', 'INT8 query failed, falling back to float32:', error)
    }

    // Fallback: direct float32 query
    return this.queryFloat32(sqlite, queryVector, topK, threshold)
  }

  /**
   * INT8 테이블에서 빠른 후보 검색 (over-retrieval)
   */
  private queryInt8Candidates(
    sqlite: ReturnType<typeof getSqlite>,
    queryVector: Float32Array,
    topK: number
  ): Array<{ embedding_id: string; chunk_id: string }> | null {
    if (!sqlite) return null

    // Over-retrieve 3x candidates from INT8 for better recall after rescoring
    const overRetrievalK = Math.min(topK * 3, 100)
    const int8QueryVector = float32ToInt8(queryVector)

    const int8Stmt = sqlite.prepare(`
      SELECT
        embedding_id,
        chunk_id
      FROM vec_embeddings_int8
      WHERE embedding MATCH ?
        AND k = ?
        AND notebook_id = ?
      ORDER BY distance ASC
    `)

    const candidates = int8Stmt.all(int8QueryVector, overRetrievalK, this.notebookId) as Array<{
      embedding_id: string
      chunk_id: string
    }>

    return candidates
  }

  /**
   * Float32 벡터로 후보 리스코어링
   */
  private rescoreWithFloat32(
    sqlite: ReturnType<typeof getSqlite>,
    queryVector: Float32Array,
    candidates: Array<{ embedding_id: string; chunk_id: string }>
  ): QueryResult[] {
    if (!sqlite || candidates.length === 0) return []

    const placeholders = candidates.map(() => '?').join(',')
    const rescoreStmt = sqlite.prepare(`
      SELECT
        embedding_id,
        chunk_id,
        distance
      FROM vec_embeddings
      WHERE embedding MATCH ?
        AND k = ?
        AND notebook_id = ?
        AND embedding_id IN (${placeholders})
    `)

    const candidateIds = candidates.map((c) => c.embedding_id)
    const results = rescoreStmt.all(
      queryVector,
      candidates.length,
      this.notebookId,
      ...candidateIds
    ) as Array<{
      embedding_id: string
      chunk_id: string
      distance: number
    }>

    return results.map((row) => ({
      id: row.embedding_id,
      chunkId: row.chunk_id,
      score: 1 - row.distance / 2,
      distance: row.distance
    }))
  }

  /**
   * Float32 직접 쿼리 (폴백)
   */
  private async queryFloat32(
    sqlite: ReturnType<typeof getSqlite>,
    queryVector: Float32Array,
    topK: number,
    threshold?: number
  ): Promise<QueryResult[]> {
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    try {
      // sqlite-vec의 KNN 쿼리 사용
      // cosine 거리: 0은 완전 동일, 2는 완전 반대
      // 유사도 점수로 변환: 1 - (distance / 2)
      const queryStmt = sqlite.prepare(`
        SELECT
          embedding_id,
          chunk_id,
          distance
        FROM vec_embeddings
        WHERE embedding MATCH ?
          AND k = ?
          AND notebook_id = ?
        ORDER BY distance ASC
      `)

      // sqlite-vec는 Float32Array를 직접 받음
      const results = queryStmt.all(queryVector, topK, this.notebookId) as Array<{
        embedding_id: string
        chunk_id: string
        distance: number
      }>

      // 결과 변환
      const queryResults: QueryResult[] = results.map((row) => {
        // cosine 거리를 유사도로 변환 (0-1)
        const score = 1 - row.distance / 2

        return {
          id: row.embedding_id,
          chunkId: row.chunk_id,
          score,
          distance: row.distance
        }
      })

      // 임계값 필터링 적용
      const filteredResults = threshold
        ? queryResults.filter((r) => r.score >= threshold)
        : queryResults

      Logger.debug(
        'SQLiteVectorStore',
        `Query returned ${filteredResults.length} results (threshold: ${threshold})`
      )

      return filteredResults
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to query vectors:', error)
      throw error
    }
  }

  async clear(): Promise<void> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    try {
      const deleteStmt = sqlite.prepare(`
        DELETE FROM vec_embeddings WHERE notebook_id = ?
      `)
      deleteStmt.run(this.notebookId)

      Logger.info('SQLiteVectorStore', `Cleared all vectors for notebook: ${this.notebookId}`)
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to clear vectors:', error)
      throw error
    }

    // Also clear INT8 table
    try {
      const deleteInt8Stmt = sqlite.prepare(`
        DELETE FROM vec_embeddings_int8 WHERE notebook_id = ?
      `)
      deleteInt8Stmt.run(this.notebookId)
    } catch (error) {
      Logger.warn('SQLiteVectorStore', 'INT8 table clear failed (non-critical):', error)
    }
  }

  async count(): Promise<number> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    try {
      const countStmt = sqlite.prepare(`
        SELECT COUNT(*) as count FROM vec_embeddings WHERE notebook_id = ?
      `)
      const result = countStmt.get(this.notebookId) as { count: number }

      return result?.count || 0
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to count vectors:', error)
      throw error
    }
  }

  /**
   * 기존 Float32 벡터를 INT8로 마이그레이션
   * Float32 테이블의 모든 벡터를 읽어 INT8로 변환 후 삽입
   */
  async migrateToInt8(): Promise<number> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    try {
      // Float32 테이블에서 모든 벡터 조회
      const selectStmt = sqlite.prepare(`
        SELECT embedding_id, chunk_id, embedding
        FROM vec_embeddings
        WHERE notebook_id = ?
      `)
      const rows = selectStmt.all(this.notebookId) as Array<{
        embedding_id: string
        chunk_id: string
        embedding: Buffer
      }>

      if (rows.length === 0) {
        Logger.info('SQLiteVectorStore', `No vectors to migrate for notebook: ${this.notebookId}`)
        return 0
      }

      // INT8 테이블에 배치 삽입
      const int8Stmt = sqlite.prepare(
        `INSERT OR REPLACE INTO vec_embeddings_int8(embedding_id, chunk_id, notebook_id, embedding) VALUES (?, ?, ?, ?)`
      )

      const insertMany = sqlite.transaction(
        (rows: Array<{ embedding_id: string; chunk_id: string; embedding: Buffer }>) => {
          for (const row of rows) {
            const float32Vector = new Float32Array(
              row.embedding.buffer,
              row.embedding.byteOffset,
              row.embedding.byteLength / 4
            )
            const int8Vector = float32ToInt8(float32Vector)
            int8Stmt.run(row.embedding_id, row.chunk_id, this.notebookId, int8Vector)
          }
        }
      )

      insertMany(rows)
      Logger.info(
        'SQLiteVectorStore',
        `Migrated ${rows.length} vectors to INT8 for notebook: ${this.notebookId}`
      )
      return rows.length
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to migrate vectors to INT8:', error)
      throw error
    }
  }

  async close(): Promise<void> {
    this.initialized = false
    Logger.info('SQLiteVectorStore', `Closed for notebook: ${this.notebookId}`)
  }

  getNotebookId(): string {
    return this.notebookId
  }

  getDimensions(): number {
    return this.dimensions
  }
}
