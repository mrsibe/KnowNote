import { ipcMain, IpcMainInvokeEvent } from 'electron'
import * as queries from '../db/queries'
import { ConnectionManager } from '../models/ConnectionManager'
import { SessionAutoSwitchService } from '../services/SessionAutoSwitchService'
import { KnowledgeService, type SearchResult } from '../services/KnowledgeService'
import { validateAndCleanMessages } from '../utils/messageValidator'
import Logger from '../../shared/utils/logger'
import type { AnswerSource, RetrievalStatus } from '../../shared/types/chat'
import { ChatSchemas, validate } from './validation'

// 管理活跃的流式请求
const activeStreams = new Map<string, AbortController>()

/**
 * 构建 RAG 上下文 prompt，并把「这段回答基于哪些段落」一起交出来。
 *
 * 之前这里只取 `documentTitle` / `content` / `score` 三个字段，
 * `chunkId`、`documentId`、`chunkIndex` 全部被丢掉 —— 于是回答交付之后，
 * 界面上再也没有回到原文的路。prompt 文本保持不变，这里只是不再丢弃身份。
 */
function buildRAGContext(searchResults: SearchResult[]): {
  context: string
  sources: AnswerSource[]
} {
  if (searchResults.length === 0) return { context: '', sources: [] }

  const sources: AnswerSource[] = searchResults.map((result, index) => ({
    index: index + 1,
    documentId: result.documentId,
    documentTitle: result.documentTitle,
    documentType: result.documentType,
    chunkId: result.chunkId,
    chunkIndex: result.chunkIndex,
    content: result.content,
    score: result.score
  }))

  const contextParts = sources.map(
    (source) => `[来源 ${source.index}: ${source.documentTitle}]\n${source.content}`
  )

  const context = `以下是与用户问题相关的背景知识，请参考这些信息来回答：

${contextParts.join('\n\n---\n\n')}

请基于以上背景知识回答用户的问题。如果背景知识不足以回答问题，请说明并尽力提供有帮助的回答。`

  return { context, sources }
}

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

    // 2. 创建 assistant 消息占位符
    const assistantMessage = queries.createMessage(sessionId, 'assistant', '')

    // 3. 获取历史消息作为上下文
    const history = queries.getMessagesBySession(sessionId)
    let messages = history.map((m: any) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content
    }))

    // 3.1 通用消息清理（过滤空消息和无效格式）
    messages = validateAndCleanMessages(messages)

    // 验证清理后是否还有有效消息
    if (messages.length === 0) {
      event.sender.send('message-error', {
        messageId: assistantMessage.id,
        error: 'No valid conversation history'
      })
      return assistantMessage.id
    }

    // 3.2 RAG 增强：检索相关知识并注入上下文
    // 只有在配置了 embedding connection 时才启用 RAG。
    // 检索结果同时记录到消息上：以前检索失败只留一行日志，
    // 于是「没有依据的回答」和「有依据的回答」在界面上完全无法区分。
    let retrieval: RetrievalStatus = 'none'
    let answerSources: AnswerSource[] = []
    try {
      const embeddingClient = await connectionManager.getEmbeddingClient()

      if (embeddingClient) {
        const session = queries.getSessionById(sessionId)
        if (session?.notebookId) {
          const searchResults = await knowledgeService.search(session.notebookId, content, {
            topK: 3,
            threshold: 0.5
          })

          if (searchResults.length > 0) {
            const { context, sources } = buildRAGContext(searchResults)
            retrieval = 'used'
            answerSources = sources
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
        Logger.debug('ChatHandlers', 'RAG disabled: No embedding model configured')
      }
    } catch (error) {
      // RAG 失败不应该阻止对话
      retrieval = 'failed'
      Logger.warn('ChatHandlers', 'RAG search failed:', error)
    }

    queries.updateMessageMetadata(assistantMessage.id, {
      ...(assistantMessage.metadata ?? {}),
      retrieval,
      sources: answerSources
    })

    // 4. 调用 Model Connection 流式生成
    const client = await connectionManager.getChatClient()
    if (!client) {
      event.sender.send('message-error', {
        messageId: assistantMessage.id,
        error: 'Chat model not configured, please configure in settings'
      })
      return assistantMessage.id
    }

    let fullTextContent = ''
    let fullReasoningContent = ''
    let usageMetadata: any = null

    // 调用 ModelClient 流式生成,获取 AbortController（基于 AI SDK fullStream）
    const abortController = await client.sendMessageStream(
      messages,
      // onChunk - 处理 AI SDK fullStream 的各种 part 类型
      (chunk) => {
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

        // 5. 流式传输完成
        if (done) {
          // 保存 usage metadata
          if (metadata?.usage) {
            usageMetadata = metadata
          }

          // 发送完成事件
          event.sender.send('message-chunk', {
            messageId: assistantMessage.id,
            type: 'finish',
            metadata: metadata
          })
        }
      },
      // onError
      (error) => {
        event.sender.send('message-error', {
          messageId: assistantMessage.id,
          error: error.message
        })
        // 清理 AbortController
        activeStreams.delete(assistantMessage.id)
      },
      // onComplete
      async () => {
        try {
          // 更新数据库中的完整内容（包含推理内容）
          queries.updateMessageContent(assistantMessage.id, fullTextContent, fullReasoningContent)

          // 计算 token 使用量
          let tokensUsed = 0
          if (usageMetadata?.usage?.totalTokens) {
            // 如果 API 返回了精确的 token 数
            tokensUsed = usageMetadata.usage.totalTokens
          } else {
            // 降级：使用估算
            const userTokens = SessionAutoSwitchService.estimateTokens(content)
            const assistantTokens = SessionAutoSwitchService.estimateTokens(fullTextContent)
            tokensUsed = userTokens + assistantTokens
          }

          Logger.debug('ChatHandlers', `Tokens used in this conversation: ${tokensUsed}`)

          // Check if session auto-switch is needed
          const newSessionId = await sessionAutoSwitchService.recordTokenUsageAndCheckSwitch(
            sessionId,
            tokensUsed
          )

          if (newSessionId) {
            // Notify frontend to switch to new session
            event.sender.send('session-auto-switched', {
              oldSessionId: sessionId,
              newSessionId: newSessionId
            })
          }

          // Send completion event to notify frontend streaming is complete
          event.sender.send('message-complete', {
            messageId: assistantMessage.id
          })
        } catch (error) {
          Logger.error('ChatHandlers', 'Error in completion callback:', error)
          event.sender.send('message-error', {
            messageId: assistantMessage.id,
            error: 'Error occurred while processing message'
          })
        } finally {
          // 清理 AbortController
          activeStreams.delete(assistantMessage.id)
        }
      }
    )

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
