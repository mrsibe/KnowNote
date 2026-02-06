/**
 * AI SDK 到 Litebook Chunk 适配器
 * 完全参考 cherry-studio 的 AiSdkToChunkAdapter 实现
 */

import type { TextStreamPart } from 'ai'
import Logger from '../../shared/utils/logger'

export interface StreamChunk {
  type: 'reasoning-start' | 'reasoning-delta' | 'reasoning-end' | 'text-delta' | 'finish'
  content?: string
  metadata?: {
    reasoningId?: string
    isReasoning?: boolean
    usage?: {
      promptTokens: number
      completionTokens: number
      totalTokens: number
    }
    finishReason?: string
    model?: string
    metrics?: StreamMetrics
  }
}

export interface StreamMetrics {
  firstTokenTime: number // 首 token 时间（毫秒）
  completionTime: number // 完成时间（毫秒）
  tokensPerSecond?: number // tokens/秒
}

interface StreamState {
  text: string
  reasoningContent: string
  reasoningId: string
}

export class StreamAdapter {
  private firstTokenTimestamp: number | null = null
  private responseStartTimestamp: number | null = null
  private accumulate: boolean

  constructor(
    private onChunk: (chunk: StreamChunk) => void,
    options?: {
      accumulate?: boolean // 是否累积文本
    }
  ) {
    this.accumulate = options?.accumulate ?? false
  }

  /**
   * 处理 AI SDK 流结果
   * 参考 cherry-studio 的 processStream 实现
   */
  async processStream(fullStream: ReadableStream<TextStreamPart<any>>): Promise<{
    text: string
    reasoningContent: string
    metrics: StreamMetrics
  }> {
    const reader = fullStream.getReader()
    const state: StreamState = {
      text: '',
      reasoningContent: '',
      reasoningId: ''
    }

    this.resetTimingState()
    this.responseStartTimestamp = Date.now()

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        // 转换并发送 chunk
        this.convertAndEmitChunk(value, state)
      }
    } finally {
      reader.releaseLock()
    }

    const metrics = this.buildMetrics(state)
    this.resetTimingState()

    return {
      text: state.text,
      reasoningContent: state.reasoningContent,
      metrics
    }
  }

  /**
   * 转换 AI SDK chunk 为 Litebook chunk
   * 完全参考 cherry-studio 的 convertAndEmitChunk 实现
   */
  private convertAndEmitChunk(chunk: TextStreamPart<any>, state: StreamState) {
    switch (chunk.type) {
      case 'reasoning-start':
        state.reasoningId = chunk.id
        this.onChunk({
          type: 'reasoning-start',
          metadata: { reasoningId: chunk.id }
        })
        break

      case 'reasoning-delta':
        state.reasoningContent += chunk.text || ''
        this.markFirstTokenIfNeeded()
        this.onChunk({
          type: 'reasoning-delta',
          content: chunk.text,
          metadata: {
            isReasoning: true,
            reasoningId: chunk.id
          }
        })
        break

      case 'reasoning-end':
        this.onChunk({
          type: 'reasoning-end',
          metadata: { reasoningId: chunk.id }
        })
        break

      case 'text-delta': {
        const text = chunk.text || ''

        if (this.accumulate) {
          state.text += text
        } else {
          state.text = text
        }

        this.markFirstTokenIfNeeded()
        this.onChunk({
          type: 'text-delta',
          content: this.accumulate ? state.text : text
        })
        break
      }

      case 'finish': {
        const usage = {
          promptTokens: chunk.totalUsage?.inputTokens || 0,
          completionTokens: chunk.totalUsage?.outputTokens || 0,
          totalTokens: chunk.totalUsage?.totalTokens || 0
        }

        const metrics = this.buildMetrics(state)

        this.onChunk({
          type: 'finish',
          metadata: {
            usage,
            finishReason: chunk.finishReason,
            metrics
          }
        })
        break
      }

      case 'error':
        Logger.error('StreamAdapter', 'Stream error:', chunk.error)
        break
    }
  }

  private markFirstTokenIfNeeded() {
    if (this.firstTokenTimestamp === null && this.responseStartTimestamp !== null) {
      this.firstTokenTimestamp = Date.now()
    }
  }

  private resetTimingState() {
    this.responseStartTimestamp = null
    this.firstTokenTimestamp = null
  }

  /**
   * 构建性能指标
   * 参考 cherry-studio 的 buildMetrics 实现
   */
  private buildMetrics(state: StreamState): StreamMetrics {
    const now = Date.now()
    const start = this.responseStartTimestamp ?? now
    const firstToken = this.firstTokenTimestamp
    const firstTokenTime = Math.max(firstToken != null ? firstToken - start : 0, 0)
    const baseForCompletion = firstToken ?? start
    const completionTime = Math.max(now - baseForCompletion, 0)

    // 计算 tokens/秒
    let tokensPerSecond: number | undefined
    if (completionTime > 0 && state.text.length > 0) {
      // 简单估算：每 4 个字符约等于 1 个 token
      const estimatedTokens = Math.ceil(state.text.length / 4)
      tokensPerSecond = (estimatedTokens / completionTime) * 1000
    }

    return {
      firstTokenTime,
      completionTime,
      tokensPerSecond
    }
  }
}
