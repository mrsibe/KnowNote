/**
 * VectorStoreManager
 * 관리다른 notebook 의 VectorStore 인스턴스
 */

import type { VectorStore, VectorStoreType } from './types'
import { SQLiteVectorStore } from './SQLiteVectorStore'
import Logger from '../../shared/utils/logger'

/**
 * 벡터 저장소 관리자
 * 매개 notebook 차원보호독립즉시의 VectorStore 인스턴스
 */
export class VectorStoreManager {
  private stores: Map<string, VectorStore> = new Map()
  private defaultType: VectorStoreType = 'sqlite'
  private defaultDimensions: number = 1024

  /**
   * 조회또는생성 notebook 의 VectorStore
   * @param notebookId 노트북 ID
   * @param type 저장타입（선택，기본 sqlite）
   * @param dimensions 벡터 차원（선택，만약제공덮어쓰기기본값）
   */
  async getStore(
    notebookId: string,
    type?: VectorStoreType,
    dimensions?: number
  ): Promise<VectorStore> {
    const storeType = type || this.defaultType
    const key = `${notebookId}_${storeType}`
    const targetDimensions = dimensions || this.defaultDimensions

    // 확인예아니오이미 존재함또한차원매칭
    const existingStore = this.stores.get(key)
    if (existingStore) {
      const existingDimensions = existingStore.getDimensions()
      if (existingDimensions === targetDimensions) {
        return existingStore
      } else {
        // 차원아닌매칭，필요재새생성
        Logger.warn(
          'VectorStoreManager',
          `Dimension mismatch for ${key}: existing=${existingDimensions}, new=${targetDimensions}. Recreating store.`
        )
        await existingStore.close()
        this.stores.delete(key)
      }
    }

    // 생성새의 VectorStore
    const store = this.createStore(storeType)
    await store.initialize({
      notebookId,
      dimensions: targetDimensions
    })

    this.stores.set(key, store)
    Logger.info(
      'VectorStoreManager',
      `Created ${storeType} store for notebook: ${notebookId} with dimensions: ${targetDimensions}`
    )

    return store
  }

  /**
   * 생성 VectorStore 인스턴스
   */
  private createStore(type: VectorStoreType): VectorStore {
    switch (type) {
      case 'sqlite':
        return new SQLiteVectorStore()
      case 'lancedb':
        // TODO: 현재 LanceDBVectorStore
        throw new Error('LanceDB vector store not implemented yet')
      case 'qdrant':
        // TODO: 현재 QdrantVectorStore
        throw new Error('Qdrant vector store not implemented yet')
      default:
        throw new Error(`Unknown vector store type: ${type}`)
    }
  }

  /**
   * 닫기가리키는정 notebook 의저장
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
   * 닫기모든저장
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
   * 설정기본벡터 차원
   */
  setDefaultDimensions(dimensions: number): void {
    this.defaultDimensions = dimensions
  }

  /**
   * 조회기본벡터 차원
   */
  getDefaultDimensions(): number {
    return this.defaultDimensions
  }

  /**
   * 설정기본저장타입
   */
  setDefaultType(type: VectorStoreType): void {
    this.defaultType = type
  }

  /**
   * 조회열기의저장수량
   */
  getStoreCount(): number {
    return this.stores.size
  }
}

// 내보내기단일예인스턴스
export const vectorStoreManager = new VectorStoreManager()
