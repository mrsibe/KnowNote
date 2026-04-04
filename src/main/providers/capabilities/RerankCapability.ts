/**
 * RerankCapability 인터페이스
 * 정의재정렬기능(향후확장)
 */

/**
 * Rerank 설정
 */
export interface RerankConfig {
  model?: string // rerank 모델이름
  topN?: number // 반환전 N 개결과
}

/**
 * Rerank 문서
 */
export interface RerankDocument {
  id: string // 문서 ID
  text: string // 문서텍스트
  metadata?: Record<string, any> // 문서메타데이터
}

/**
 * Rerank 결과
 */
export interface RerankResult {
  documentId: string // 문서 ID
  score: number // 관련성분수
  index: number // 원본인덱스
}

/**
 * RerankCapability 재정렬기능 인터페이스
 * 현재이인터페이스의 Provider 지원재정렬공
 *
 * @remarks
 * 이인터페이스향후확장미리유지,임시미현재
 */
export interface RerankCapability {
  /**
   * 재정렬문서
   * @param query - 쿼리텍스트
   * @param documents - 문서목록
   * @param config - Rerank 설정
   * @returns Promise<RerankResult[]> - 정렬후의결과
   */
  rerank(query: string, documents: RerankDocument[], config?: RerankConfig): Promise<RerankResult[]>

  /**
   * 조회기본 Rerank 모델
   * @returns 기본 Rerank 모델이름
   */
  getDefaultRerankModel(): string
}
