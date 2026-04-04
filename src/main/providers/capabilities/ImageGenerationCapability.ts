/**
 * ImageGenerationCapability 인터페이스
 * 정의이미지 생성 기능(향후확장)
 */

/**
 * 이미지생성설정
 */
export interface ImageGenerationConfig {
  model?: string // 이미지생성모델이름
  size?: string // 이미지크기치수,만약 '1024x1024'
  quality?: 'standard' | 'hd' // 이미지품질양
  style?: 'vivid' | 'natural' // 이미지스타일격
  n?: number // 생성이미지수량
}

/**
 * 이미지생성 결과
 */
export interface ImageGenerationResult {
  url?: string // 이미지 URL(만약예 URL ���턴)
  b64Json?: string // Base64 인코딩의이미지(만약예 base64 ���턴)
  revisedPrompt?: string // 수정구독후의힌트
}

/**
 * ImageGenerationCapability 이미지 생성 기능인터페이스
 * 현재이인터페이스의 Provider 지원이미지생성공
 *
 * @remarks
 * 이인터페이스향후확장미리유지,임시미현재
 */
export interface ImageGenerationCapability {
  /**
   * 생성이미지
   * @param prompt - 이미지생성힌트
   * @param config - 이미지생성설정
   * @returns Promise<ImageGenerationResult[]> - 생성의이미지결과
   */
  generateImage(prompt: string, config?: ImageGenerationConfig): Promise<ImageGenerationResult[]>

  /**
   * 조회기본이미지생성모델
   * @returns 기본이미지생성모델이름
   */
  getDefaultImageModel(): string
}
