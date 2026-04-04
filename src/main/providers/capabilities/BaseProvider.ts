/**
 * BaseProvider 인터페이스
 * 모든 Provider 반드시해야현재의기본인터페이스
 */

/**
 * Provider 설정
 */
export interface LLMProviderConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
  [key: string]: any
}

/**
 * BaseProvider 기본인터페이스
 * 정의모든 Provider 반드시해야현재의기본메서드
 */
export interface BaseProvider {
  /**
   * Provider 이름 (유일한하나표인식)
   */
  readonly name: string

  /**
   * 설정 Provider
   * @param config - Provider 설정항목
   */
  configure(config: LLMProviderConfig): void

  /**
   * 검증설정예아니오있는효(선택)
   * @param config - 필요검증의설정
   * @returns Promise<boolean> - 설정예아니오있는효
   */
  validateConfig?(config: LLMProviderConfig): Promise<boolean>
}
