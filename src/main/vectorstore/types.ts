/**
 * VectorStore 추상 인터페이스
 * SQLite / LanceDB / Qdrant 등 백엔드 지원
 */

/**
 * 벡터 항목
 */
export interface VectorItem {
  id: string // embedding_id
  chunkId: string
  vector: Float32Array
  metadata?: Record<string, unknown>
}

/**
 * 쿼리 결과
 */
export interface QueryResult {
  id: string // embedding_id
  chunkId: string
  score: number // 유사도 점수 (0-1, 높을수록 유사)
  distance: number // 원본 거리값
  metadata?: Record<string, unknown>
}

/**
 * 쿼리 옵션
 */
export interface QueryOptions {
  topK?: number // 상위 K개 결과 반환, 기본값 5
  threshold?: number // 유사도 임계값 (0-1), 이 값보다 낮은 결과는 반환하지 않음
  filter?: {
    chunkIds?: string[] // 지정된 chunk에서만 검색 제한
  }
}

/**
 * VectorStore 설정
 */
export interface VectorStoreConfig {
  notebookId: string
  dimensions?: number // 벡터 차원, 기본값 1536
}

/**
 * 벡터 스토어 추상 인터페이스
 * 비즈니스 레이어는 이 인터페이스를 통해 벡터 스토어를 조작하며 하위 구현에 의존하지 않음
 */
export interface VectorStore {
  /**
   * 벡터 스토어 초기화
   */
  initialize(config: VectorStoreConfig): Promise<void>

  /**
   * 벡터 일괄 삽입 또는 업데이트
   */
  upsert(items: VectorItem[]): Promise<void>

  /**
   * 벡터 일괄 삭제
   */
  delete(ids: string[]): Promise<void>

  /**
   * chunk ID로 벡터 일괄 삭제
   */
  deleteByChunkIds(chunkIds: string[]): Promise<void>

  /**
   * 벡터 유사도 쿼리
   * @param vector 쿼리 벡터
   * @param options 쿼리 옵션
   * @returns 유사도 정렬된 결과 목록
   */
  query(vector: Float32Array, options?: QueryOptions): Promise<QueryResult[]>

  /**
   * 현재 notebook의 모든 벡터 비우기
   */
  clear(): Promise<void>

  /**
   * 벡터 수량 조회
   */
  count(): Promise<number>

  /**
   * 연결 닫기/리소스 해제
   */
  close(): Promise<void>

  /**
   * 현재 notebook ID 조회
   */
  getNotebookId(): string

  /**
   * 벡터 차원 조회
   */
  getDimensions(): number
}

/**
 * 벡터 스토어 타입
 */
export type VectorStoreType = 'sqlite' | 'lancedb' | 'qdrant'
