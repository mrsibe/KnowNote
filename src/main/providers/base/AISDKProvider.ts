/**
 * AI SDK Provider
 * 基于 Vercel AI SDK 的统一 Provider 实现
 * 支持所有 OpenAI 兼容的 API(OpenAI, DeepSeek, Qwen, Kimi, SiliconFlow 等)
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createQwen } from 'qwen-ai-provider'
import { createOllama } from 'ollama-ai-provider-v2'
import { streamText, embed, embedMany, wrapLanguageModel } from 'ai'
import type { BaseProvider, LLMProviderConfig } from '../capabilities/BaseProvider'
import type { ChatCapability } from '../capabilities/ChatCapability'
import type { EmbeddingCapability } from '../capabilities/EmbeddingCapability'
import type { APIMessage, StreamChunk } from '../../../shared/types/chat'
import type { EmbeddingConfig, EmbeddingResult } from '../capabilities/EmbeddingCapability'
import type { ProviderDescriptor } from '../registry/ProviderDescriptor'
import Logger from '../../../shared/utils/logger'
import { StreamAdapter } from '../../stream/StreamAdapter'
import { buildMiddlewares } from '../../middleware/MiddlewareBuilder'

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

    // 重新创建 AI SDK provider 实例
    if (config.apiKey || this.name === 'ollama') {
      if (this.name === 'openai') {
        // OpenAI 使用官方 provider
        this.aiProvider = createOpenAI({
          baseURL: this.config.baseUrl,
          apiKey: config.apiKey
        })
      } else if (this.name === 'deepseek') {
        // DeepSeek 使用官方 provider
        this.aiProvider = createDeepSeek({
          baseURL: this.config.baseUrl,
          apiKey: config.apiKey
        })
      } else if (this.name === 'qwen') {
        // Qwen 使用社区 provider
        this.aiProvider = createQwen({
          baseURL: this.config.baseUrl,
          apiKey: config.apiKey
        })
      } else if (this.name === 'ollama') {
        // Ollama 使用社区 provider
        this.aiProvider = createOllama({
          baseURL: this.config.baseUrl || 'http://localhost:11434/api'
        })
      } else {
        // 其他所有 provider 都使用 OpenAI Compatible (Kimi, SiliconFlow)
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
   * 使用 StreamAdapter 处理流式响应，自动追踪性能指标
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
        let model = this.aiProvider!(modelId) as any

        // 构建并应用中间件
        const middlewares = buildMiddlewares({
          providerName: this.name,
          modelId: modelId,
          enableReasoning: this.detectReasoningCapability(modelId)
        })

        if (middlewares.length > 0) {
          Logger.debug('AISDKProvider', `Applying ${middlewares.length} middlewares`)
          model = wrapLanguageModel({ model, middleware: middlewares })
        }

        // 调用 AI SDK streamText
        const result = streamText({
          model,
          messages: coreMessages,
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxTokens,
          abortSignal: abortController.signal
        })

        // 使用 StreamAdapter 处理流式响应
        const adapter = new StreamAdapter(
          (adapterChunk) => {
            // 将 StreamAdapter 的 chunk 格式转换为现有的 StreamChunk 格式
            switch (adapterChunk.type) {
              case 'reasoning-start':
                onChunk({
                  content: '',
                  done: false,
                  metadata: {
                    reasoningStart: true,
                    reasoningId: adapterChunk.metadata?.reasoningId
                  }
                })
                break

              case 'reasoning-delta':
                onChunk({
                  content: adapterChunk.content || '',
                  done: false,
                  metadata: {
                    isReasoning: true,
                    reasoningId: adapterChunk.metadata?.reasoningId
                  }
                })
                break

              case 'reasoning-end':
                onChunk({
                  content: '',
                  done: false,
                  metadata: {
                    reasoningEnd: true,
                    reasoningId: adapterChunk.metadata?.reasoningId
                  }
                })
                break

              case 'text-delta':
                onChunk({
                  content: adapterChunk.content || '',
                  done: false
                })
                break

              case 'finish':
                // 发送完成标记，包含 usage 和性能指标
                onChunk({
                  content: '',
                  done: true,
                  metadata: {
                    model: modelId,
                    finishReason: adapterChunk.metadata?.finishReason,
                    usage: adapterChunk.metadata?.usage,
                    // 添加性能指标到 metadata（扩展现有格式）
                    metrics: adapterChunk.metadata?.metrics
                  }
                })
                break
            }
          },
          { accumulate: false }
        )

        // 处理流式响应并获取性能指标
        await adapter.processStream(result.fullStream)

        Logger.debug('AISDKProvider', 'Stream completed successfully')
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
   * 检测模型是否支持推理能力
   */
  private detectReasoningCapability(modelId: string): boolean {
    const lowerModelId = modelId.toLowerCase()
    return (
      lowerModelId.includes('o1') ||
      lowerModelId.includes('o3') ||
      lowerModelId.includes('deepseek-reasoner') ||
      lowerModelId.includes('qwen-plus') ||
      lowerModelId.includes('qwen-max')
    )
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

    // 支持 dimensions 参数的 providers（白名单机制）
    const supportedProviders = ['openai', 'deepseek', 'zhipu', 'siliconflow', 'openai-compatible']

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
