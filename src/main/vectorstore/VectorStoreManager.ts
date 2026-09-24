/**
 * VectorStoreManager
 * 管理不同 notebook 的 VectorStore 实例
 */

import type { VectorStore, VectorStoreType } from './types'
import { SQLiteVectorStore } from './SQLiteVectorStore'
import Logger from '../../shared/utils/logger'

/**
 * 向量存储管理器
 * 为每个 notebook 维护独立的 VectorStore 实例
 */
export class VectorStoreManager {
  private stores: Map<string, VectorStore> = new Map()
  private defaultType: VectorStoreType = 'sqlite'

  /**
   * 获取或创建 notebook 的 VectorStore
   * @param notebookId 笔记本 ID
   * @param type 存储类型（可选，默认 sqlite）
   * @param dimensions 向量维度；只有索引链路知道真实维度时才传。不传时由 store 从
   *                   已存的向量表元数据读取，不能拿默认值去建表/删表。
   */
  async getStore(
    notebookId: string,
    type?: VectorStoreType,
    dimensions?: number
  ): Promise<VectorStore> {
    const storeType = type || this.defaultType
    const key = `${notebookId}_${storeType}`

    const existingStore = this.stores.get(key)
    if (
      existingStore &&
      (dimensions === undefined || existingStore.getDimensions() === dimensions)
    ) {
      return existingStore
    }

    if (existingStore) {
      // 维度变了,缓存的 store 指向旧的表,换一个
      Logger.warn(
        'VectorStoreManager',
        `Dimension change for ${key}: existing=${existingStore.getDimensions()}, new=${dimensions}. Recreating store.`
      )
      await existingStore.close()
      this.stores.delete(key)
    }

    // 创建新的 VectorStore
    const store = this.createStore(storeType)
    await store.initialize({
      notebookId,
      dimensions
    })

    this.stores.set(key, store)
    Logger.info(
      'VectorStoreManager',
      `Created ${storeType} store for notebook: ${notebookId} (dimensions: ${store.getDimensions() ?? 'unknown'})`
    )

    return store
  }

  /**
   * 创建 VectorStore 实例
   */
  private createStore(type: VectorStoreType): VectorStore {
    switch (type) {
      case 'sqlite':
        return new SQLiteVectorStore()
      case 'lancedb':
        // TODO: 实现 LanceDBVectorStore
        throw new Error('LanceDB vector store not implemented yet')
      case 'qdrant':
        // TODO: 实现 QdrantVectorStore
        throw new Error('Qdrant vector store not implemented yet')
      default:
        throw new Error(`Unknown vector store type: ${type}`)
    }
  }

  /**
   * 关闭指定 notebook 的存储
   */
  async closeStore(notebookId: string): Promise<void> {
    const keysToDelete: string[] = []

    for (const [key, store] of this.stores) {
      if (key.startsWith(notebookId)) {
        await store.close()
        keysToDelete.push(key)
        Logger.debug('VectorStoreManager', `Closed store: ${key}`)
      }
    }

    keysToDelete.forEach((key) => this.stores.delete(key))
  }

  /**
   * 关闭所有存储
   */
  async closeAll(): Promise<void> {
    for (const [key, store] of this.stores) {
      await store.close()
      Logger.debug('VectorStoreManager', `Closed store: ${key}`)
    }
    this.stores.clear()
    Logger.info('VectorStoreManager', 'All stores closed')
  }

  /**
   * 设置默认存储类型
   */
  setDefaultType(type: VectorStoreType): void {
    this.defaultType = type
  }

  /**
   * 获取已打开的存储数量
   */
  getStoreCount(): number {
    return this.stores.size
  }
}

// 导出单例实例
export const vectorStoreManager = new VectorStoreManager()
