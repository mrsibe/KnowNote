import { ipcMain, IpcMainInvokeEvent } from 'electron'
import * as queries from '../db/queries'
import { ConnectionManager } from '../models/ConnectionManager'
import type { SessionAutoSwitchService } from '../services/SessionAutoSwitchService'
import { KnowledgeService } from '../services/KnowledgeService'
import { buildRAGContext } from '../services/citations'
import { ChatStreamManager } from '../services/chat/ChatStreamManager'
import type { ChatTurnEvent } from '../../shared/types/chat'
import { queriesTurnStore } from '../services/chat/turnStore'
import { validateAndCleanMessages } from '../utils/messageValidator'
import Logger from '../../shared/utils/logger'
import type { AnswerSource, RetrievalStatus } from '../../shared/types/chat'
import type { Citation, CitationContext } from '../../shared/types/citation'
import { ChatSchemas, validate } from './validation'

/**
 * One channel carries everything a turn has to say.
 *
 * The event goes over as it is: the envelope already carries the identity and the
 * sequence, and its payload is the SDK's own event, which this layer has no business
 * reading — that is what made the old reduced protocol drop events it did not know
 * (#141).
 */
const TURN_EVENT_CHANNEL = 'chat:turn-event'

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

  // ==================== Chat Session ====================
  ipcMain.handle(
    'create-chat-session',
    validate(ChatSchemas.createSession, async (args) => {
      return queries.createSession(args.notebookId, args.title)
    })
  )

  ipcMain.handle(
    'get-chat-sessions',
    validate(ChatSchemas.getChatSessions, async (args) => {
      return queries.getSessionsByNotebook(args.notebookId)
    })
  )

  ipcMain.handle(
    'get-active-session',
    validate(ChatSchemas.getActiveSession, async (args) => {
      return queries.getActiveSessionByNotebook(args.notebookId)
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

    // 3. RAG 增强：检索相关知识并注入上下文
    // 只要 embedding 后端可用就启用 RAG（远程 connection 或内置本地模型）。
    // 以前这里用 `getEmbeddingClient()` 判断，它只认远程 connection，本地模型
    // 直接返回 null —— 于是默认配置下 RAG 被静默关闭，回答无依据也无引用。
    // 检索结果同时记录到消息上：以前检索失败只留一行日志，
    // 于是「没有依据的回答」和「有依据的回答」在界面上完全无法区分。
    let retrieval: RetrievalStatus = 'none'
    let answerSources: AnswerSource[] = []
    let answerCitations: Citation[] = []
    let citationContexts: CitationContext[] = []
    try {
      if (await knowledgeService.isEmbeddingAvailable()) {
        if (session?.notebookId) {
          const searchResults = await knowledgeService.search(session.notebookId, content, {
            topK: 3,
            threshold: 0.5
          })

          if (searchResults.length > 0) {
            const { context, sources, citations } = buildRAGContext(searchResults)
            retrieval = 'used'
            answerSources = sources
            answerCitations = citations
            // The span a quote is checked against lives only in the locator, so
            // carry it alongside the citation for validation (#70).
            citationContexts = citations.map((citation, index) => ({
              citation,
              spanText: searchResults[index].locator.blocks.map((block) => block.text).join('\n')
            }))
            Logger.debug(
              'ChatHandlers',
              `RAG: Found ${searchResults.length} relevant chunks for query`
            )

            // 将 RAG 上下文作为 system message 插入到消息列表开头
            messages.unshift({
              role: 'system',
              content: context
            })
          }
        }
      } else {
        Logger.debug('ChatHandlers', 'RAG disabled: no embedding backend available')
      }
    } catch (error) {
      // RAG 失败不应该阻止对话
      retrieval = 'failed'
      Logger.warn('ChatHandlers', 'RAG search failed:', error)
    }

    // 4. 这一轮交给 ChatStreamManager（#140）。生命周期、唯一终态、落库与通知都在那里；
    //    handler 只负责把 prompt 和检索结果准备好。
    const client = await connectionManager.getChatClient()
    const execution = streamManager.start({
      sessionId,
      notebookId: session?.notebookId,
      userContent: content,
      messages,
      client,
      retrieval,
      sources: answerSources,
      citations: answerCitations,
      citationContexts,
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
}
