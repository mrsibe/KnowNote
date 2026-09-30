import { ipcMain, IpcMainInvokeEvent } from 'electron'
import * as queries from '../db/queries'
import { ConnectionManager } from '../models/ConnectionManager'
import type { SessionAutoSwitchService } from '../services/SessionAutoSwitchService'
import { KnowledgeService, toSearchResults } from '../services/KnowledgeService'
import { buildRAGContext } from '../services/citations'
import { ChatStreamManager, CONTINUE_INSTRUCTION } from '../services/chat/ChatStreamManager'
import type { ChatTurnEvent } from '../../shared/types/chat'
import { queriesTurnStore } from '../services/chat/turnStore'
import { validateAndCleanMessages } from '../utils/messageValidator'
import Logger from '../../shared/utils/logger'
import { settingsManager } from '../config'
import type { AnswerSource, RetrievalSnapshot, RetrievalStatus } from '../../shared/types/chat'
import type { Citation, CitationContext } from '../../shared/types/citation'
import { parseRetrievalScope, scopeDocumentIds } from '../../shared/types/scope'
import { ChatSchemas, validate } from './validation'

/**
 * What a continuation is asked for.
 *
 * The constant itself is `ChatStreamManager`'s: automatic continuation (#179) and
 * this manual path must ask for exactly the same thing.
 */
const CONTINUE_MESSAGE = CONTINUE_INSTRUCTION

/**
 * The renderer's view of a running turn: one channel, one shape.
 */
const TURN_EVENT_CHANNEL = 'chat:turn-event'

/**
 * How many continuations one answer may spend, and whether a truncated one is
 * continued automatically (#179).
 *
 * The manual「继续生成」chain and automatic continuation share the same bound, so a
 * setting of 2 means "two more pieces of this answer", however they were asked for.
 */
function continuationSettings(): { limit: number; auto: boolean } {
  const configured = settingsManager.getSettingSync('maxAutoContinueAttempts')
  const limit = typeof configured === 'number' && configured > 0 ? Math.floor(configured) : 0
  const auto = settingsManager.getSettingSync('autoContinueOnTruncation') === true
  return { limit, auto }
}

/** How many continuations the persisted metadata says this answer already spent. */
function continuationsSpent(metadata: unknown): number {
  const value = (metadata as { continuations?: unknown } | null | undefined)?.continuations
  return typeof value === 'number' && value > 0 ? Math.floor(value) : 0
}

/**
 * Register chat-related IPC Handlers
 */
export function registerChatHandlers(
  connectionManager: ConnectionManager,
  sessionAutoSwitchService: SessionAutoSwitchService,
  knowledgeService: KnowledgeService
) {
  // The Main process owns every running turn (#140). This handler assembles the
  // prompt and hands the turn over; the lifecycle, the persistence and the
  // notifications belong to the manager.
  const streamManager = new ChatStreamManager({
    store: queriesTurnStore,
    sessionAutoSwitchService
  })

  /**
   * Retrieval for one question, in the shape every turn needs (#151: three callers).
   *
   * RAG only when an embedding backend is available — a remote connection or the
   * built-in local model — and a failed search never blocks the answer: it is recorded
   * as `failed`, so an ungrounded answer stays distinguishable from a grounded one.
   */
  const retrieve = async (
    notebookId: string | undefined,
    query: string,
    documentIds?: string[]
  ): Promise<{
    retrieval: RetrievalStatus
    sources: AnswerSource[]
    citations: Citation[]
    citationContexts: CitationContext[]
    context: string
    retrievalSnapshot?: RetrievalSnapshot
  }> => {
    const empty = {
      retrieval: 'none' as RetrievalStatus,
      sources: [] as AnswerSource[],
      citations: [] as Citation[],
      citationContexts: [] as CitationContext[],
      context: ''
    }

    try {
      if (!notebookId || !(await knowledgeService.isEmbeddingAvailable())) {
        Logger.debug('ChatHandlers', 'RAG disabled: no embedding backend or notebook')
        return empty
      }

      // 直接走 `retrieve()` 而不是 `search()`：trace（#157）只有它有，用它再映射出
      // SearchResult，不必为了记录参数多检索一次。
      const { evidence, trace } = await knowledgeService.retrieve({
        notebookId,
        query,
        topK: 3,
        threshold: 0.5,
        filter: documentIds ? { documentIds } : undefined
      })

      const searchResults = toSearchResults(evidence)
      if (searchResults.length === 0) {
        // 没有结果也是一个可解释的结果：scope、topK、耗时仍然有意义。
        return { ...empty, retrievalSnapshot: trace }
      }

      const { context, sources, citations, citationContexts } = buildRAGContext(searchResults)
      Logger.debug('ChatHandlers', `RAG: Found ${searchResults.length} relevant chunks for query`)

      return {
        retrieval: 'used',
        sources,
        citations,
        // The citation's own candidate span is what a quote is checked against (#70),
        // built from the candidate, not re-derived from the chunk (#155).
        citationContexts,
        context,
        retrievalSnapshot: trace
      }
    } catch (error) {
      // A failed search must not block the answer; it changes what the answer is.
      Logger.warn('ChatHandlers', 'RAG search failed:', error)
      return { ...empty, retrieval: 'failed' }
    }
  }

  /**
   * The prompt for a turn that answers an existing question again (#151).
   *
   * Rebuilt from the session rather than remembered: the history up to and including
   * the question, so a retry asks the same thing in the same context instead of
   * continuing a conversation that has moved on.
   */
  const replayPrompt = async (target: {
    id: string
    sessionId: string
    attemptOf?: string | null
  }) => {
    const history = queries.getMessagesBySession(target.sessionId)
    const index = history.findIndex((message) => message.id === target.id)
    if (index < 1) return null

    // Start from the *question*, not from this attempt: re-asking what the previous
    // attempt already said would turn a retry into a continuation of a failed answer.
    const rootId = target.attemptOf ?? target.id
    const rootIndex = history.findIndex((message) => message.id === rootId)
    const upToQuestion = history.slice(0, rootIndex === -1 ? index : rootIndex)
    const question = upToQuestion.findLast((message) => message.role === 'user')
    if (!question) return null

    let messages = upToQuestion.map((message) => ({
      role: message.role,
      content: message.content
    }))
    messages = validateAndCleanMessages(messages)
    if (messages.length === 0) return null

    const session = queries.getSessionById(target.sessionId)
    const documentIds = scopeDocumentIds(parseRetrievalScope(session?.retrievalScope))
    const retrieved = await retrieve(session?.notebookId, question.content, documentIds)
    if (retrieved.context) messages.unshift({ role: 'system', content: retrieved.context })

    return { messages, question: question.content, session, retrieved }
  }

  // ==================== Chat Session ====================
  // A notebook holds many sessions (#97). Creating one always starts from a
  // placeholder title; the first message names it, and a manual rename wins.
  ipcMain.handle(
    'create-chat-session',
    validate(ChatSchemas.createSession, async (args) => {
      // A caller that already has a name keeps it; an empty one is named by the
      // first message (a `.trim()` guard, so a whitespace title does not count).
      return queries.createSession(args.notebookId, args.title, {
        titleIsAuto: !args.title.trim()
      })
    })
  )

  ipcMain.handle(
    'get-chat-sessions',
    validate(ChatSchemas.getChatSessions, async (args) => {
      return queries.getSessionsByNotebook(args.notebookId)
    })
  )

  // Opening a notebook returns to the last session the user had open (#97).
  ipcMain.handle(
    'get-active-session',
    validate(ChatSchemas.getActiveSession, async (args) => {
      return queries.getMostRecentSessionByNotebook(args.notebookId)
    })
  )

  // Switching sessions is what "last used" means; recording it is what keeps the
  // session list ordered by use rather than by last message.
  ipcMain.handle(
    'touch-session',
    validate(ChatSchemas.touchSession, async (args) => {
      queries.touchSession(args.sessionId)
      return { success: true }
    })
  )

  ipcMain.handle(
    'search-messages',
    validate(ChatSchemas.searchMessages, async (args) => {
      return queries.searchMessagesInNotebook(args.notebookId, args.query.trim(), args.limit)
    })
  )

  ipcMain.handle(
    'update-session-title',
    validate(ChatSchemas.updateSessionTitle, async (args) => {
      queries.updateSessionTitle(args.sessionId, args.title)
      return { success: true }
    })
  )

  ipcMain.handle(
    'set-chat-session-scope',
    validate(ChatSchemas.setRetrievalScope, async (args) => {
      queries.updateSessionRetrievalScope(args.sessionId, args.scope)
      return { success: true }
    })
  )

  ipcMain.handle(
    'delete-session',
    validate(ChatSchemas.deleteSession, async (args) => {
      queries.deleteSession(args.sessionId)
      return { success: true }
    })
  )

  // ==================== Chat Message ====================
  ipcMain.handle(
    'get-messages',
    validate(ChatSchemas.getMessages, async (args) => {
      return queries.getMessagesBySession(args.sessionId)
    })
  )

  ipcMain.handle('send-message', async (event: IpcMainInvokeEvent, ...args: any[]) => {
    // 验证参数
    if (args.length === 0) {
      throw new Error('IPC 调用缺少参数')
    }
    if (args.length > 1) {
      throw new Error(`IPC 调用参数错误: 期望传递单个对象参数，但收到 ${args.length} 个参数`)
    }

    const validatedArgs = ChatSchemas.sendMessage.parse(args[0])
    const { sessionId, content } = validatedArgs

    // 1. 保存用户消息
    queries.createMessage(sessionId, 'user', content)

    // 1.1 第一条消息给会话命名（#97）。放在保存之后：标题来自刚写下的那句话。
    queries.deriveSessionTitleIfAuto(sessionId, content)

    const session = queries.getSessionById(sessionId)

    // 2. 这一轮要发给模型的上下文
    const history = queries.getMessagesBySession(sessionId)
    let messages = history.map((m: any) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content
    }))

    // 2.1 通用消息清理（过滤空消息和无效格式）。清空之后这一轮仍然是一次失败的 turn，
    //     由 manager 落库成 failed；handler 不再自己判定终态。
    messages = validateAndCleanMessages(messages)

    // 3. 检索：注入上下文，并把「这条回答基于什么」一并记下来（#69/#70）。
    //    scope 属于 session（#94）：这次问题用哪些来源回答，而不是整个 notebook。
    const documentIds = scopeDocumentIds(parseRetrievalScope(session?.retrievalScope))
    const retrieved = await retrieve(session?.notebookId, content, documentIds)
    if (retrieved.context) {
      // 将 RAG 上下文作为 system message 插入到消息列表开头
      messages.unshift({ role: 'system', content: retrieved.context })
    }

    // 4. 这一轮交给 ChatStreamManager（#140）。生命周期、唯一终态、落库与通知都在那里；
    //    handler 只负责把 prompt 和检索结果准备好。
    const client = await connectionManager.getChatClient()
    const continuations = continuationSettings()
    const execution = streamManager.start({
      sessionId,
      notebookId: session?.notebookId,
      userContent: content,
      messages,
      client,
      retrieval: retrieved.retrieval,
      sources: retrieved.sources,
      citations: retrieved.citations,
      citationContexts: retrieved.citationContexts,
      retrievalSnapshot: retrieved.retrievalSnapshot,
      continuations: 0,
      ...(continuations.auto && continuations.limit > 0
        ? { autoContinue: { limit: continuations.limit } }
        : {}),
      emit: (turnEvent: ChatTurnEvent) => event.sender.send(TURN_EVENT_CHANNEL, turnEvent)
    })

    // Return messageId immediately so frontend can continue
    return execution.messageId
  })

  // ==================== Abort Message ====================
  ipcMain.handle(
    'abort-message',
    validate(ChatSchemas.abortMessage, async (args) => {
      if (streamManager.abort(args.messageId, 'user')) {
        Logger.info('ChatHandlers', `Aborted message: ${args.messageId}`)
        return { success: true }
      }

      Logger.warn('ChatHandlers', `No active stream found for message: ${args.messageId}`)
      return { success: false, reason: 'No active stream found' }
    })
  )

  // ==================== Retry / Continue ====================
  /**
   * Answer the same question again, as a sibling of the answer that stopped (#151).
   *
   * A new row, pointing at the *first* attempt of the group, so a third attempt joins
   * the same group rather than nesting under the second, and the reader can still tell
   * which answers are the same question asked again.
   */
  ipcMain.handle('retry-message', async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (args.length === 0) throw new Error('IPC 调用缺少参数')
    if (args.length > 1) {
      throw new Error(`IPC 调用参数错误: 期望传递单个对象参数，但收到 ${args.length} 个参数`)
    }

    const { messageId } = ChatSchemas.retryMessage.parse(args[0])
    const target = queries.getMessageById(messageId)
    if (!target) return { success: false, error: 'Message not found' }

    const prompt = await replayPrompt(target)
    if (!prompt) return { success: false, error: 'Nothing to retry' }

    const client = await connectionManager.getChatClient()
    const continuations = continuationSettings()
    const execution = streamManager.start({
      sessionId: target.sessionId,
      notebookId: prompt.session?.notebookId,
      attemptOf: target.attemptOf ?? target.id,
      userContent: prompt.question,
      messages: prompt.messages,
      client,
      retrieval: prompt.retrieved.retrieval,
      sources: prompt.retrieved.sources,
      citations: prompt.retrieved.citations,
      citationContexts: prompt.retrieved.citationContexts,
      retrievalSnapshot: prompt.retrieved.retrievalSnapshot,
      // A sibling is a fresh answer, so its continuation budget restarts (#179).
      continuations: 0,
      ...(continuations.auto && continuations.limit > 0
        ? { autoContinue: { limit: continuations.limit } }
        : {}),
      emit: (turnEvent: ChatTurnEvent) => event.sender.send(TURN_EVENT_CHANNEL, turnEvent)
    })

    return { success: true, messageId: execution.messageId }
  })

  /**
   * Continue an answer that stopped, into the same message (#151).
   *
   * The part that arrived seeds the new turn on both sides — here and in the renderer
   * — so the message grows rather than being replaced by its continuation.
   */
  ipcMain.handle('continue-message', async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (args.length === 0) throw new Error('IPC 调用缺少参数')
    if (args.length > 1) {
      throw new Error(`IPC 调用参数错误: 期望传递单个对象参数，但收到 ${args.length} 个参数`)
    }

    const { messageId } = ChatSchemas.continueMessage.parse(args[0])
    const target = queries.getMessageById(messageId)
    if (!target) return { success: false, error: 'Message not found' }

    const continuations = continuationSettings()
    const spent = continuationsSpent(target.metadata)
    // The bound is checked here as well as in the manager (#179): a manual chain
    // must not be able to loop past the setting, however many times it is asked.
    if (continuations.limit <= 0 || spent >= continuations.limit) {
      return {
        success: false,
        reason: 'continuation-limit' as const,
        error: `This answer has reached its continuation limit (${continuations.limit})`
      }
    }

    const prompt = await replayPrompt(target)
    if (!prompt) return { success: false, error: 'Nothing to continue' }

    const client = await connectionManager.getChatClient()
    const execution = streamManager.start({
      sessionId: target.sessionId,
      notebookId: prompt.session?.notebookId,
      resume: {
        messageId: target.id,
        text: target.content,
        reasoning: target.reasoningContent ?? ''
      },
      userContent: prompt.question,
      // This continuation is being spent now, so the count this turn records is the
      // one already spent plus this one (#179).
      continuations: spent + 1,
      ...(continuations.auto && continuations.limit > 0
        ? { autoContinue: { limit: continuations.limit } }
        : {}),
      messages: [
        ...prompt.messages,
        // What had been written, then the instruction to carry on from it.
        { role: 'assistant', content: target.content },
        { role: 'user', content: CONTINUE_MESSAGE }
      ],
      client,
      retrieval: prompt.retrieved.retrieval,
      sources: prompt.retrieved.sources,
      citations: prompt.retrieved.citations,
      citationContexts: prompt.retrieved.citationContexts,
      retrievalSnapshot: prompt.retrieved.retrievalSnapshot,
      emit: (turnEvent: ChatTurnEvent) => event.sender.send(TURN_EVENT_CHANNEL, turnEvent)
    })

    return { success: true, messageId: execution.messageId }
  })
}
