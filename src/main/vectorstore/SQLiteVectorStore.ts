/**
 * SQLiteVectorStore
 * 基于 sqlite-vec 扩展的向量存储实现
 */

import { getSqlite, createNotebookVectorTable, getNotebookVectorTable } from '../db'
import type { NotebookVectorTable } from '../db'
import type { VectorStore, VectorItem, QueryResult, QueryOptions, VectorStoreConfig } from './types'
import {
  upsertVectorsSql,
  deleteVectorsByEmbeddingIdsSql,
  deleteVectorsByChunkIdsSql,
  knnQuerySql,
  clearVectorsSql,
  countVectorsSql
} from './vectorTableSql'
import Logger from '../../shared/utils/logger'

/**
 * SQLite 向量存储实现
 * 使用 sqlite-vec 的 vec0 虚拟表进行高性能向量检索
 *
 * 每个 notebook 一张向量表,宽度(维度)在创建时固定并记录在 vec_metadata 里。
 * 表只由索引链路(知道真实维度)创建,其它路径读到什么就用什么。
 */
export class SQLiteVectorStore implements VectorStore {
  private notebookId: string = ''
  private table: NotebookVectorTable | null = null
  private initialized: boolean = false

  async initialize(config: VectorStoreConfig): Promise<void> {
    this.notebookId = config.notebookId

    // 传了维度 = 索引链路刚量到真实维度;没传 = 以 vec_metadata 为准。没有向量表时
    // 不建表也不报错:新笔记本还没索引过,查询和计数按空处理。
    this.table = config.dimensions
      ? createNotebookVectorTable(config.notebookId, config.dimensions)
      : (getNotebookVectorTable(config.notebookId) ?? null)

    this.initialized = true
    Logger.info(
      'SQLiteVectorStore',
      this.table
        ? `Initialized for notebook: ${this.notebookId}, table: ${this.table.tableName}, dimensions: ${this.table.dimensions}`
        : `Initialized for notebook: ${this.notebookId} (no vectors indexed yet)`
    )
  }

  async upsert(items: VectorItem[]): Promise<void> {
    const table = this.requireTable()

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    const insertStmt = sqlite.prepare(upsertVectorsSql(table.tableName))

    const insertMany = sqlite.transaction((items: VectorItem[]) => {
      for (const item of items) {
        // 宽度不符还插进去,sqlite-vec 只会报一句难懂的错,这里直接说清楚
        if (item.vector.length !== table.dimensions) {
          throw new Error(
            `Vector dimension mismatch: ${table.tableName} holds ${table.dimensions}-dimensional vectors, got ${item.vector.length}`
          )
        }

        // sqlite-vec 可以直接接受 Float32Array
        insertStmt.run(item.id, item.chunkId, item.vector)
      }
    })

    try {
      insertMany(items)
      Logger.debug('SQLiteVectorStore', `Upserted ${items.length} vectors into ${table.tableName}`)
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to upsert vectors:', error)
      throw error
    }
  }

  async delete(ids: string[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    if (ids.length === 0 || !this.table) return

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    const deleteStmt = sqlite.prepare(
      deleteVectorsByEmbeddingIdsSql(this.table.tableName, ids.length)
    )

    try {
      deleteStmt.run(...ids)
      Logger.debug(
        'SQLiteVectorStore',
        `Deleted ${ids.length} vectors from ${this.table.tableName}`
      )
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to delete vectors:', error)
      throw error
    }
  }

  async deleteByChunkIds(chunkIds: string[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    if (chunkIds.length === 0 || !this.table) return

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    const deleteStmt = sqlite.prepare(
      deleteVectorsByChunkIdsSql(this.table.tableName, chunkIds.length)
    )

    try {
      deleteStmt.run(...chunkIds)
      Logger.debug(
        'SQLiteVectorStore',
        `Deleted vectors for ${chunkIds.length} chunks from ${this.table.tableName}`
      )
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to delete vectors by chunk IDs:', error)
      throw error
    }
  }

  async query(queryVector: Float32Array, options: QueryOptions = {}): Promise<QueryResult[]> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    // 还没索引过的笔记本没有向量表,没有结果可言
    if (!this.table) return []

    const { topK = 5, threshold } = options

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    try {
      // 使用 sqlite-vec 的 KNN 查询
      // cosine 距离：0 表示完全相同，2 表示完全相反
      // 转换为相似度分数：1 - (distance / 2)
      const queryStmt = sqlite.prepare(knnQuerySql(this.table.tableName))

      // sqlite-vec 可以直接接受 Float32Array
      const results = queryStmt.all(queryVector, topK) as Array<{
        embedding_id: string
        chunk_id: string
        distance: number
      }>

      // 转换结果
      const queryResults: QueryResult[] = results.map((row) => {
        // cosine 距离转相似度（0-1）
        const score = 1 - row.distance / 2

        return {
          id: row.embedding_id,
          chunkId: row.chunk_id,
          score,
          distance: row.distance
        }
      })

      // 应用阈值过滤
      const filteredResults = threshold
        ? queryResults.filter((r) => r.score >= threshold)
        : queryResults

      Logger.debug(
        'SQLiteVectorStore',
        `Query returned ${filteredResults.length} results from ${this.table.tableName} (threshold: ${threshold})`
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

    if (!this.table) return

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    try {
      sqlite.prepare(clearVectorsSql(this.table.tableName)).run()

      Logger.info('SQLiteVectorStore', `Cleared all vectors from ${this.table.tableName}`)
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to clear vectors:', error)
      throw error
    }
  }

  async count(): Promise<number> {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }

    if (!this.table) return 0

    const sqlite = getSqlite()
    if (!sqlite) {
      throw new Error('SQLite instance not available')
    }

    try {
      const result = sqlite.prepare(countVectorsSql(this.table.tableName)).get() as {
        count: number
      }

      return result?.count || 0
    } catch (error) {
      Logger.error('SQLiteVectorStore', 'Failed to count vectors:', error)
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

  getDimensions(): number | null {
    return this.table?.dimensions ?? null
  }

  /**
   * 写向量必须有表,而表由索引链路带着真实维度创建 —— 走到这里说明调用顺序错了,
   * 直接报错比静默丢向量强。
   */
  private requireTable(): NotebookVectorTable {
    if (!this.initialized) {
      throw new Error('VectorStore not initialized')
    }
    if (!this.table) {
      throw new Error(
        `Notebook ${this.notebookId} has no vector table; it must be created while indexing with the embedding dimensions`
      )
    }
    return this.table
  }
}
