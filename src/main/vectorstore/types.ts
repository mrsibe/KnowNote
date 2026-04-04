/**
 * VectorStore 추출객체인터페이스
 * 지원 SQLite / LanceDB / Qdrant 등후엔드
 */

/**
 * 벡터항목
 */
export interface VectorItem {
  id: string // embedding_id
  chunkId: string
  vector: Float32Array
  metadata?: Record<string, unknown>
}

/**
 * 쿼리결과
 */
export interface QueryResult {
  id: string // embedding_id
  chunkId: string
  score: number // 유사도분수（0-1，넘는높은넘는상유사）
  distance: number // 원본거리값
  metadata?: Record<string, unknown>
}

/**
 * 쿼리선택지
 */
export interface QueryOptions {
  topK?: number // 반환전 K 개결과，기본 5
  threshold?: number // 유사도임계값（0-1），낮은이값의결과아닌반환
  filter?: {
    chunkIds?: string[] // 제한제가리키는정 chunk 에서검색
  }
}

/**
 * VectorStore 설정
 */
export interface VectorStoreConfig {
  notebookId: string
  dimensions?: number // 벡터 차원，기본 1536
}

/**
 * 벡터 저장소추출객체인터페이스
 * 업무레이어통해이인터페이스작업벡터 저장소，아닌닫기마음바닥레이어현재
 */
export interface VectorStore {
  /**
   * 초기화벡터 저장소
   */
  initialize(config: VectorStoreConfig): Promise<void>

  /**
   * 일괄삽입또는업데이트벡터
   */
  upsert(items: VectorItem[]): Promise<void>

  /**
   * 일괄삭제벡터
   */
  delete(ids: string[]): Promise<void>

  /**
   * 에 따라 chunk ID 일괄삭제벡터
   */
  deleteByChunkIds(chunkIds: string[]): Promise<void>

  /**
   * 벡터유사도쿼리
   * @param vector 쿼리벡터
   * @param options 쿼리선택지
   * @returns 유사도정렬의결과목록
   */
  query(vector: Float32Array, options?: QueryOptions): Promise<QueryResult[]>

  /**
   * 비우기현재 notebook 의모든벡터
   */
  clear(): Promise<void>

  /**
   * 조회벡터수량
   */
  count(): Promise<number>

  /**
   * 닫기연결/해제방리소스
   */
  close(): Promise<void>

  /**
   * 현재 조회 notebook ID
   */
  getNotebookId(): string

  /**
   * 조회벡터 차원
   */
  getDimensions(): number
}

/**
 * 벡터 저장소타입
 */
export type VectorStoreType = 'sqlite' | 'lancedb' | 'qdrant'
