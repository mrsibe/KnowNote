/**
 * VectorStore 抽象接口
 * 支持 SQLite / LanceDB / Qdrant 等后端
 */

/**
 * 向量项
 */
export interface VectorItem {
  id: string // embedding_id
  chunkId: string
  vector: Float32Array
  metadata?: Record<string, unknown>
}

/**
 * 查询结果
 */
export interface QueryResult {
  id: string // embedding_id
  chunkId: string
  score: number // 相似度分数（0-1，越高越相似）
  distance: number // 原始距离值
  metadata?: Record<string, unknown>
}

/**
 * 查询选项
 */
export interface QueryOptions {
  topK?: number // 返回前 K 个结果，默认 5
  threshold?: number // 相似度阈值（0-1），低于此值的结果不返回
}

// 这里曾经声明过 `filter?: { chunkIds?: string[] }`，但 `SQLiteVectorStore.query()`
// 从未读取它，`knnQuerySql()` 也没有对应的 WHERE —— 一个声明了却不生效的能力，比
// 没有这个能力更糟。真正需要按来源预过滤的是 #94，而它要求过滤发生在 KNN 之前，
// 且向量表要能按 document id 过滤；那属于 #94 的实现，不属于这个接口。

/**
 * VectorStore 配置
 */
export interface VectorStoreConfig {
  notebookId: string
  /**
   * 向量维度。只有刚从 embedding 模型量到真实维度、准备建表的索引链路才传它 ——
   * 不传时维度以已存的表为准,以免拿一个猜的值去建表或删表。
   */
  dimensions?: number
}

/**
 * 向量存储抽象接口
 * 业务层通过此接口操作向量存储，不关心底层实现
 */
export interface VectorStore {
  /**
   * 初始化向量存储
   */
  initialize(config: VectorStoreConfig): Promise<void>

  /**
   * 批量插入或更新向量
   */
  upsert(items: VectorItem[]): Promise<void>

  /**
   * 批量删除向量
   */
  delete(ids: string[]): Promise<void>

  /**
   * 按 chunk ID 批量删除向量
   */
  deleteByChunkIds(chunkIds: string[]): Promise<void>

  /**
   * 向量相似度查询
   * @param vector 查询向量
   * @param options 查询选项
   * @returns 相似度排序的结果列表
   */
  query(vector: Float32Array, options?: QueryOptions): Promise<QueryResult[]>

  /**
   * 清空当前 notebook 的所有向量
   */
  clear(): Promise<void>

  /**
   * 获取向量数量
   */
  count(): Promise<number>

  /**
   * 关闭连接/释放资源
   */
  close(): Promise<void>

  /**
   * 获取当前 notebook ID
   */
  getNotebookId(): string

  /**
   * 获取向量维度;该 notebook 还没有向量表时为 null
   */
  getDimensions(): number | null
}

/**
 * 向量存储类型
 */
export type VectorStoreType = 'sqlite' | 'lancedb' | 'qdrant'
