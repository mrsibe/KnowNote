/**
 * ModelClient
 *
 * 一个 Model Connection 的可执行封装：按 protocol 分派到对应的 adapter，
 * 提供对话流式生成与 embedding 能力。业务代码只依赖它，不感知厂商。
 */

import { embed, embedMany, streamText } from 'ai'
import type { LanguageModel } from 'ai'
import type { APIMessage, StreamChunk } from '../../shared/types/chat'
import type { ModelCapability, ModelConnection } from '../../shared/types/connection'
import { getProtocolAdapter } from './protocols'
import type { ProtocolAdapter } from './protocols'
import type { EmbeddingConfig, EmbeddingResult } from './types'
import Logger from '../../shared/utils/logger'

const DEFAULT_TEMPERATURE = 0.7
const DEFAULT_MAX_TOKENS = 2048

/**
 * 将 APIMessage 转换为 AI SDK 的 CoreMessage 格式
 */
function convertToCoreMessages(messages: APIMessage[]) {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content
  }))
}

export class ModelClient {
  readonly capability: ModelCapability
  readonly connection: ModelConnection
  private adapter: ProtocolAdapter

  constructor(capability: ModelCapability, connection: ModelConnection) {
    this.capability = capability
    this.connection = connection
    this.adapter = getProtocolAdapter(connection.protocol)
  }

  get modelId(): string {
    return this.connection.modelId
  }

  get label(): string {
    return `${this.connection.protocol} · ${this.connection.modelId}`
  }

  /**
   * 获取 AI SDK 模型实例（用于 streamObject / generateObject 等高级 API）
   */
  getAIModel(modelId?: string): LanguageModel {
    return this.adapter.createLanguageModel({
      ...this.connection,
      modelId: modelId || this.connection.modelId
    })
  }

  /**
   * 流式发送消息
   */
  async sendMessageStream(
    messages: APIMessage[],
    onChunk: (chunk: StreamChunk) => void,
    onError: (error: Error) => void,
    onComplete: () => void
  ): Promise<AbortController> {
    const abortController = new AbortController()
    const modelId = this.connection.modelId

    ;(async () => {
      try {
        Logger.debug('ModelClient', `Streaming with model: ${modelId}`)

        const result = streamText({
          model: this.getAIModel(),
          messages: convertToCoreMessages(messages),
          temperature: DEFAULT_TEMPERATURE,
          maxOutputTokens: DEFAULT_MAX_TOKENS,
          abortSignal: abortController.signal
        })

        // 使用 fullStream 而不是 textStream 以支持推理过程展示
        for await (const part of result.fullStream) {
          if (abortController.signal.aborted) {
            Logger.debug('ModelClient', 'Stream aborted by user')
            break
          }

          switch (part.type) {
            case 'reasoning-start':
              onChunk({
                content: '',
                done: false,
                metadata: { reasoningStart: true, reasoningId: part.id }
              })
              break

            case 'reasoning-delta':
              onChunk({
                content: part.text,
                done: false,
                metadata: { isReasoning: true, reasoningId: part.id }
              })
              break

            case 'reasoning-end':
              onChunk({
                content: '',
                done: false,
                metadata: { reasoningEnd: true, reasoningId: part.id }
              })
              break

            case 'text-delta':
              onChunk({ content: part.text, done: false })
              break
          }
        }

        const finalResult = await result
        const usage = await finalResult.usage
        const finishReason = await finalResult.finishReason

        onChunk({
          content: '',
          done: true,
          metadata: {
            model: modelId,
            finishReason,
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
          Logger.debug('ModelClient', 'Stream aborted')
          onComplete()
        } else {
          Logger.error('ModelClient', 'Stream error:', error)
          onError(error as Error)
        }
      }
    })()

    return abortController
  }

  /**
   * 生成单个文本的 Embedding
   */
  async createEmbedding(text: string, config?: EmbeddingConfig): Promise<EmbeddingResult> {
    const modelId = config?.model || this.connection.modelId
    if (!modelId) {
      throw new Error('No embedding model configured')
    }

    Logger.debug('ModelClient', `Creating embedding with model: ${modelId}`)

    const model = this.adapter.createEmbeddingModel({ ...this.connection, modelId })
    const providerOptions = this.adapter.embeddingProviderOptions?.(
      this.connection,
      config?.dimensions
    )

    const result = await embed({
      model,
      value: text,
      ...(providerOptions && { providerOptions })
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
   */
  async createEmbeddings(texts: string[], config?: EmbeddingConfig): Promise<EmbeddingResult[]> {
    const modelId = config?.model || this.connection.modelId
    if (!modelId) {
      throw new Error('No embedding model configured')
    }

    Logger.debug(
      'ModelClient',
      `Creating embeddings for ${texts.length} texts with model: ${modelId}`
    )

    const model = this.adapter.createEmbeddingModel({ ...this.connection, modelId })
    const providerOptions = this.adapter.embeddingProviderOptions?.(
      this.connection,
      config?.dimensions
    )

    const result = await embedMany({
      model,
      values: texts,
      ...(providerOptions && { providerOptions })
    })

    const totalTokens = result.usage?.tokens || 0
    const tokensPerEmbedding = texts.length > 0 ? Math.floor(totalTokens / texts.length) : 0

    return result.embeddings.map((embedding) => ({
      embedding: new Float32Array(embedding),
      model: modelId,
      dimensions: embedding.length,
      tokensUsed: tokensPerEmbedding
    }))
  }
}
