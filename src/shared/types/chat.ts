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
import type { Citation } from './citation'
import type { UIMessageChunk } from 'ai'

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
 * How a turn ended, in KnowNote's vocabulary.
 *
 * Deliberately not the provider's `finishReason`: that value is a fact about the
 * model call, this one is what the product says happened to the turn, and the
 * transcript renders from it. They are stored as two fields because a provider
 * can end a turn in a way the product has to explain (`length` is a completion
 * whose answer is incomplete, not a failure) and because a turn can end without
 * the provider saying anything at all (a dropped connection).
 *
 * `null` on a stored message means the turn predates this field: unknown, which
 * is not the same statement as `completed`.
 */
export type ChatExecutionStatus =
  'pending' | 'streaming' | 'completed' | 'truncated' | 'blocked' | 'aborted' | 'failed'

/** Only the statuses a turn can settle on; a turn cannot *end* in `pending` / `streaming`. */
export type TerminalChatExecutionStatus = Exclude<ChatExecutionStatus, 'pending' | 'streaming'>

/**
 * A failure the transcript can show. Only a message for now: classifying the
 * error (`auth` / `rate_limit` / `timeout` …) only matters once something acts on
 * it, which is the reliability work (#143).
 */
export interface ChatExecutionError {
  message: string
}

/**
 * The single terminal statement about a turn.
 *
 * `reason` on `failed` says where it came from, which is the difference between
 * "the provider told us it failed" and "the stream ended and nobody said
 * anything" — the case the old code could not tell apart from success.
 */
export type ChatExecutionOutcome =
  | { status: 'completed' }
  | { status: 'truncated' }
  | { status: 'blocked' }
  | { status: 'aborted'; reason: 'user' | 'shutdown' }
  | { status: 'failed'; error: ChatExecutionError; reason: 'error' | 'throw' | 'unexpected_eof' }

/** Token accounting for one turn. Fields are optional because providers omit them. */
export interface ChatTokenUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/**
 * One event of a running turn, as it crosses the process boundary.
 *
 * The `chunk` variant carries the AI SDK's own UI event **verbatim**: a reduced
 * protocol of our own (`text-delta | reasoning-delta | finish`) is what made an
 * `error` part silently disappear (#137) and what made every future SDK event type
 * another silent drop. Only the three chunks that *end* a turn are not forwarded —
 * `finish`, `error`, `abort` — because the manager owns the terminal statement and
 * emits `outcome` for them after the turn is persisted (#138 invariant 4) and
 * everything they carried (reason, error message, status) is on that event.
 *
 * `seq` is monotonic per execution, so a consumer can tell a delivered stream from
 * a stream with a hole in it.
 */
export type ChatTurnEvent =
  | {
      type: 'chunk'
      executionId: string
      messageId: string
      seq: number
      event: UIMessageChunk
    }
  | {
      type: 'outcome'
      executionId: string
      messageId: string
      seq: number
      outcome: ChatExecutionOutcome
      /** The provider's own terminal reason, when it named one. */
      finishReason?: string
      usage?: ChatTokenUsage
      /** The provenance the renderer's in-memory message has not seen yet. */
      messageMetadata: ChatMessageMetadata
    }
  /** Not about one turn's stream, but it is a turn's ending that triggers it. */
  | { type: 'session-auto-switched'; sessionId: string; newSessionId: string }

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
  /**
   * The structured provenance of this answer (#69). `sources` says *what* the
   * answer was built from; `citations` says *where* in the source each marker
   * points. Both are snapshots written when the answer was produced.
   */
  citations?: Citation[]
  /**
   * Why the model stopped, as the provider reported it (`stop`, `length`, …).
   *
   * `length` is the one the reader depends on: it means the output ceiling ended
   * the answer, so what arrived is not the whole of it. Absent on messages
   * written before the field existed — unknown, which is not the same statement
   * as "finished".
   */
  finishReason?: string
  /** Token accounting, carried on the terminal chunk because the SDK emits no
   * chunk of its own for it. */
  usage?: ChatTokenUsage
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
