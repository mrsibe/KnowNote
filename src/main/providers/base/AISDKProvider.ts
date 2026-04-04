/**
 * AI SDK Provider
 * Vercel AI SDK 기반 통합 Provider 구현
 * OpenAI 호환 API를 지원하는 모든 프로바이더 지원 (OpenAI, DeepSeek, LM Studio, Ollama 등)
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOllama } from 'ollama-ai-provider-v2'
import { streamText, embed, embedMany } from 'ai'
import type { BaseProvider, LLMProviderConfig } from '../capabilities/BaseProvider'
import type { ChatCapability } from '../capabilities/ChatCapability'
import type { EmbeddingCapability } from '../capabilities/EmbeddingCapability'
import type { APIMessage, StreamChunk } from '../../../shared/types/chat'
import type { EmbeddingConfig, EmbeddingResult } from '../capabilities/EmbeddingCapability'
import type { ProviderDescriptor } from '../registry/ProviderDescriptor'
import Logger from '../../../shared/utils/logger'

/**
 * APIMessage를 AI SDK의 CoreMessage 형식으로 변환
 */
function convertToCoreMessages(messages: APIMessage[]) {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content
  }))
}

/**
 * AISDKProvider
 * Vercel AI SDK 기반 통합 Provider 구현
 * ProviderDescriptor의 기능 설정에 따라 동적으로 기능을 조합
 */
export class AISDKProvider implements BaseProvider {
  readonly name: string
  private descriptor: ProviderDescriptor
  protected config: LLMProviderConfig

  // AI SDK provider 인스턴스
  private aiProvider:
    | ReturnType<typeof createOpenAI>
    | ReturnType<typeof createOpenAICompatible>
    | ReturnType<typeof createDeepSeek>
    | ReturnType<typeof createOllama>
    | null = null

  constructor(descriptor: ProviderDescriptor) {
    this.name = descriptor.name
    this.descriptor = descriptor

    // 기본 설정 초기화
    this.config = {
      baseUrl: descriptor.defaultBaseUrl,
      model: descriptor.defaultChatModel || descriptor.defaultEmbeddingModel,
      temperature: 0.7,
      maxTokens: 2048
    }

    Logger.info('AISDKProvider', `Provider ${this.name} initialized`)
  }

  /**
   * Provider 설정
   */
  configure(config: LLMProviderConfig): void {
    this.config = { ...this.config, ...config }

    // AI SDK provider 인스턴스 재생성
    if (config.apiKey || this.name === 'ollama' || this.name === 'lmstudio') {
      if (this.name === 'openai') {
        // OpenAI 공식 provider
        this.aiProvider = createOpenAI({
          baseURL: this.config.baseUrl,
          apiKey: config.apiKey
        })
      } else if (this.name === 'deepseek') {
        // DeepSeek 공식 provider
        this.aiProvider = createDeepSeek({
          baseURL: this.config.baseUrl,
          apiKey: config.apiKey
        })
      } else if (this.name === 'ollama') {
        // Ollama 로컬 provider
        this.aiProvider = createOllama({
          baseURL: this.config.baseUrl || 'http://localhost:11434/api'
        })
      } else if (this.name === 'lmstudio') {
        // LM Studio 로컬 provider (OpenAI 호환 API)
        this.aiProvider = createOpenAICompatible({
          name: 'lmstudio',
          baseURL: this.config.baseUrl || 'http://localhost:1234/v1',
          apiKey: 'lm-studio'
        })
      } else {
        // 기타 OpenAI 호환 provider
        this.aiProvider = createOpenAICompatible({
          name: this.name,
          baseURL: this.config.baseUrl || '',
          apiKey: config.apiKey || ''
        })
      }
    }

    Logger.debug('AISDKProvider', `Provider ${this.name} configured`)
  }

  /**
   * 설정 유효성 검증
   */
  async validateConfig(config: LLMProviderConfig): Promise<boolean> {
    try {
      const response = await fetch(`${config.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`
        }
      })
      return response.ok
    } catch {
      return false
    }
  }

  // ==================== 기능 확인 메서드 ====================

  /**
   * 대화 기능 지원 여부 확인
   * TypeScript 타입 가드
   */
  hasChatCapability(): this is BaseProvider & ChatCapability {
    return this.descriptor.capabilities.chat && this.aiProvider !== null
  }

  /**
   * 임베딩 기능 지원 여부 확인
   * TypeScript 타입 가드
   */
  hasEmbeddingCapability(): this is BaseProvider & EmbeddingCapability {
    return this.descriptor.capabilities.embedding && this.aiProvider !== null
  }

  // ==================== 대화 기능 메서드 ====================

  /**
   * 스트리밍 방식으로 메시지 전송
   * 대화 기능을 지원하지 않으면 에러를 발생시킵니다
   */
  async sendMessageStream(
    messages: APIMessage[],
    onChunk: (chunk: StreamChunk) => void,
    onError: (error: Error) => void,
    onComplete: () => void
  ): Promise<AbortController> {
    if (!this.aiProvider) {
      const error = new Error(
        `Provider ${this.name} is not configured. Please configure API key first.`
      )
      onError(error)
      const abortController = new AbortController()
      abortController.abort()
      return abortController
    }

    if (!this.descriptor.capabilities.chat) {
      const error = new Error(`Provider ${this.name} does not support chat capability`)
      onError(error)
      const abortController = new AbortController()
      abortController.abort()
      return abortController
    }

    // AbortController 생성
    const abortController = new AbortController()

    // 비동기로 스트리밍 생성 실행
    ;(async () => {
      try {
        const modelId = this.config.model || this.descriptor.defaultChatModel!

        Logger.debug('AISDKProvider', `Streaming with model: ${modelId}`)

        // 메시지 형식 변환
        const coreMessages = convertToCoreMessages(messages)

        // 언어 모델 조회
        const model = this.aiProvider!(modelId) as any

        // AI SDK streamText 호출
        const result = streamText({
          model,
          messages: coreMessages,
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxTokens,
          abortSignal: abortController.signal
        })

        // 스트리밍 응답 처리
        // 추론 과정 표시를 위해 textStream 대신 fullStream 사용
        for await (const part of result.fullStream) {
          if (abortController.signal.aborted) {
            Logger.debug('AISDKProvider', 'Stream aborted by user')
            break
          }

          // 스트리밍 파트 타입별 처리
          switch (part.type) {
            case 'reasoning-start':
              // 추론 블록 시작
              onChunk({
                content: '',
                done: false,
                metadata: {
                  reasoningStart: true,
                  reasoningId: part.id
                }
              })
              break

            case 'reasoning-delta':
              // 추론 증분 내용
              onChunk({
                content: part.text,
                done: false,
                metadata: {
                  isReasoning: true,
                  reasoningId: part.id
                }
              })
              break

            case 'reasoning-end':
              // 추론 블록 종료
              onChunk({
                content: '',
                done: false,
                metadata: {
                  reasoningEnd: true,
                  reasoningId: part.id
                }
              })
              break

            case 'text-delta':
              // 텍스트 증분 내용 (최종 답변)
              onChunk({
                content: part.text,
                done: false
              })
              break
          }
        }

        // 결과 완료 대기, metadata 조회
        const finalResult = await result
        const usage = await finalResult.usage
        const finishReason = await finalResult.finishReason

        // 완료 마커 전송 (metadata 포함)
        onChunk({
          content: '',
          done: true,
          metadata: {
            model: modelId,
            finishReason: finishReason,
            usage: {
              promptTokens: usage.inputTokens || 0,
              completionTokens: usage.outputTokens || 0,
              totalTokens: usage.totalTokens || (usage.inputTokens || 0) + (usage.outputTokens || 0)
            }
          }
        })

        onComplete()
      } catch (error) {
        if (abortController.signal.aborted) {
          Logger.debug('AISDKProvider', 'Stream aborted')
          onComplete()
        } else {
          Logger.error('AISDKProvider', 'Stream error:', error)
          onError(error as Error)
        }
      }
    })()

    return abortController
  }

  /**
   * 기본 대화 모델 조회
   */
  getDefaultChatModel(): string {
    if (!this.descriptor.capabilities.chat) {
      throw new Error(`Provider ${this.name} does not support chat capability`)
    }
    return this.descriptor.defaultChatModel || ''
  }

  /**
   * AI SDK 모델 인스턴스 조회 (streamObject 등 고급 API용)
   * @param modelId - 모델 ID. 미지정 시 기본 설정 모델 사용
   */
  getAIModel(modelId?: string): any {
    if (!this.aiProvider) {
      throw new Error(`Provider ${this.name} is not configured. Please configure API key first.`)
    }
    const model = modelId || this.config.model || this.descriptor.defaultChatModel
    if (!model) {
      throw new Error(`No model specified for provider ${this.name}`)
    }
    return this.aiProvider(model)
  }

  // ==================== 임베딩 기능 메서드 ====================

  /**
   * 단일 텍스트의 Embedding 생성
   * 임베딩 기능을 지원하지 않으면 에러를 발생시킵니다
   */
  async createEmbedding(text: string, config?: EmbeddingConfig): Promise<EmbeddingResult> {
    if (!this.aiProvider) {
      throw new Error(`Provider ${this.name} is not configured. Please configure API key first.`)
    }

    if (!this.descriptor.capabilities.embedding) {
      throw new Error(`Provider ${this.name} does not support embedding capability`)
    }

    const modelId =
      config?.model || this.config.model || this.descriptor.defaultEmbeddingModel || ''

    if (!modelId) {
      throw new Error(`No embedding model specified for provider ${this.name}`)
    }

    Logger.debug('AISDKProvider', `Creating embedding with model: ${modelId}`)

    // AI SDK의 embed 함수 사용
    // provider별로 다른 메서드명 사용
    const embeddingModel =
      this.name === 'ollama'
        ? (this.aiProvider as any).embedding(modelId) // Ollama: embedding
        : (this.aiProvider as any).textEmbeddingModel(modelId) // OpenAI, DeepSeek, OpenAI-Compatible: textEmbeddingModel

    // providerOptions 빌드
    const providerOptions = this.buildProviderOptions(config)

    const result = await embed({
      model: embeddingModel,
      value: text,
      ...(providerOptions && { providerOptions }) // 조건부 providerOptions 추가
    })

    return {
      embedding: new Float32Array(result.embedding),
      model: modelId,
      dimensions: result.embedding.length,
      tokensUsed: result.usage?.tokens || 0
    }
  }

  /**
   * 배치 Embedding 생성
   * 임베딩 기능을 지원하지 않으면 에러를 발생시킵니다
   */
  async createEmbeddings(texts: string[], config?: EmbeddingConfig): Promise<EmbeddingResult[]> {
    if (!this.aiProvider) {
      throw new Error(`Provider ${this.name} is not configured. Please configure API key first.`)
    }

    if (!this.descriptor.capabilities.embedding) {
      throw new Error(`Provider ${this.name} does not support embedding capability`)
    }

    const modelId =
      config?.model || this.config.model || this.descriptor.defaultEmbeddingModel || ''

    if (!modelId) {
      throw new Error(`No embedding model specified for provider ${this.name}`)
    }

    Logger.debug(
      'AISDKProvider',
      `Creating embeddings for ${texts.length} texts with model: ${modelId}`
    )

    // AI SDK의 embedMany 함수 사용
    // provider별로 다른 메서드명 사용
    const embeddingModel =
      this.name === 'ollama'
        ? (this.aiProvider as any).embedding(modelId) // Ollama: embedding
        : (this.aiProvider as any).textEmbeddingModel(modelId) // OpenAI, DeepSeek, OpenAI-Compatible: textEmbeddingModel

    // providerOptions 빌드
    const providerOptions = this.buildProviderOptions(config)

    const result = await embedMany({
      model: embeddingModel,
      values: texts,
      ...(providerOptions && { providerOptions }) // 조건부 providerOptions 추가
    })

    const totalTokens = result.usage?.tokens || 0
    const tokensPerEmbedding = Math.floor(totalTokens / texts.length)

    return result.embeddings.map((embedding) => ({
      embedding: new Float32Array(embedding),
      model: modelId,
      dimensions: embedding.length,
      tokensUsed: tokensPerEmbedding
    }))
  }

  /**
   * 기본 Embedding 모델 조회
   */
  getDefaultEmbeddingModel(): string {
    if (!this.descriptor.capabilities.embedding) {
      throw new Error(`Provider ${this.name} does not support embedding capability`)
    }
    return this.descriptor.defaultEmbeddingModel || ''
  }

  /**
   * provider별 옵션 빌드
   * provider 타입과 설정에 따라 providerOptions 생성
   */
  private buildProviderOptions(config?: EmbeddingConfig): Record<string, any> | undefined {
    if (!config?.dimensions) {
      return undefined
    }

    // dimensions 파라미터를 지원하는 provider (화이트리스트)
    const supportedProviders = ['openai', 'deepseek', 'lmstudio', 'openai-compatible']

    if (!supportedProviders.includes(this.name)) {
      Logger.debug(
        'AISDKProvider',
        `Provider ${this.name} does not support dimensions parameter, ignoring`
      )
      return undefined
    }

    // OpenAI 호환 provider는 통일된 형식 사용
    const providerKey = this.name

    return {
      [providerKey]: {
        dimensions: config.dimensions
      }
    }
  }

  // ==================== 하위 호환 메서드 (사용 중단) ====================

  /**
   * @deprecated hasChatCapability() 또는 hasEmbeddingCapability() 사용 권장
   * Embedding 지원 여부 확인
   */
  supportsEmbedding(): boolean {
    return this.hasEmbeddingCapability()
  }
}
