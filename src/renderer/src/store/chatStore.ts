import { create } from 'zustand'
import { readUIMessageStream } from 'ai'
import type { UIMessage, UIMessageChunk } from 'ai'
import type { ChatSession, ChatMessage } from '../types/notebook'
import type { ChatTurnEvent } from '../../../shared/types/chat'
import {
  isReasoningLive,
  isSequenceContinuing,
  messageReasoning,
  messageText
} from '../../../shared/utils/uiMessage'

/**
 * A turn the renderer is following.
 *
 * `message` is the answer as the SDK assembled it, from the same event stream Main
 * assembles from (#141). Nothing here re-derives text from deltas — the reason the
 * old store kept a `messageToNotebook` map of concatenated strings was that it was
 * doing the merging itself.
 */
interface StreamingTurn {
  notebookId: string
  message?: UIMessage
  /** The last sequence number received, so a gap can be noticed. */
  lastSeq?: number
  /** Set once a gap has been seen: what is on screen is missing content. */
  sequenceGap?: boolean
  /**
   * Whether the model is still thinking, read from the assembled message rather
   * than remembered from an event (#142). It is live-only state, which is why it
   * lives on the turn and not on the message.
   */
  reasoningLive?: boolean
}

interface ChatStore {
  // Current session
  currentSession: ChatSession | null

  // Session list (grouped by notebook)
  sessions: ChatSession[]

  // Message list (current session)
  messages: ChatMessage[]

  // Streaming message status: managed by notebookId
  streamingMessages: Record<string, string>

  // messageId -> the running turn. Used to clean up streaming status, to restore an
  // in-flight answer after switching notebook, and to detect a gap in the stream.
  turns: Record<string, StreamingTurn>

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

/**
 * The assembler for one message's chunk stream.
 *
 * The SDK turns a stream of events into a `UIMessage`; the renderer needs the same
 * one Main persists, so it uses the same function rather than its own merge (#141).
 */
interface TurnAssembler {
  push: (chunk: UIMessageChunk) => void
  /**
   * Resolves once every event that has been pushed is assembled.
   *
   * The outcome event can arrive while these are still being processed, and the
   * partial answer is exactly what must not be dropped when that happens (#142).
   */
  drained: Promise<void>
  close: () => void
}

/**
 * Assemblers live here rather than in store state: a stream controller is
 * machinery, not something a component renders, and putting it in state would make
 * every event notify every subscriber with a new object.
 */
const assemblers = new Map<string, TurnAssembler>()

/** Push an event into the assembling message, and show the snapshot it produces. */
function feedAssembler(messageId: string, chunk: UIMessageChunk): void {
  let assembler = assemblers.get(messageId)

  if (!assembler) {
    let controller: ReadableStreamDefaultController<UIMessageChunk> | undefined
    let closed = false
    let drained = (): void => {}
    const assembled = new Promise<void>((resolve) => {
      drained = resolve
    })
    const stream = new ReadableStream<UIMessageChunk>({
      start: (created) => {
        controller = created
      }
    })

    void (async () => {
      try {
        for await (const message of readUIMessageStream({ stream })) {
          applySnapshot(messageId, message)
        }
      } catch (error) {
        // A malformed event must not take the transcript down with it: the turn's
        // outcome event still arrives and still closes the turn.
        console.error('[ChatStore] Failed to assemble a streaming answer:', error)
      } finally {
        drained()
      }
    })()

    assembler = {
      push: (next) => {
        if (!closed) controller?.enqueue(next)
      },
      drained: assembled,
      close: () => {
        if (closed) return
        closed = true
        controller?.close()
      }
    }
    assemblers.set(messageId, assembler)
  }

  assembler.push(chunk)
}

/**
 * Apply the turn's ending to the message it belongs to.
 *
 * Called only after the assembler has drained, so the partial answer is the finished
 * one: the outcome event can arrive while the last chunks are still being assembled
 * (#142), and applying it early would drop exactly the text a stopped or failed turn
 * is supposed to keep.
 */
function applyOutcome(event: Extract<ChatTurnEvent, { type: 'outcome' }>): void {
  const state = useChatStore.getState()
  const turn = state.turns[event.messageId]

  useChatStore.setState((current) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [event.messageId]: _finished, ...turns } = current.turns
    return {
      turns,
      messages: current.messages.map((message) =>
        message.id === event.messageId
          ? {
              ...message,
              // The partial answer is kept whatever the status: a stopped or failed
              // turn is what the reader was left with, and the reason is a line
              // beside it, not a replacement for it (#142).
              content: messageText(turn?.message) || message.content,
              status: event.outcome.status,
              finishReason: event.finishReason ?? null,
              error: event.outcome.status === 'failed' ? event.outcome.error : null,
              usage: event.usage ?? null,
              metadata: event.messageMetadata,
              finishedAt: new Date()
            }
          : message
      )
    }
  })

  if (turn) state.setStreamingMessage(turn.notebookId, null)
  assemblers.delete(event.messageId)
}

function applySnapshot(messageId: string, message: UIMessage): void {
  const text = messageText(message)
  const reasoningContent = messageReasoning(message)
  const reasoningLive = isReasoningLive(message)

  useChatStore.setState((state) => {
    const turn = state.turns[messageId]
    const turns = turn
      ? { ...state.turns, [messageId]: { ...turn, message, reasoningLive } }
      : state.turns

    // Only touch the visible list when this is the message the reader is looking at;
    // a turn in another notebook still assembles so switching back is instant.
    const messages = state.messages.some((item) => item.id === messageId)
      ? state.messages.map((item) =>
          item.id === messageId ? { ...item, content: text, reasoningContent } : item
        )
      : state.messages

    return { turns, messages }
  })
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  currentSession: null,
  sessions: [],
  messages: [],
  streamingMessages: {},
  turns: {},

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

  // 设置流式消息状态
  setStreamingMessage: (notebookId, messageId) =>
    set((state) => {
      const newS = { ...state.streamingMessages }
      if (messageId) {
        newS[notebookId] = messageId
      } else {
        delete newS[notebookId]
      }
      return { streamingMessages: newS }
    }),

  // 检查指定 notebook 是否有消息正在流式传输
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

    // An answer that is still arriving is not in the database yet: restore it from
    // the turn the renderer is assembling, so switching notebook does not blank it.
    const state = get()
    const messages = dbMessages.map((msg: ChatMessage) => {
      const turn = state.turns[msg.id]
      if (turn?.message) {
        return {
          ...msg,
          content: messageText(turn.message),
          reasoningContent: messageReasoning(turn.message),
          isStreaming: true
        }
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
    //    用户消息没有一轮对话，所以没有 execution 状态：null 表示“不适用”，
    //    与 assistant 的“还没结束”是两件事。
    const userMessage: ChatMessage = {
      id: `temp_user_${Date.now()}`,
      sessionId,
      notebookId,
      role: 'user',
      content,
      status: null,
      finishReason: null,
      error: null,
      usage: null,
      finishedAt: null,
      createdAt: new Date()
    }
    get().addMessage(userMessage)

    // 3. 发送消息并获取 assistant messageId
    const messageId = await window.api.sendMessage(sessionId, content)

    // 4. 添加 assistant 消息占位符（包含推理字段）
    //    终态（status / finishReason / error）在回合结束时才会到达，这里只是占位；
    //    后端那一行此刻已经是 streaming。
    const assistantMessage: ChatMessage = {
      id: messageId,
      sessionId,
      notebookId,
      role: 'assistant',
      content: '',
      reasoningContent: undefined,
      // `pending` until the first event arrives: the turn exists, the provider has
      // not said anything yet (#142).
      status: 'pending',
      finishReason: null,
      error: null,
      usage: null,
      finishedAt: null,
      createdAt: new Date()
    }
    get().addMessage(assistantMessage)
    get().setStreamingMessage(notebookId, messageId)

    // 5. 登记这一轮：事件到达时靠它找到 notebookId，并在 reload 时恢复内容
    set((state) => ({
      turns: { ...state.turns, [messageId]: { notebookId } }
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
      // 乐观更新: 立即标记消息为非流式
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId ? { ...msg, isStreaming: false, isReasoningStreaming: false } : msg
        )
      }))

      // 调用 IPC 中止请求。后端先记录 aborted 再取消上游请求，所以随后的 AbortError
      // 不会再改写这一轮的终态（#141）。
      const result = await window.api.abortMessage(messageId)

      if (result.success) {
        // 立即清理流状态
        state.setStreamingMessage(notebookId, null)
      } else {
        console.warn('[ChatStore] Failed to abort:', result.reason)
      }
    } catch (error) {
      console.error('[ChatStore] Error aborting message:', error)
    }
  }
}))

/**
 * 设置流式回合监听器（#141）。
 * 在应用启动时调用一次，返回清理函数。
 *
 * One channel carries everything a turn says: the SDK's own events, forwarded
 * verbatim, and the single outcome that ends it. The renderer therefore cannot lose
 * an event type it does not know about — it hands them all to the SDK's assembler.
 */
export function setupChatListeners(): () => void {
  const cleanupTurn = window.api.onTurnEvent((event) => {
    switch (event.type) {
      case 'chunk': {
        const state = useChatStore.getState()
        const turn = state.turns[event.messageId]

        // A gap means content was lost on the way. Nothing replays yet, so say so
        // rather than showing an answer that is quietly short.
        if (turn && !isSequenceContinuing(turn.lastSeq, event.seq)) {
          console.warn(
            `[ChatStore] missing events for ${event.messageId}: expected ${(turn.lastSeq ?? 0) + 1}, got ${event.seq}`
          )
          useChatStore.setState((current) => ({
            turns: {
              ...current.turns,
              [event.messageId]: { ...turn, lastSeq: event.seq, sequenceGap: true }
            }
          }))
        } else if (turn) {
          useChatStore.setState((current) => ({
            turns: { ...current.turns, [event.messageId]: { ...turn, lastSeq: event.seq } }
          }))
        }

        feedAssembler(event.messageId, event.event)

        // The first event of a turn is what turns "waiting" into "streaming", the
        // same transition the execution makes in Main.
        if (event.event.type !== 'start') {
          useChatStore.setState((current) => ({
            messages: current.messages.map((message) =>
              message.id === event.messageId && message.status === 'pending'
                ? { ...message, status: 'streaming' }
                : message
            )
          }))
        }
        break
      }

      case 'outcome': {
        const assembler = assemblers.get(event.messageId)
        // Closing the stream ends the assembler; waiting for it to drain means the
        // ending is applied to the finished answer.
        assembler?.close()
        void (async () => {
          await assembler?.drained
          applyOutcome(event)
        })()
        break
      }

      // Session 自动切换
      case 'session-auto-switched': {
        void (async () => {
          const state = useChatStore.getState()
          if (!state.currentSession) return

          const newSession = await window.api.getActiveSession(state.currentSession.notebookId)
          if (newSession && newSession.id === event.newSessionId) {
            state.setCurrentSession(newSession)
          }
        })()
        break
      }
    }
  })

  return () => {
    cleanupTurn()
  }
}
