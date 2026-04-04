/**
 * VectorStoreManager
 * 다른 notebook의 VectorStore 인스턴스 관리
 */

import type { VectorStore, VectorStoreType } from './types'
import { SQLiteVectorStore } from './SQLiteVectorStore'
import Logger from '../../shared/utils/logger'

/**
 * 벡터 스토어 관리자
 * 각 notebook마다 독립적인 VectorStore 인스턴스 유지
 */
export class VectorStoreManager {
  private stores: Map<string, VectorStore> = new Map()
  private defaultType: VectorStoreType = 'sqlite'
  private defaultDimensions: number = 1024

  /**
   * notebook의 VectorStore 조회 또는 생성
   * @param notebookId 노트북 ID
   * @param type 스토어 타입 (선택, 기본값 sqlite)
   * @param dimensions 벡터 차원 (선택, 제공 시 기본값 덮어쓰기)
   */
  async getStore(
    notebookId: string,
    type?: VectorStoreType,
    dimensions?: number
  ): Promise<VectorStore> {
    const storeType = type || this.defaultType
    const key = `${notebookId}_${storeType}`
    const targetDimensions = dimensions || this.defaultDimensions

    // 이미 존재하고 차원이 일치하는지 확인
    const existingStore = this.stores.get(key)
    if (existingStore) {
      const existingDimensions = existingStore.getDimensions()
      if (existingDimensions === targetDimensions) {
        return existingStore
      } else {
        // 차원 불일치, 재생성 필요
        Logger.warn(
          'VectorStoreManager',
          `Dimension mismatch for ${key}: existing=${existingDimensions}, new=${targetDimensions}. Recreating store.`
        )
        await existingStore.close()
        this.stores.delete(key)
      }
    }

    // 새 VectorStore 생성
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
   * VectorStore 인스턴스 생성
   */
  private createStore(type: VectorStoreType): VectorStore {
    switch (type) {
      case 'sqlite':
        return new SQLiteVectorStore()
      case 'lancedb':
        // TODO: LanceDBVectorStore 구현
        throw new Error('LanceDB vector store not implemented yet')
      case 'qdrant':
        // TODO: QdrantVectorStore 구현
        throw new Error('Qdrant vector store not implemented yet')
      default:
        throw new Error(`Unknown vector store type: ${type}`)
    }
  }

  /**
   * 지정된 notebook의 스토어 닫기
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
   * 모든 스토어 닫기
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
   * 기본 벡터 차원 설정
   */
  setDefaultDimensions(dimensions: number): void {
    this.defaultDimensions = dimensions
  }

  /**
   * 기본 벡터 차원 조회
   */
  getDefaultDimensions(): number {
    return this.defaultDimensions
  }

  /**
   * 기본 스토어 타입 설정
   */
  setDefaultType(type: VectorStoreType): void {
    this.defaultType = type
  }

  /**
   * 열린 스토어 수량 조회
   */
  getStoreCount(): number {
    return this.stores.size
  }
}

// 싱글턴 인스턴스 내보내기
export const vectorStoreManager = new VectorStoreManager()
