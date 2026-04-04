/**
 * EmbeddingCapability 인터페이스
 * 정의임베딩 기능
 */

/**
 * Embedding 설정
 */
export interface EmbeddingConfig {
  model?: string // embedding 모델이름
  dimensions?: number // 벡터 차원(부분분모델지원)
}

/**
 * Embedding 결과
 */
export interface EmbeddingResult {
  embedding: Float32Array // 벡터데이터
  model: string // 사용의모델
  dimensions: number // 벡터 차원
  tokensUsed: number // 취소소모의 token 수
}

/**
 * EmbeddingCapability 임베딩 기능인터페이스
 * 현재이인터페이스의 Provider 지원임베딩벡터생성공
 */
export interface EmbeddingCapability {
  /**
   * 생성단일개텍스트의 Embedding
   * @param text - 입력텍스트
   * @param config - Embedding 설정
   * @returns Promise<EmbeddingResult> - Embedding 결과
   */
  createEmbedding(text: string, config?: EmbeddingConfig): Promise<EmbeddingResult>

  /**
   * 일괄생성 Embedding
   * @param texts - 입력텍스트배열
   * @param config - Embedding 설정
   * @returns Promise<EmbeddingResult[]> - Embedding 결과배열
   */
  createEmbeddings(texts: string[], config?: EmbeddingConfig): Promise<EmbeddingResult[]>

  /**
   * 조회기본 Embedding 모델
   * @returns 기본 Embedding 모델이름
   */
  getDefaultEmbeddingModel(): string
}
