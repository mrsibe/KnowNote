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

  // 异步操作
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
        // 设置该Notebook的流式消息
        newStreamingMessages[notebookId] = messageId
      } else {
        // 清除该Notebook的流式消息
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
      // 找到活跃session，设置为当前session
      set({ currentSession: activeSession })
      await get().loadMessages(activeSession.id)
    } else {
      // 没有活跃session，创建第一个
      const newSession = await get().createSession(notebookId, `Session ${Date.now()}`)
      set({ currentSession: newSession })
    }
  },

  loadMessages: async (sessionId) => {
    const dbMessages = await window.api.getMessages(sessionId)

    // 从缓存中恢复正在流式传输的消息内容
    const state = get()
    const messages = dbMessages.map((msg: ChatMessage) => {
      const cached = state.messageToNotebook[msg.id]
      if (cached && cached.content) {
        // 如果缓存中有内容，说明这条消息正在流式传输，使用缓存的内容
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
    // 1. 找到session对应的notebookId
    const session = get().currentSession
    if (!session) return

    const notebookId = session.notebookId

    // 2. 添加用户消息到 UI
    const userMessage: ChatMessage = {
      id: `temp_user_${Date.now()}`,
      sessionId,
      notebookId,
      role: 'user',
      content,
      createdAt: new Date()
    }
    get().addMessage(userMessage)

    // 3. 发送消息并获取 assistant messageId
    const messageId = await window.api.sendMessage(sessionId, content)

    // 4. 添加 assistant 消息占位符（包含推理字段）
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

    // 5. 初始化缓存，记录 messageId -> {notebookId, content, reasoningContent}
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

      // 乐观更新: 立即标记消息为非流式
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId ? { ...msg, isStreaming: false, isReasoningStreaming: false } : msg
        )
      }))

      // 调用 IPC 中止请求
      const result = await window.api.abortMessage(messageId)

      if (result.success) {
        console.log('[ChatStore] Message aborted successfully')

        // 立即清理流状态
        state.setStreamingMessage(notebookId, null)

        // 清理缓存
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
 * 设置流式消息监听器（基于 AI SDK 流式协议）
 * 在应用启动时调用一次
 * 返回清理函数
 */
export function setupChatListeners() {
  // 监听流式消息片段（AI SDK fullStream 格式）
  const cleanupChunk = window.api.onMessageChunk((data) => {
    const { messageId, type, content, messageMetadata } = data
    const store = useChatStore.getState()

    const cached = store.messageToNotebook[messageId]
    if (!cached) return

    // 处理不同类型的流式部分
    switch (type) {
      case 'reasoning-start':
        // 推理块开始，标记推理状态
        useChatStore.setState((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === messageId ? { ...msg, isReasoningStreaming: true } : msg
          )
        }))
        break

      case 'reasoning-delta': {
        // 推理增量内容
        const newReasoningContent = cached.reasoningContent + content
        useChatStore.setState((state) => ({
          messageToNotebook: {
            ...state.messageToNotebook,
            [messageId]: { ...cached, reasoningContent: newReasoningContent }
          }
        }))

        // 如果消息在当前视图中，更新推理内容
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
        // 推理块结束
        useChatStore.setState((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === messageId ? { ...msg, isReasoningStreaming: false } : msg
          )
        }))
        break

      case 'text-delta': {
        // 文本增量内容（最终答案）
        const newTextContent = cached.content + content
        useChatStore.setState((state) => ({
          messageToNotebook: {
            ...state.messageToNotebook,
            [messageId]: { ...cached, content: newTextContent }
          }
        }))

        // 如果消息在当前视图中，更新文本内容
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
        // 流式传输完成
        store.setStreamingMessage(cached.notebookId, null)

        // Provenance (retrieval status, sources, citations) is written to the DB
        // before the model call, so the in-memory message never saw it. Apply it
        // now, or the answer stays un-citable until the session is reloaded.
        if (messageMetadata) {
          useChatStore.setState((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === messageId ? { ...msg, metadata: messageMetadata } : msg
            )
          }))
        }

        // 清理缓存
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [messageId]: _removed, ...rest } = store.messageToNotebook
        useChatStore.setState({ messageToNotebook: rest })
        break
      }
    }
  })

  // 监听错误
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
