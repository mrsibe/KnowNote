import { ipcMain, IpcMainInvokeEvent } from 'electron'
import * as queries from '../db/queries'
import { ConnectionManager } from '../models/ConnectionManager'
import { SessionAutoSwitchService } from '../services/SessionAutoSwitchService'
import { KnowledgeService } from '../services/KnowledgeService'
import { buildRAGContext } from '../services/citations'
import { validateAndCleanMessages } from '../utils/messageValidator'
import Logger from '../../shared/utils/logger'
import { resolveCitations } from '../../shared/utils/citationResolution'
import {
  abortedOutcome,
  classifyTerminal,
  failedOutcome,
  settleOutcome
} from '../../shared/utils/chatExecution'
import type {
  AnswerSource,
  ChatExecutionOutcome,
  ChatMessageMetadata,
  ChatTokenUsage,
  RetrievalStatus
} from '../../shared/types/chat'
import type { Citation, CitationContext } from '../../shared/types/citation'
import { ChatSchemas, validate } from './validation'

// 管理活跃的流式请求
const activeStreams = new Map<string, AbortController>()

/**
 * Register chat-related IPC Handlers
 */
export function registerChatHandlers(
  connectionManager: ConnectionManager,
  sessionAutoSwitchService: SessionAutoSwitchService,
  knowledgeService: KnowledgeService
) {
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

    // 2. 创建 assistant 消息行。这一行同时就是这一轮的记录（epic #138）：回合开始时
    //    建立并标记 streaming，结束时写下唯一的终态。
    const assistantMessage = queries.createMessage(
      sessionId,
      'assistant',
      '',
      undefined,
      'streaming'
    )

    // 3. 获取历史消息作为上下文
    const history = queries.getMessagesBySession(sessionId)
    let messages = history.map((m: any) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content
    }))

    // 3.1 通用消息清理（过滤空消息和无效格式）
    messages = validateAndCleanMessages(messages)

    // ---- 这一轮的状态：一个回合恰好一个终态（epic #138） -------------------------
    let fullTextContent = ''
    let fullReasoningContent = ''
    let usage: ChatTokenUsage | undefined
    // 元数据要等检索之后才算得出来。早于检索的失败路径不写 metadata，
    // 而不是往库里写一个空的。
    let resolvedMetadata: ChatMessageMetadata | undefined

    /**
     * 这一轮唯一的决策点。
     *
     * 一个流可能送来好几个看起来像终态的信号：`error` part 之后跟着正常的 `finish`
     * （SDK 在 error 之后仍然会继续送），或者一个合法的 `finish` 之后跟着传输层清理
     * 阶段的异常。第一个才是这一轮的结论；后面那些是结论之后的噪音，把它们提上来
     * 会把读者已经拿到的回答重新定性。
     *
     * @returns null 表示这一轮已经结束，这个信号必须忽略
     */
    let outcome: ChatExecutionOutcome | undefined
    const settle = (next: ChatExecutionOutcome): ChatExecutionOutcome | null => {
      const settled = settleOutcome(outcome, next)
      if (settled === outcome) return null
      outcome = settled
      return settled
    }

    /**
     * 所有结束方式都经过这里，顺序固定：先落库，再告诉 renderer（epic #138 invariant 4）。
     * renderer 先收到「完成」而数据库写失败，等于界面宣称一个数据库里并不存在的回合。
     */
    const finishTurn = (settled: ChatExecutionOutcome, finishReason?: string): void => {
      activeStreams.delete(assistantMessage.id)

      queries.updateMessageContent(assistantMessage.id, fullTextContent, fullReasoningContent)
      if (resolvedMetadata) {
        queries.updateMessageMetadata(assistantMessage.id, resolvedMetadata)
      }
      queries.finishMessageTurn(assistantMessage.id, settled, finishReason, usage)

      void accountTurnTokens(settled)
      announceOutcome(settled, finishReason)
    }

    /** 回合结束后才做的事：token 记账与会话自动切换。失败只记日志，不影响终态。 */
    const accountTurnTokens = async (settled: ChatExecutionOutcome): Promise<void> => {
      try {
        // 优先用 provider 报的用量；没有就估算（半截回答也是真的花了 token）
        const tokensUsed =
          usage?.totalTokens ??
          SessionAutoSwitchService.estimateTokens(content) +
            SessionAutoSwitchService.estimateTokens(fullTextContent)

        Logger.debug(
          'ChatHandlers',
          `Tokens used in this conversation: ${tokensUsed} (${settled.status})`
        )

        const newSessionId = await sessionAutoSwitchService.recordTokenUsageAndCheckSwitch(
          sessionId,
          tokensUsed
        )

        if (newSessionId) {
          event.sender.send('session-auto-switched', {
            oldSessionId: sessionId,
            newSessionId: newSessionId
          })
        }
      } catch (error) {
        Logger.error('ChatHandlers', 'Error while recording turn tokens:', error)
      }
    }

    /**
     * 终态落库之后才通知 renderer。
     *
     * `aborted` 不通知：停止是 renderer 自己发起的，它当时就已经把流式状态清掉了，
     * 再送一个终态是它没有要求的第二次状态变更。落库的 status 留给重载路径（#142）。
     */
    const announceOutcome = (settled: ChatExecutionOutcome, finishReason?: string): void => {
      if (settled.status === 'failed') {
        event.sender.send('message-error', {
          messageId: assistantMessage.id,
          error: settled.error.message
        })
        return
      }

      if (settled.status === 'aborted') return

      event.sender.send('message-chunk', {
        messageId: assistantMessage.id,
        type: 'finish',
        // 这一个 chunk 的 metadata 没有任何读取方（renderer 只读 `messageMetadata`），
        // 所以只带终态原因与用量；provider 的事实另有 finish_reason 列。
        metadata: { finishReason, usage },
        // The renderer's in-memory message never sees the DB row written before
        // streaming, so the persisted provenance rides along here or the answer
        // loses its citations until the session is reloaded.
        messageMetadata: resolvedMetadata
      })
    }

    // 验证清理后是否还有有效消息
    if (messages.length === 0) {
      const settled = settle(failedOutcome('No valid conversation history', 'error'))
      if (settled) finishTurn(settled)
      return assistantMessage.id
    }

    // 3.2 RAG 增强：检索相关知识并注入上下文
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
        const session = queries.getSessionById(sessionId)
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

    const answerMetadata: ChatMessageMetadata = {
      ...(assistantMessage.metadata ?? {}),
      retrieval,
      sources: answerSources,
      citations: answerCitations
    }
    queries.updateMessageMetadata(assistantMessage.id, answerMetadata)
    // Rewritten at the end of the stream, once the answer text exists and its
    // `[n]` markers can be resolved against the evidence.
    resolvedMetadata = answerMetadata

    // 4. 调用 Model Connection 流式生成
    const client = await connectionManager.getChatClient()
    if (!client) {
      const settled = settle(
        failedOutcome('Chat model not configured, please configure in settings', 'error')
      )
      if (settled) finishTurn(settled)
      return assistantMessage.id
    }

    // 调用 ModelClient 流式生成,获取 AbortController（基于 AI SDK fullStream）
    const abortController = await client.sendMessageStream(messages, {
      // onChunk - 处理 AI SDK fullStream 的各种 part 类型
      onChunk: (chunk) => {
        const { metadata, content, done } = chunk

        // 1. 推理块开始
        if (metadata?.reasoningStart) {
          event.sender.send('message-chunk', {
            messageId: assistantMessage.id,
            type: 'reasoning-start',
            reasoningId: metadata.reasoningId
          })
        }
        // 2. 推理增量内容
        else if (metadata?.isReasoning) {
          fullReasoningContent += content

          event.sender.send('message-chunk', {
            messageId: assistantMessage.id,
            type: 'reasoning-delta',
            content: content,
            reasoningId: metadata.reasoningId
          })
        }
        // 3. 推理块结束
        else if (metadata?.reasoningEnd) {
          event.sender.send('message-chunk', {
            messageId: assistantMessage.id,
            type: 'reasoning-end',
            reasoningId: metadata.reasoningId
          })
        }
        // 4. 普通文本内容（text-delta）
        else if (content) {
          fullTextContent += content

          event.sender.send('message-chunk', {
            messageId: assistantMessage.id,
            type: 'text-delta',
            content: content
          })
        }

        if (!done) return

        // 5. 终态信号。只有当 provider 明确说出它结束了，这一轮才算结束：
        //    `for await` 跑完本身什么都证明不了（epic #138 invariant 1）。
        usage = metadata?.usage
        const finishReason = metadata?.finishReason
        const settled = settle(classifyTerminal(finishReason))
        // 已经结束过（例如 error part 先到）：这个信号只是结论之后的噪音
        if (!settled) return

        // An answer that marked sources gets only the grounded ones: a
        // fabricated `[9]` or a quote that is not in its span must not survive
        // as a clickable source (#70). With no markers at all, keep the full
        // evidence set — the model simply did not use the marker convention.
        const resolution = resolveCitations(fullTextContent, citationContexts)
        resolvedMetadata = answerMetadata

        if (finishReason !== undefined) {
          // #137 的副本来着：流式中的那条消息只能从 metadata 读到原因，
          // renderer 要靠它显示“被输出上限截断”。#142 把终态搬上协议之后，
          // 这个副本就不再需要了。
          resolvedMetadata = { ...resolvedMetadata, finishReason }
        }

        if (resolution.matches.length > 0) {
          const grounded: Citation[] = []
          for (const match of resolution.resolved) {
            if (match.citation) grounded.push(match.citation)
          }
          resolvedMetadata = { ...resolvedMetadata, citations: grounded }
        }

        finishTurn(settled, finishReason)
      },
      onError: (error, reason) => {
        const settled = settle(failedOutcome(error.message, reason))
        if (!settled) return
        finishTurn(settled)
      },
      onAbort: () => {
        const settled = settle(abortedOutcome('user'))
        if (!settled) return
        finishTurn(settled)
      }
    })

    // 存储 AbortController
    activeStreams.set(assistantMessage.id, abortController)

    // Return messageId immediately so frontend can continue
    return assistantMessage.id
  })

  // ==================== Abort Message ====================
  ipcMain.handle(
    'abort-message',
    validate(ChatSchemas.abortMessage, async (args) => {
      const controller = activeStreams.get(args.messageId)

      if (controller) {
        Logger.info('ChatHandlers', `Aborting message: ${args.messageId}`)
        controller.abort()
        return { success: true }
      } else {
        Logger.warn('ChatHandlers', `No active stream found for message: ${args.messageId}`)
        return { success: false, reason: 'No active stream found' }
      }
    })
  )
}
