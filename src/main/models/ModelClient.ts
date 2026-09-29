/**
 * ModelClient
 *
 * 一个 Model Connection 的可执行封装：按 protocol 分派到对应的 adapter，
 * 提供对话流式生成与 embedding 能力。业务代码只依赖它，不感知厂商。
 */

import { embed, embedMany, streamText } from 'ai'
import type { AsyncIterableStream, LanguageModel, LanguageModelUsage, UIMessageChunk } from 'ai'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { APIMessage, ChatTokenUsage } from '../../shared/types/chat'
import type { ModelCapability, ModelConnection } from '../../shared/types/connection'
import { getProtocolAdapter } from './protocols'
import type { ProtocolAdapter } from './protocols'
import type { EmbeddingConfig, EmbeddingResult } from './types'
import Logger from '../../shared/utils/logger'

const DEFAULT_TEMPERATURE = 0.7

/**
 * One provider call, as a stream.
 *
 * The client answers exactly one question — given a model and messages, give me a
 * stream — and this is the whole of the answer. It does not classify outcomes
 * (#139), own the lifecycle (#140) or decide what the renderer sees (#141).
 */
export interface ChatStream {
  /**
   * The SDK's own UI event stream, passed through untouched.
   *
   * Main forwards these events verbatim and assembles them with the SDK's
   * `readUIMessageStream`; the renderer assembles the same events with the same
   * function. Neither side re-derives the message from deltas, which is where the
   * old reduced protocol went wrong.
   */
  events: AsyncIterableStream<UIMessageChunk>
}

/** The provider's token accounting, in the shape KnowNote stores. */
const toTokenUsage = (usage: LanguageModelUsage): ChatTokenUsage => ({
  promptTokens: usage.inputTokens ?? 0,
  completionTokens: usage.outputTokens ?? 0,
  totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
})

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
   * The provider options this connection's reasoning configuration translates to
   * (#179), or undefined when nothing was declared.
   */
  private chatProviderOptions(): SharedV2ProviderOptions | undefined {
    return this.adapter.chatProviderOptions?.(this.connection)
  }

  /**
   * 流式发送消息
   *
   * Returns the SDK's own event stream. Everything the previous callback API
   * decided — what ended the turn, whether that was a failure, what to persist,
   * what the renderer is told — belongs to `ChatStreamManager` (#140), which owns
   * the signal this call is given (#141).
   */
  streamChat(messages: APIMessage[], options: { signal?: AbortSignal } = {}): ChatStream {
    Logger.debug('ModelClient', `Streaming with model: ${this.connection.modelId}`)

    const maxOutputTokens = this.connection.maxOutputTokens
    const providerOptions = this.chatProviderOptions()

    const result = streamText({
      model: this.getAIModel(),
      messages: convertToCoreMessages(messages),
      temperature: DEFAULT_TEMPERATURE,
      // Only when the connection asks for a ceiling. Absent means the model's own
      // default, which is what a reasoning model needs: its thinking shares this
      // budget with the answer, so 2048 of them was a ceiling reached early (#150).
      ...(maxOutputTokens !== undefined && { maxOutputTokens }),
      // Only when the connection declares reasoning effort or a budget (#179).
      // Absent keeps the request byte-for-byte what it was for an unknown
      // OpenAI-compatible endpoint.
      ...(providerOptions && { providerOptions }),
      // Owned by the caller, so that stopping a turn actually cancels the provider
      // request rather than only recording that it was stopped.
      abortSignal: options.signal
    })

    return {
      events: result.toUIMessageStream({
        sendReasoning: true,
        // The SDK replaces a provider error with a generic sentence by default; the
        // reader is owed the real one, which is what the transcript has always shown.
        onError: (error) => (error instanceof Error ? error.message : String(error)),
        // Usage has no chunk of its own in the UI protocol, so it rides on the
        // terminal one. Reading `result.usage` instead is not an option: that getter
        // consumes the result stream on first access, which would compete with the
        // stream the caller is already reading.
        messageMetadata: ({ part }) =>
          part.type === 'finish' ? { usage: toTokenUsage(part.totalUsage) } : undefined
      })
    }
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
