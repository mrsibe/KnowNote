/**
 * AI Provider 타입정의
 * 기반기능조합���턴의새프레임워크구조
 */

import type { APIMessage, StreamChunk } from '../../shared/types/chat'

// ==================== 내보내기공공유타입 ====================
export type { APIMessage as ChatMessage, StreamChunk }

// ==================== 내보내기새의기능 인터페이스 ====================
export type { BaseProvider, LLMProviderConfig } from './capabilities/BaseProvider'
export type { ChatCapability } from './capabilities/ChatCapability'
export type {
  EmbeddingCapability,
  EmbeddingConfig,
  EmbeddingResult
} from './capabilities/EmbeddingCapability'
export type {
  RerankCapability,
  RerankConfig,
  RerankDocument,
  RerankResult
} from './capabilities/RerankCapability'
export type {
  ImageGenerationCapability,
  ImageGenerationConfig,
  ImageGenerationResult
} from './capabilities/ImageGenerationCapability'

// ==================== Provider 조합타입 ====================
import type { BaseProvider } from './capabilities/BaseProvider'
import type { ChatCapability } from './capabilities/ChatCapability'
import type { EmbeddingCapability } from './capabilities/EmbeddingCapability'
import type { RerankCapability } from './capabilities/RerankCapability'
import type { ImageGenerationCapability } from './capabilities/ImageGenerationCapability'

/**
 * 대화 Provider
 * 지원대화공의 Provider
 */
export type ChatProvider = BaseProvider & ChatCapability

/**
 * 임베딩 Provider
 * 지원임베딩공의 Provider
 */
export type EmbeddingProvider = BaseProvider & EmbeddingCapability

/**
 * 완전한공 Provider
 * 동시지원대화및임베딩공의 Provider
 */
export type FullFeaturedProvider = BaseProvider & ChatCapability & EmbeddingCapability

/**
 * 재정렬 Provider (향후확장)
 * 지원재정렬공의 Provider
 */
export type RerankProvider = BaseProvider & RerankCapability

/**
 * 이미지생성 Provider (향후확장)
 * 지원이미지생성공의 Provider
 */
export type ImageProvider = BaseProvider & ImageGenerationCapability

/**
 * 멀티모달 Provider (향후확장)
 * 지원많은종류기능의 Provider
 */
export type MultimodalProvider = BaseProvider &
  ChatCapability &
  EmbeddingCapability &
  ImageGenerationCapability

// ==================== 이전인터페이스(하위 호환성,사용 중단됨) ====================

/**
 * @deprecated 요청사용새의기능조합타입: ChatProvider, EmbeddingProvider, FullFeaturedProvider
 * 이전의 LLMProvider 인터페이스,유지용도:하위 호환성
 */
export interface LLMProvider {
  readonly name: string
  configure(config: any): void
  sendMessageStream(
    messages: APIMessage[],
    onChunk: (chunk: StreamChunk) => void,
    onError: (error: Error) => void,
    onComplete: () => void
  ): Promise<AbortController>
  validateConfig?(config: any): Promise<boolean>
  supportsEmbedding?(): boolean
  createEmbedding?(text: string, config?: any): Promise<any>
  createEmbeddings?(texts: string[], config?: any): Promise<any[]>
  getDefaultEmbeddingModel?(): string
}
