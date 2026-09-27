/**
 * ModelClient
 *
 * 一个 Model Connection 的可执行封装：按 protocol 分派到对应的 adapter，
 * 提供对话流式生成与 embedding 能力。业务代码只依赖它，不感知厂商。
 */

import { embed, embedMany, streamText } from 'ai'
import type { LanguageModel, LanguageModelUsage } from 'ai'
import type { APIMessage, StreamChunk } from '../../shared/types/chat'
import type { ModelCapability, ModelConnection } from '../../shared/types/connection'
import { getProtocolAdapter } from './protocols'
import type { ProtocolAdapter } from './protocols'
import type { EmbeddingConfig, EmbeddingResult } from './types'
import Logger from '../../shared/utils/logger'

const DEFAULT_TEMPERATURE = 0.7
const DEFAULT_MAX_TOKENS = 2048

/**
 * How a stream reports back.
 *
 * An object rather than four positional callbacks (#139): with `onError`,
 * `onAbort` and `onComplete` all meaning "the turn ended, differently", a
 * positional call site is one reordering away from reporting an abort as a
 * completion — which is the bug this shape exists to prevent. At most one of the
 * three is called.
 */
export interface ChatStreamHandlers {
  onChunk: (chunk: StreamChunk) => void
  /** `reason` says whether the provider reported the failure or the stream just broke. */
  onError: (error: Error, reason: 'error' | 'unexpected_eof') => void
  onAbort: () => void
  /**
   * Called when the stream ended cleanly, after the terminal chunk. Whether that
   * makes the turn `completed` is not decided here — `classifyTerminal` decides it
   * from the reason the chunk carried, and may answer `failed`.
   */
  onComplete?: () => void
}

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
   *
   * The client reports *what it observed* and nothing more: a chunk arrived, the
   * provider said it failed, the caller aborted, the stream finished with a
   * reason. It does not decide what the turn *is* — that is one decision made
   * once, in `shared/utils/chatExecution.ts`, by whoever owns the turn (#138).
   *
   * The one thing this method guarantees is that at most one of `onError`,
   * `onAbort` and `onComplete` is called, and that the terminal chunk it emits
   * carries whatever reason the SDK reported — possibly none. What that means for
   * the turn is not decided here: `classifyTerminal` does that, once.
   */
  async sendMessageStream(
    messages: APIMessage[],
    handlers: ChatStreamHandlers
  ): Promise<AbortController> {
    const { onChunk, onError, onAbort, onComplete } = handlers
    const abortController = new AbortController()
    const modelId = this.connection.modelId

    ;(async () => {
      let streamFailed = false
      // The SDK's terminal statement. It emits one whenever the model stream
      // closes cleanly, filling in `'unknown'` when the provider named no reason
      // — so what this holds is a fact, and the *absence* of it is the case the
      // product must never read as success.
      let finishReason: string | undefined
      let totalUsage: LanguageModelUsage | undefined
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

          // The turn already ended when the provider reported a failure inside the
          // stream. Keep draining so the SDK's own stream state settles, but emit
          // nothing further: the error, not a completion, is the outcome.
          if (streamFailed) continue

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

            // The provider's terminal event, taken from the part rather than from
            // `await result.finishReason`: this is the event that ended the
            // stream, and a part that never arrived is reported as such instead of
            // being filled in by the aggregate promise.
            case 'finish':
              finishReason = part.finishReason
              totalUsage = part.totalUsage
              break

            // `fullStream` only *throws* the errors that stop the stream, such as
            // network errors; a provider that reports a failure inside a
            // streaming response (rate limit, upstream 5xx, content filter)
            // arrives here as an `error` part instead. Ignoring that part meant
            // the loop fell through to the `done` chunk below, so a broken stream
            // was reported to the renderer — and persisted — as an answer that
            // finished normally, with the truncated text as its content. What the
            // reader saw was the answer stopping for no stated reason.
            case 'error': {
              streamFailed = true
              const failure =
                part.error instanceof Error ? part.error : new Error(String(part.error))
              Logger.error('ModelClient', 'Stream error part:', failure)
              onError(failure, 'error')
              break
            }
          }
        }

        if (streamFailed) return

        // An abort is not a completion: the caller stopped the turn, and saying
        // `onComplete` here is how `aborted` used to be persisted and rendered as
        // `completed` (#139).
        if (abortController.signal.aborted) {
          onAbort()
          return
        }

        // Emitted whether or not a reason was reported: deciding what the turn is
        // belongs to `classifyTerminal`, and swallowing the terminal chunk here
        // would leave the caller with a stream that just stopped — the ambiguity
        // this path exists to remove.
        const usage = totalUsage

        onChunk({
          content: '',
          done: true,
          metadata: {
            model: modelId,
            finishReason,
            usage: {
              promptTokens: usage?.inputTokens || 0,
              completionTokens: usage?.outputTokens || 0,
              totalTokens:
                usage?.totalTokens || (usage?.inputTokens || 0) + (usage?.outputTokens || 0)
            }
          }
        })

        onComplete?.()
      } catch (error) {
        if (abortController.signal.aborted) {
          Logger.debug('ModelClient', 'Stream aborted')
          onAbort()
        } else {
          Logger.error('ModelClient', 'Stream error:', error)
          onError(error as Error, 'error')
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
