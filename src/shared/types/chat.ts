/**
 * 统一的聊天相关类型定义
 * 此文件被 main、renderer、preload 三个进程共享
 *
 * 类型定义基于 Drizzle 推导的数据库 schema,确保类型定义的单一数据源
 */

import type {
  ChatSession as DBChatSession,
  ChatMessage as DBChatMessage
} from '../../main/db/schema'

/**
 * 聊天会话接口（完整版）
 * 直接使用 Drizzle 推导的数据库类型
 */
export type ChatSession = DBChatSession

/**
 * One passage an answer was built from.
 *
 * The retrieval step already knows all of this and used to discard everything
 * except the title and the text: `buildRAGContext` accepted only
 * `{ documentTitle, content, score }`, so by the time an answer existed there was
 * no way back to the document it came from.
 *
 * `content` is the passage **as retrieved**, stored rather than re-derived. That
 * is deliberate: re-chunking or re-embedding the notebook must not invalidate the
 * quote that is already shown in a delivered answer. The stored text is the
 * evidence; it is not an id into a table that a re-index would rewrite.
 */
export interface AnswerSource {
  /** 1-based position in the prompt, so a marker in the answer can resolve. */
  index: number
  documentId: string
  documentTitle: string
  documentType?: string
  chunkId: string
  chunkIndex?: number
  /** The passage text as retrieved. */
  content: string
  score?: number
}

/**
 * Whether retrieval contributed to an answer.
 *
 * This exists so an ungrounded answer cannot be mistaken for a sourced one. Today
 * a failed search is a log line: the model is called with no context and the
 * answer arrives looking exactly like a sourced one.
 */
export type RetrievalStatus = 'used' | 'none' | 'failed'

/**
 * The structured part of `chat_messages.metadata`.
 *
 * The column is an open JSON bag, so the index signature is honest rather than a
 * workaround: anything else a future feature stores here survives a round-trip.
 * Everything a reader depends on is parsed defensively — see
 * `shared/utils/answerSources.ts` — because the contents come from the database
 * and may predate this shape.
 */
export interface ChatMessageMetadata {
  sources?: AnswerSource[]
  retrieval?: RetrievalStatus
  [key: string]: unknown
}

/**
 * 聊天消息接口（完整版）
 * 基于 Drizzle 推导的数据库类型,并添加前端扩展字段
 */
export interface ChatMessage extends Omit<DBChatMessage, 'metadata' | 'reasoningContent'> {
  notebookId?: string // 前端扩展字段，用于并发消息管理
  reasoningContent?: string | null // 可选的推理内容字段
  metadata?: ChatMessageMetadata
  isStreaming?: boolean // 前端扩展字段，标识流式消息
  isReasoningStreaming?: boolean // 前端扩展字段，推理过程是否在流式传输
}

/**
 * API 消息格式（用于与 LLM Provider 通信）
 * 这是简化版本，只包含 API 需要的字段
 */
export interface APIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning_content?: string // DeepSeek Reasoner 特有字段
}

/**
 * 流式响应片段
 */
export interface StreamChunk {
  content: string
  reasoningContent?: string // DeepSeek Reasoner 推理过程内容
  done: boolean
  reasoningDone?: boolean // 推理过程是否完成
  metadata?: {
    model?: string
    finishReason?: string
    usage?: {
      promptTokens?: number
      completionTokens?: number
      totalTokens?: number
    }
    // 推理相关元数据（AI SDK v5 推理流式传输）
    isReasoning?: boolean // 当前内容是否为推理过程
    reasoningStart?: boolean // 推理块开始标记
    reasoningEnd?: boolean // 推理块结束标记
    reasoningId?: string // 推理块 ID
  }
}
