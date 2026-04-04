import { ipcMain, IpcMainInvokeEvent } from 'electron'
import * as queries from '../db/queries'
import { ProviderManager } from '../providers/ProviderManager'
import { SessionAutoSwitchService } from '../services/SessionAutoSwitchService'
import { KnowledgeService } from '../services/KnowledgeService'
import { validateAndCleanMessages } from '../utils/messageValidator'
import { settingsManager } from '../config'
import Logger from '../../shared/utils/logger'
import { ChatSchemas, validate } from './validation'

// 관리활점프의스트림형식요청
const activeStreams = new Map<string, AbortController>()

/**
 * RAG 컨텍스트 프롬프트 구성
 */
function buildRAGContext(
  searchResults: Array<{
    documentTitle: string
    content: string
    score: number
  }>
): string {
  if (searchResults.length === 0) return ''

  const contextParts = searchResults.map((result, index) => {
    return `[출처 ${index + 1}: ${result.documentTitle}]\n${result.content}`
  })

  return `다음은 사용자 질문과 관련된 배경 지식입니다. 이 정보를 참고하여 답변하세요:

${contextParts.join('\n\n---\n\n')}

위 배경 지식을 바탕으로 사용자의 질문에 답변하세요. 배경 지식이 질문에 충분하지 않은 경우 설명하고 최대한 도움이 되는 답변을 제공하세요.`
}

/**
 * Register chat-related IPC Handlers
 */
export function registerChatHandlers(
  providerManager: ProviderManager,
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
    // 검증매개변수
    if (args.length === 0) {
      throw new Error('IPC 호출에 매개변수 누락')
    }
    if (args.length > 1) {
      throw new Error(`IPC 호출 매개변수 오류: 단일 객체 매개변수 전달이 예상되었으나 ${args.length} 개의 매개변수를 수신`)
    }

    const validatedArgs = ChatSchemas.sendMessage.parse(args[0])
    const { sessionId, content } = validatedArgs

    // 1. 사용자 메시지 저장
    queries.createMessage(sessionId, 'user', content)

    // 2. assistant 메시지 플레이스홀더 생성
    const assistantMessage = queries.createMessage(sessionId, 'assistant', '')

    // 3. 컨텍스트로 사용할 기록 메시지 조회
    const history = queries.getMessagesBySession(sessionId)
    let messages = history.map((m: any) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content
    }))

    // 3.1 일반 메시지 정리 (빈 메시지 및 잘못된 형식 필터링)
    messages = validateAndCleanMessages(messages)

    // 검증정리후예아니오아직있는있는효메시지
    if (messages.length === 0) {
      event.sender.send('message-error', {
        messageId: assistantMessage.id,
        error: 'No valid conversation history'
      })
      return assistantMessage.id
    }

    // 3.2 RAG 강화: 관련 지식 검색 및 컨텍스트 주입
    // 기본 임베딩 모델이 설정된 경우에만 RAG 활성화
    try {
      const settings = await settingsManager.getAllSettings()
      const hasEmbeddingModel =
        settings.defaultEmbeddingModel && settings.defaultEmbeddingModel.includes(':')

      if (hasEmbeddingModel) {
        const session = queries.getSessionById(sessionId)
        if (session?.notebookId) {
          const searchResults = await knowledgeService.search(session.notebookId, content, {
            topK: 3,
            threshold: 0.5
          })

          if (searchResults.length > 0) {
            const ragContext = buildRAGContext(searchResults)
            Logger.debug(
              'ChatHandlers',
              `RAG: Found ${searchResults.length} relevant chunks for query`
            )

            // RAG 컨텍스트를 system message로 메시지 목록 맨 앞에 삽입
            messages.unshift({
              role: 'system',
              content: ragContext
            })
          }
        }
      } else {
        Logger.debug('ChatHandlers', 'RAG disabled: No embedding model configured')
      }
    } catch (error) {
      // RAG 실패가 대화를 차단하면 안 되며, 경고만 기록
      Logger.warn('ChatHandlers', 'RAG search failed:', error)
    }

    // 4. AI Provider 스트리밍 생성 호출
    const provider = await providerManager.getActiveChatProvider()
    if (!provider) {
      event.sender.send('message-error', {
        messageId: assistantMessage.id,
        error: 'AI Provider not configured, please configure in settings'
      })
      return assistantMessage.id
    }

    let fullTextContent = ''
    let fullReasoningContent = ''
    let usageMetadata: any = null

    // Provider 스트리밍 생성 호출, AbortController 획득 (AI SDK fullStream 기반)
    const abortController = await provider.sendMessageStream(
      messages,
      // onChunk - AI SDK fullStream의 다양한 part 유형 처리
      (chunk) => {
        const { metadata, content, done } = chunk

        // 1. 추론 블록 시작
        if (metadata?.reasoningStart) {
          event.sender.send('message-chunk', {
            messageId: assistantMessage.id,
            type: 'reasoning-start',
            reasoningId: metadata.reasoningId
          })
        }
        // 2. 추론 증분 내용
        else if (metadata?.isReasoning) {
          fullReasoningContent += content

          event.sender.send('message-chunk', {
            messageId: assistantMessage.id,
            type: 'reasoning-delta',
            content: content,
            reasoningId: metadata.reasoningId
          })
        }
        // 3. 추론 블록 종료
        else if (metadata?.reasoningEnd) {
          event.sender.send('message-chunk', {
            messageId: assistantMessage.id,
            type: 'reasoning-end',
            reasoningId: metadata.reasoningId
          })
        }
        // 4. 일반 텍스트 내용 (text-delta)
        else if (content) {
          fullTextContent += content

          event.sender.send('message-chunk', {
            messageId: assistantMessage.id,
            type: 'text-delta',
            content: content
          })
        }

        // 5. 스트리밍 전송 완료
        if (done) {
          // usage 메타데이터 저장
          if (metadata?.usage) {
            usageMetadata = metadata
          }

          // 전송완료이벤트
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
        // AbortController 정리
        activeStreams.delete(assistantMessage.id)
      },
      // onComplete
      async () => {
        try {
          // 업데이트데이터베이스에서의완전한내용（패키지포함추이내용）
          queries.updateMessageContent(assistantMessage.id, fullTextContent, fullReasoningContent)

          // 토큰 사용량 계산
          let tokensUsed = 0
          if (usageMetadata?.usage?.totalTokens) {
            // API에서 정확한 토큰 수를 반환한 경우
            tokensUsed = usageMetadata.usage.totalTokens
          } else {
            // 하강레벨：사용추정계산
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
          // AbortController 정리
          activeStreams.delete(assistantMessage.id)
        }
      }
    )

    // AbortController 저장
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
