/**
 * AI SDK Provider
 * 基于 Vercel AI SDK 的统一 Provider 实现
 * 支持所有 OpenAI 兼容的 API(OpenAI, DeepSeek, Qwen, Kimi, SiliconFlow 等)
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
 * 将 APIMessage 转换为 AI SDK 的 CoreMessage 格式
 */
function convertToCoreMessages(messages: APIMessage[]) {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content
  }))
}

/**
 * AISDKProvider
 * 基于 Vercel AI SDK 的统一 Provider 实现
 * 根据 ProviderDescriptor 的能力配置动态组合功能
 */
export class AISDKProvider implements BaseProvider {
  readonly name: string
  private descriptor: ProviderDescriptor
  protected config: LLMProviderConfig

  // AI SDK provider 实例
  private aiProvider:
    | ReturnType<typeof createOpenAI>
    | ReturnType<typeof createOpenAICompatible>
    | ReturnType<typeof createDeepSeek>
    | ReturnType<typeof createQwen>
    | ReturnType<typeof createOllama>
    | null = null

  constructor(descriptor: ProviderDescriptor) {
    this.name = descriptor.name
    this.descriptor = descriptor

    // 初始化默认配置
    this.config = {
      baseUrl: descriptor.defaultBaseUrl,
      model: descriptor.defaultChatModel || descriptor.defaultEmbeddingModel,
      temperature: 0.7,
      maxTokens: 2048
    }

    Logger.info('AISDKProvider', `Provider ${this.name} initialized`)
  }

  /**
   * 配置 Provider
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
   * 验证配置是否有效
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

  // ==================== 能力检查方法 ====================

  /**
   * 检查是否支持对话能力
   * TypeScript 类型守卫
   */
  hasChatCapability(): this is BaseProvider & ChatCapability {
    return this.descriptor.capabilities.chat && this.aiProvider !== null
  }

  /**
   * 检查是否支持嵌入能力
   * TypeScript 类型守卫
   */
  hasEmbeddingCapability(): this is BaseProvider & EmbeddingCapability {
    return this.descriptor.capabilities.embedding && this.aiProvider !== null
  }

  // ==================== 对话能力方法 ====================

  /**
   * 流式发送消息
   * 如果不支持对话能力会抛出错误
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

    // 创建 AbortController
    const abortController = new AbortController()

    // 异步执行流式生成
    ;(async () => {
      try {
        const modelId = this.config.model || this.descriptor.defaultChatModel!

        Logger.debug('AISDKProvider', `Streaming with model: ${modelId}`)

        // 转换消息格式
        const coreMessages = convertToCoreMessages(messages)

        // 获取语言模型
        const model = this.aiProvider!(modelId) as any

        // 调用 AI SDK streamText
        const result = streamText({
          model,
          messages: coreMessages,
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxTokens,
          abortSignal: abortController.signal
        })

        // 处理流式响应
        // 使用 fullStream 而不是 textStream 以支持推理过程展示
        for await (const part of result.fullStream) {
          if (abortController.signal.aborted) {
            Logger.debug('AISDKProvider', 'Stream aborted by user')
            break
          }

          // 处理不同类型的流式部分
          switch (part.type) {
            case 'reasoning-start':
              // 推理块开始
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
              // 推理增量内容
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
              // 推理块结束
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
              // 文本增量内容（最终答案）
              onChunk({
                content: part.text,
                done: false
              })
              break
          }
        }

        // 等待结果完成，获取 metadata
        const finalResult = await result
        const usage = await finalResult.usage
        const finishReason = await finalResult.finishReason

        // 发送完成标记，包含 metadata
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
   * 获取默认对话模型
   */
  getDefaultChatModel(): string {
    if (!this.descriptor.capabilities.chat) {
      throw new Error(`Provider ${this.name} does not support chat capability`)
    }
    return this.descriptor.defaultChatModel || ''
  }

  /**
   * 获取 AI SDK 模型实例 (用于 streamObject 等高级 API)
   * @param modelId - 模型ID,如果不提供则使用配置的默认模型
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

  // ==================== 嵌入能力方法 ====================

  /**
   * 生成单个文本的 Embedding
   * 如果不支持嵌入能力会抛出错误
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

    // 使用 AI SDK 的 embed 函数
    // 不同 provider 使用不同的方法名
    const embeddingModel =
      this.name === 'ollama'
        ? (this.aiProvider as any).embedding(modelId) // Ollama: embedding
        : (this.aiProvider as any).textEmbeddingModel(modelId) // OpenAI, DeepSeek, Qwen, OpenAI-Compatible: textEmbeddingModel

    // 构建 providerOptions
    const providerOptions = this.buildProviderOptions(config)

    const result = await embed({
      model: embeddingModel,
      value: text,
      ...(providerOptions && { providerOptions }) // 条件添加 providerOptions
    })

    return {
      embedding: new Float32Array(result.embedding),
      model: modelId,
      dimensions: result.embedding.length,
      tokensUsed: result.usage?.tokens || 0
    }
  }

  /**
   * 批量生成 Embedding
   * 如果不支持嵌入能力会抛出错误
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

    // 使用 AI SDK 的 embedMany 函数
    // 不同 provider 使用不同的方法名
    const embeddingModel =
      this.name === 'ollama'
        ? (this.aiProvider as any).embedding(modelId) // Ollama: embedding
        : (this.aiProvider as any).textEmbeddingModel(modelId) // OpenAI, DeepSeek, Qwen, OpenAI-Compatible: textEmbeddingModel

    // 构建 providerOptions
    const providerOptions = this.buildProviderOptions(config)

    const result = await embedMany({
      model: embeddingModel,
      values: texts,
      ...(providerOptions && { providerOptions }) // 条件添加 providerOptions
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
   * 获取默认 Embedding 模型
   */
  getDefaultEmbeddingModel(): string {
    if (!this.descriptor.capabilities.embedding) {
      throw new Error(`Provider ${this.name} does not support embedding capability`)
    }
    return this.descriptor.defaultEmbeddingModel || ''
  }

  /**
   * 构建 provider-specific 选项
   * 根据 provider 类型和配置生成 providerOptions
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

    // 对于 OpenAI 兼容的 provider，使用统一的格式
    // SiliconFlow 使用 'openai' 作为 providerKey
    const providerKey = this.name === 'siliconflow' ? 'openai' : this.name

    return {
      [providerKey]: {
        dimensions: config.dimensions
      }
    }
  }

  // ==================== 向后兼容方法(已废弃) ====================

  /**
   * @deprecated 使用 hasChatCapability() 或 hasEmbeddingCapability() 替代
   * 检查是否支持 Embedding
   */
  supportsEmbedding(): boolean {
    return this.hasEmbeddingCapability()
  }
}
