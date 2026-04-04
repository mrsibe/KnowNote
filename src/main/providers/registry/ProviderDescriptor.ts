/**
 * Provider Descriptor
 * 제공자설명,용도:설정드라이버동의제공자등록
 */

import type { BaseProvider } from '../capabilities/BaseProvider'

/**
 * Provider 기능설정
 */
export interface ProviderCapabilities {
  chat: boolean // 예아니오지원대화
  embedding: boolean // 예아니오지원임베딩
  rerank?: boolean // 예아니오지원재정렬(향후확장)
  imageGeneration?: boolean // 예아니오지원이미지생성(향후확장)
}

/**
 * Provider 설명
 * 용도:설정드라이버동의제공자정의
 */
export interface ProviderDescriptor {
  // 기정보
  name: string // 제공자표인식(만약 'openai', 'deepseek')
  displayName: string // 표시이름(만약 'OpenAI', 'DeepSeek')
  isBuiltin: boolean // 예아니오내장제공자

  // 기본설정
  defaultBaseUrl: string // 기본 API 주소
  defaultChatModel?: string // 기본대화모델
  defaultEmbeddingModel?: string // 기본임베딩모델
  defaultRerankModel?: string // 기본재정렬모델(향후확장)
  defaultImageModel?: string // 기본이미지생성모델(향후확장)

  // 기능선언
  capabilities: ProviderCapabilities

  // Provider 공공장함수
  // 용도:생성 Provider 인스턴스
  createProvider: (descriptor: ProviderDescriptor) => BaseProvider
}

/**
 * 자체정의제공자설정
 * 사용자통해 UI 추가자체정의제공자시사용의설정
 */
export interface CustomProviderConfig {
  providerName: string // 제공자이름
  displayName: string // 표시이름
  baseUrl: string // API 주소
  apiKey: string // API Key
}
