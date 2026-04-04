import { create } from 'zustand'
import type { ChatSession, ChatMessage } from '../types/notebook'

interface ChatStore {
  // Current session
  currentSession: ChatSession | null

  // Session list (grouped by notebook)
  sessions: ChatSession[]

  // Message list (current session)
  messages: ChatMessage[]

  // Streaming message status: managed by notebookId
  streamingMessages: Record<string, string>

  // messageId -> {notebookId, content, reasoningContent} mapping, used to clean up streaming status and restore content after switching notebook
  messageToNotebook: Record<
    string,
    { notebookId: string; content: string; reasoningContent: string }
  >

  // Actions
  setCurrentSession: (session: ChatSession | null) => void
  setSessions: (sessions: ChatSession[]) => void
  setMessages: (messages: ChatMessage[]) => void

  addMessage: (message: ChatMessage) => void
  updateMessageContent: (messageId: string, content: string) => void
  updateMessageReasoningContent: (messageId: string, reasoningContent: string) => void
  setStreamingMessage: (notebookId: string, messageId: string | null) => void
  isNotebookStreaming: (notebookId: string) => boolean

  // 비동기 작업
  loadSessions: (notebookId: string) => Promise<void>
  loadActiveSession: (notebookId: string) => Promise<void>
  loadMessages: (sessionId: string) => Promise<void>
  createSession: (notebookId: string, title: string) => Promise<ChatSession>
  sendMessage: (sessionId: string, content: string) => Promise<void>
  abortMessage: (notebookId: string) => Promise<void>
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  currentSession: null,
  sessions: [],
  messages: [],
  streamingMessages: {},
  messageToNotebook: {},

  setCurrentSession: (session) => set({ currentSession: session }),
  setSessions: (sessions) => set({ sessions }),
  setMessages: (messages) => set({ messages }),

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message]
    })),

  updateMessageContent: (messageId, content) =>
    set((state) => ({
      messages: state.messages.map((msg) => (msg.id === messageId ? { ...msg, content } : msg))
    })),

  updateMessageReasoningContent: (messageId, reasoningContent) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId ? { ...msg, reasoningContent } : msg
      )
    })),

  setStreamingMessage: (notebookId, messageId) =>
    set((state) => {
      const newStreamingMessages = { ...state.streamingMessages }

      if (messageId) {
        // 해당 Notebook의 스트리밍 메시지 설정
        newStreamingMessages[notebookId] = messageId
      } else {
        // 해당 Notebook의 스트리밍 메시지 정리
        delete newStreamingMessages[notebookId]
      }

      return {
        streamingMessages: newStreamingMessages,
        messages: state.messages.map((msg) => ({
          ...msg,
          isStreaming: msg.id === messageId && !!messageId,
          isReasoningStreaming: msg.id === messageId && !!messageId
        }))
      }
    }),

  isNotebookStreaming: (notebookId) => {
    const state = get()
    return !!state.streamingMessages[notebookId]
  },

  loadSessions: async (notebookId) => {
    const sessions = await window.api.getChatSessions(notebookId)
    set({ sessions })
  },

  loadActiveSession: async (notebookId) => {
    const activeSession = await window.api.getActiveSession(notebookId)

    if (activeSession) {
      // 활성 session 찾음, 현재 session으로 설정
      set({ currentSession: activeSession })
      await get().loadMessages(activeSession.id)
    } else {
      // 활성 session 없음, 새로 생성
      const newSession = await get().createSession(notebookId, `Session ${Date.now()}`)
      set({ currentSession: newSession })
    }
  },

  loadMessages: async (sessionId) => {
    const dbMessages = await window.api.getMessages(sessionId)

    // 캐시에서 현재 스트리밍 중인 메시지 내용 복원
    const state = get()
    const messages = dbMessages.map((msg: ChatMessage) => {
      const cached = state.messageToNotebook[msg.id]
      if (cached && cached.content) {
        // 캐시에 내용이 있으면, 해당 메시지가 현재 스트리밍 중이므로 캐시 내용 사용
        return { ...msg, content: cached.content, isStreaming: true }
      }
      return msg
    })

    set({ messages })
  },

  createSession: async (notebookId, title) => {
    const session = await window.api.createChatSession(notebookId, title)
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentSession: session
    }))
    return session
  },

  sendMessage: async (sessionId, content) => {
    // 1. session의 notebookId 조회
    const session = get().currentSession
    if (!session) return

    const notebookId = session.notebookId

    // 2. UI에 사용자 메시지 추가
    const userMessage: ChatMessage = {
      id: `temp_user_${Date.now()}`,
      sessionId,
      notebookId,
      role: 'user',
      content,
      createdAt: new Date()
    }
    get().addMessage(userMessage)

    // 3. 메시지 전송 후 assistant messageId 조회
    const messageId = await window.api.sendMessage(sessionId, content)

    // 4. assistant 메시지 플레이스홀더 추가 (추론 필드 포함)
    const assistantMessage: ChatMessage = {
      id: messageId,
      sessionId,
      notebookId,
      role: 'assistant',
      content: '',
      reasoningContent: undefined,
      createdAt: new Date(),
      isStreaming: true,
      isReasoningStreaming: true
    }
    get().addMessage(assistantMessage)
    get().setStreamingMessage(notebookId, messageId)

    // 5. 캐시 초기화, messageId -> {notebookId, content, reasoningContent} 기록
    set((state) => ({
      messageToNotebook: {
        ...state.messageToNotebook,
        [messageId]: { notebookId, content: '', reasoningContent: '' }
      }
    }))
  },

  abortMessage: async (notebookId: string) => {
    const state = get()
    const messageId = state.streamingMessages[notebookId]

    if (!messageId) {
      console.warn('[ChatStore] No streaming message to abort for notebook:', notebookId)
      return
    }

    try {
      console.log('[ChatStore] Aborting message:', messageId)

      // 낙관적 업데이트: 즉시 메시지를 비스트리밍으로 표시
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId ? { ...msg, isStreaming: false, isReasoningStreaming: false } : msg
        )
      }))

      // IPC를 호출하여 요청 중단
      const result = await window.api.abortMessage(messageId)

      if (result.success) {
        console.log('[ChatStore] Message aborted successfully')

        // 즉시 스트리밍 상태 정리
        state.setStreamingMessage(notebookId, null)

        // 캐시 정리
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [messageId]: _removed, ...rest } = state.messageToNotebook
        set({ messageToNotebook: rest })
      } else {
        console.warn('[ChatStore] Failed to abort:', result.reason)
      }
    } catch (error) {
      console.error('[ChatStore] Error aborting message:', error)
    }
  }
}))

/**
 * 스트리밍 메시지 리스너 설정 (AI SDK 스트리밍 프로토콜 기반)
 * 앱 시작 시 한 번 호출
 * 정리 함수 반환
 */
export function setupChatListeners() {
  // 스트리밍 메시지 청크 리스너 (AI SDK fullStream 형식)
  const cleanupChunk = window.api.onMessageChunk((data) => {
    const { messageId, type, content } = data
    const store = useChatStore.getState()

    const cached = store.messageToNotebook[messageId]
    if (!cached) return

    // 다양한 타입의 스트리밍 청크 처리
    switch (type) {
      case 'reasoning-start':
        // 추론 블록 시작, 추론 상태 표시
        useChatStore.setState((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === messageId ? { ...msg, isReasoningStreaming: true } : msg
          )
        }))
        break

      case 'reasoning-delta': {
        // 추론 증분 내용
        const newReasoningContent = cached.reasoningContent + content
        useChatStore.setState((state) => ({
          messageToNotebook: {
            ...state.messageToNotebook,
            [messageId]: { ...cached, reasoningContent: newReasoningContent }
          }
        }))

        // 메시지가 현재 표시 중이면, 추론 내용 업데이트
        if (store.messages.some((m) => m.id === messageId)) {
          useChatStore.setState((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === messageId ? { ...msg, reasoningContent: newReasoningContent } : msg
            )
          }))
        }
        break
      }

      case 'reasoning-end':
        // 추론 블록 종료
        useChatStore.setState((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === messageId ? { ...msg, isReasoningStreaming: false } : msg
          )
        }))
        break

      case 'text-delta': {
        // 텍스트 증분 내용 (최종 답변)
        const newTextContent = cached.content + content
        useChatStore.setState((state) => ({
          messageToNotebook: {
            ...state.messageToNotebook,
            [messageId]: { ...cached, content: newTextContent }
          }
        }))

        // 메시지가 현재 표시 중이면, 텍스트 내용 업데이트
        if (store.messages.some((m) => m.id === messageId)) {
          useChatStore.setState((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === messageId ? { ...msg, content: newTextContent } : msg
            )
          }))
        }
        break
      }

      case 'finish': {
        // 스트리밍 전송 완료
        store.setStreamingMessage(cached.notebookId, null)

        // 캐시 정리
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [messageId]: _removed, ...rest } = store.messageToNotebook
        useChatStore.setState({ messageToNotebook: rest })
        break
      }
    }
  })

  // 오류 리스너
  const cleanupError = window.api.onMessageError((data) => {
    const { messageId, error } = data
    const store = useChatStore.getState()

    const errorContent = `❌ Error: ${error}`

    // Update cache
    const cached = store.messageToNotebook[messageId]
    if (cached) {
      useChatStore.setState((state) => ({
        messageToNotebook: {
          ...state.messageToNotebook,
          [messageId]: { ...cached, content: errorContent }
        }
      }))

      // If message is in current messages, also update it
      const message = store.messages.find((m) => m.id === messageId)
      if (message) {
        store.updateMessageContent(messageId, errorContent)
      }

      // Clear streaming status and cache
      store.setStreamingMessage(cached.notebookId, null)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [messageId]: _removed, ...rest } = store.messageToNotebook
      useChatStore.setState({ messageToNotebook: rest })
    }
  })

  // Listen for session auto switch
  const cleanupAutoSwitch = window.api.onSessionAutoSwitched(async (data) => {
    const { newSessionId } = data
    const store = useChatStore.getState()

    console.log(`[ChatStore] Session auto-switched to: ${newSessionId}`)

    // Silently switch to new session
    if (store.currentSession) {
      const newSession = await window.api.getActiveSession(store.currentSession.notebookId)

      if (newSession && newSession.id === newSessionId) {
        // Silently switch to new session, keep current message display, user unaware
        store.setCurrentSession(newSession)
      }
    }
  })

  // Return cleanup function
  return () => {
    cleanupChunk()
    cleanupError()
    cleanupAutoSwitch()
  }
}
