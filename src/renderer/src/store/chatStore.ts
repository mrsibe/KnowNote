import { create } from 'zustand'
import { readUIMessageStream } from 'ai'
import type { UIMessage, UIMessageChunk } from 'ai'
import type { ChatSession, ChatMessage } from '../types/notebook'
import type { ChatTurnEvent, ChatMessageSearchHit } from '../../../shared/types/chat'
import type { RetrievalScope } from '../../../shared/types/scope'
import { deriveSessionTitle } from '../../../shared/utils/sessionTitle'
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
  /** Switch to a session and record it as the last one used (#97). */
  openSession: (sessionId: string) => Promise<void>
  /** Delete one session; its messages go with it, the notebook and sources stay (#97). */
  deleteSession: (sessionId: string) => Promise<void>
  /** Search message bodies across the notebook's sessions (#97). */
  searchMessages: (notebookId: string, query: string) => Promise<ChatMessageSearchHit[]>
  /** Rename a session; a manual name is never overwritten by auto-derivation (#97). */
  renameSession: (sessionId: string, title: string) => Promise<void>
  createSession: (notebookId: string, title: string) => Promise<ChatSession>
  /** 设置本会话的检索范围（#94）；scope 存在 session 上，不是 notebook 上。 */
  setSessionScope: (sessionId: string, scope: RetrievalScope) => Promise<void>
  sendMessage: (sessionId: string, content: string) => Promise<void>
  abortMessage: (notebookId: string) => Promise<void>
  /** Answer the same question again, as a sibling of an answer that stopped (#151). */
  retryMessage: (notebookId: string, messageId: string) => Promise<void>
  /** Continue an answer that stopped, into the same message (#151). */
  continueMessage: (
    notebookId: string,
    messageId: string
  ) => Promise<{ started: boolean; reason?: 'continuation-limit' }>
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

/**
 * Snapshot coalescing (#177).
 *
 * The assembler emits one snapshot per chunk — a reasoning model can produce
 * hundreds per second — and each one used to be its own store commit and its own
 * full-transcript render. The latest snapshot per message is held here and applied
 * on a short timer, so the commit rate is bounded while no snapshot is ever
 * dropped: a later one replaces the pending one for the same message.
 */
const SNAPSHOT_FLUSH_MS = 40
const pendingSnapshots = new Map<string, UIMessage>()
let snapshotTimer: ReturnType<typeof setTimeout> | null = null

/**
 * The last sequence number per message, kept out of the store (#177).
 *
 * Writing it on every chunk was a store commit per chunk — the very cadence the
 * snapshot throttle exists to remove. It is only observable state when there is a
 * gap, so that is the only time it reaches the store.
 */
const lastSequences = new Map<string, number>()

/** Apply every held snapshot in one commit. Terminal paths call this first. */
function flushPendingSnapshots(): void {
  if (snapshotTimer !== null) {
    clearTimeout(snapshotTimer)
    snapshotTimer = null
  }
  if (pendingSnapshots.size === 0) return

  const pending = new Map(pendingSnapshots)
  pendingSnapshots.clear()

  useChatStore.setState((state) => {
    const turns = { ...state.turns }
    for (const [messageId, message] of pending) {
      const turn = turns[messageId]
      if (!turn) continue
      turns[messageId] = { ...turn, message, reasoningLive: isReasoningLive(message) }
    }
    return { turns }
  })
}

function scheduleSnapshotFlush(): void {
  if (snapshotTimer !== null) return
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null
    flushPendingSnapshots()
  }, SNAPSHOT_FLUSH_MS)
}

/**
 * What the overlay knows before the first event of a turn arrives.
 *
 * Nothing for a fresh answer; the answer itself for a continuation, so the assembler
 * appends to it instead of replacing it (#151) — the same seed Main gives its own
 * assembler, built from the same record.
 */
const seedFromMessage = (message: ChatMessage): UIMessage => ({
  id: message.id,
  role: 'assistant',
  parts: [
    ...(message.reasoningContent
      ? [{ type: 'reasoning' as const, text: message.reasoningContent, state: 'done' as const }]
      : []),
    ...(message.content
      ? [{ type: 'text' as const, text: message.content, state: 'done' as const }]
      : [])
  ]
})

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
    const seed = useChatStore.getState().turns[messageId]?.message
    const stream = new ReadableStream<UIMessageChunk>({
      start: (created) => {
        controller = created
      }
    })

    void (async () => {
      try {
        for await (const message of readUIMessageStream({
          stream,
          ...(seed && { message: seed })
        })) {
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
  // Terminal state is applied now, not on the next turn of the throttle: the last
  // snapshot is what the turn's content must settle on.
  flushPendingSnapshots()

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
              reasoningContent: messageReasoning(turn?.message) || message.reasoningContent,
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
  lastSequences.delete(event.messageId)
}

function applySnapshot(messageId: string, message: UIMessage): void {
  // Hold the latest snapshot; the timer commits it together with any other live
  // turn. This is the whole point of #177: one chunk must not be one store write
  // and one render of every historical message.
  pendingSnapshots.set(messageId, message)
  scheduleSnapshotFlush()
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
    const [activeSession] = await Promise.all([
      window.api.getActiveSession(notebookId),
      // The list travels with the session: the continuation notice and the switcher
      // both need it without the reader having to open the list first (#97).
      get().loadSessions(notebookId)
    ])

    if (activeSession) {
      // 找到最近使用的 session，设置为当前 session（#97：不再只有一个 active）。
      set({ currentSession: activeSession })
      await get().loadMessages(activeSession.id)
    } else {
      // 没有会话，创建第一个。标题留占位，第一条消息会把它命名（#97）。
      const newSession = await get().createSession(notebookId, '')
      set({ currentSession: newSession })
    }
  },

  openSession: async (sessionId) => {
    const state = get()
    const session = state.sessions.find((item) => item.id === sessionId)
    if (!session) return

    // Touch before loading so "last used" is the session actually on screen, even
    // if loading its messages fails.
    const openedAt = new Date()
    set({
      currentSession: { ...session, lastOpenedAt: openedAt },
      sessions: state.sessions.map((item) =>
        item.id === sessionId ? { ...item, lastOpenedAt: openedAt } : item
      )
    })
    await get().loadMessages(sessionId)
    void window.api.touchSession(sessionId)
  },

  deleteSession: async (sessionId) => {
    const state = get()
    const target = state.sessions.find((item) => item.id === sessionId)
    await window.api.deleteSession(sessionId)

    const remaining = state.sessions.filter((item) => item.id !== sessionId)
    set({ sessions: remaining })

    // Deleting the open session must leave the notebook usable: fall to the next
    // session, or open a fresh one, rather than a blank chat with no session.
    if (state.currentSession?.id !== sessionId || !target) return

    const next = remaining.find((item) => item.notebookId === target.notebookId)
    if (next) {
      await get().openSession(next.id)
    } else {
      const created = await get().createSession(target.notebookId, '')
      set({ currentSession: created })
      await get().loadMessages(created.id)
    }
  },

  searchMessages: async (notebookId, query) => {
    if (!query.trim()) return []
    return window.api.searchMessages(notebookId, query)
  },

  renameSession: async (sessionId, title) => {
    const trimmed = title.trim()
    if (!trimmed) return
    await window.api.updateSessionTitle(sessionId, trimmed)
    set((state) => ({
      currentSession:
        state.currentSession?.id === sessionId
          ? { ...state.currentSession, title: trimmed, titleIsAuto: false }
          : state.currentSession,
      sessions: state.sessions.map((session) =>
        session.id === sessionId ? { ...session, title: trimmed, titleIsAuto: false } : session
      )
    }))
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
      currentSession: session,
      // A new session has no transcript; without this the previous session's
      // messages stay on screen under the new session's name until a reload.
      messages: []
    }))
    return session
  },

  setSessionScope: async (sessionId, scope) => {
    await window.api.setSessionScope(sessionId, scope)
    set((state) => ({
      currentSession:
        state.currentSession?.id === sessionId
          ? { ...state.currentSession, retrievalScope: scope }
          : state.currentSession,
      sessions: state.sessions.map((session) =>
        session.id === sessionId ? { ...session, retrievalScope: scope } : session
      )
    }))
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
      attemptOf: null,
      createdAt: new Date()
    }
    get().addMessage(userMessage)

    // 3. 发送消息并获取 assistant messageId。
    //    第一条消息给会话命名（#97）：主进程是权威版本，这里用同一个纯函数先显示，
    //    否则列表会一直挂着占位标题直到下一次加载。
    const derivedTitle = session.titleIsAuto ? deriveSessionTitle(content) || null : null
    if (derivedTitle) {
      set((state) => ({
        currentSession: state.currentSession
          ? { ...state.currentSession, title: derivedTitle, titleIsAuto: false }
          : state.currentSession,
        sessions: state.sessions.map((item) =>
          item.id === sessionId ? { ...item, title: derivedTitle, titleIsAuto: false } : item
        )
      }))
    }

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
      attemptOf: null,
      createdAt: new Date()
    }
    get().addMessage(assistantMessage)
    get().setStreamingMessage(notebookId, messageId)

    // 5. 登记这一轮：事件到达时靠它找到 notebookId，并在 reload 时恢复内容
    set((state) => ({
      turns: { ...state.turns, [messageId]: { notebookId } }
    }))
  },

  retryMessage: async (notebookId, messageId) => {
    const state = get()
    const sessionId = state.currentSession?.id
    const original = state.messages.find((message) => message.id === messageId)
    if (!sessionId || !original) return

    const result = await window.api.retryMessage(messageId)
    if (!result.success || !result.messageId) {
      throw new Error(result.error || 'Failed to retry the answer')
    }

    // A sibling: a new answer to the same question, next to the one that stopped. It
    // points at the group's first attempt, so a third attempt joins the same group.
    get().addMessage({
      id: result.messageId,
      sessionId,
      notebookId,
      role: 'assistant',
      content: '',
      reasoningContent: undefined,
      status: 'pending',
      finishReason: null,
      error: null,
      usage: null,
      finishedAt: null,
      attemptOf: original.attemptOf ?? original.id,
      createdAt: new Date()
    })
    get().setStreamingMessage(notebookId, result.messageId)
    set((current) => ({
      turns: { ...current.turns, [result.messageId!]: { notebookId } }
    }))
  },

  continueMessage: async (notebookId, messageId) => {
    const message = get().messages.find((item) => item.id === messageId)
    if (!message) return { started: false }

    // What a refusal has to put back. Main can refuse before it starts a turn
    // (`continuation-limit`), so the optimistic live state below must be reversible:
    // otherwise the message sits at `pending` and the notebook streams forever.
    const previousStatus = message.status
    const previousTurn = get().turns[messageId]

    const rollback = (): void => {
      useChatStore.setState((current) => {
        const turns = { ...current.turns }
        if (previousTurn) turns[messageId] = previousTurn
        else delete turns[messageId]

        return {
          turns,
          messages: current.messages.map((item) =>
            item.id === messageId ? { ...item, status: previousStatus } : item
          )
        }
      })
      get().setStreamingMessage(notebookId, null)
      // A refusal arrives before any chunk, so no assembler should exist; deleting
      // anyway keeps a raced event from leaving a half-built one behind.
      assemblers.delete(messageId)
      lastSequences.delete(messageId)
      pendingSnapshots.delete(messageId)
    }

    // Register the turn with the answer as its seed *before* the IPC call: the seed
    // has to be in place for the first chunk, which Main may emit before the invoke
    // resolves. Rolling back on refusal is what keeps the optimism safe.
    set((current) => ({
      turns: {
        ...current.turns,
        [messageId]: { notebookId, message: seedFromMessage(message) }
      },
      messages: current.messages.map((item) =>
        item.id === messageId ? { ...item, status: 'pending' } : item
      )
    }))
    get().setStreamingMessage(notebookId, messageId)

    let result: Awaited<ReturnType<typeof window.api.continueMessage>>
    try {
      result = await window.api.continueMessage(messageId)
    } catch (error) {
      // A rejected IPC round trip is a refusal too: roll back and report it instead
      // of leaving the spinner running.
      rollback()
      console.error('[ChatStore] Failed to continue the answer:', error)
      throw error
    }

    if (!result.success) {
      rollback()
      console.error('[ChatStore] Failed to continue the answer:', result.error)
      // The continuation bound has dedicated UI wording; other failures preserve
      // the main process's actual error for the caller to display.
      if (result.reason !== 'continuation-limit') {
        throw new Error(result.error || 'Failed to continue the answer')
      }
      return { started: false, reason: result.reason }
    }

    return { started: true }
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
        // rather than showing an answer that is quietly short. The running sequence
        // stays out of the store (#177): writing it per chunk was a commit per
        // chunk, which is exactly the cadence the snapshot throttle removes.
        if (turn) {
          const previous = lastSequences.get(event.messageId)
          if (!isSequenceContinuing(previous, event.seq)) {
            console.warn(
              `[ChatStore] missing events for ${event.messageId}: expected ${(previous ?? 0) + 1}, got ${event.seq}`
            )
            useChatStore.setState((current) => ({
              turns: {
                ...current.turns,
                [event.messageId]: {
                  ...(current.turns[event.messageId] ?? turn),
                  lastSeq: event.seq,
                  sequenceGap: true
                }
              }
            }))
          }
          lastSequences.set(event.messageId, event.seq)
        }

        feedAssembler(event.messageId, event.event)

        // The first event of a turn is what turns "waiting" into "streaming", the
        // same transition the execution makes in Main. Guarded so a chunk that
        // changes nothing does not commit: returning the current state is a no-op
        // for zustand, and a per-chunk commit is what #177 removes.
        if (event.event.type !== 'start') {
          useChatStore.setState((current) => {
            const transition = current.messages.some(
              (message) => message.id === event.messageId && message.status === 'pending'
            )
            if (!transition) return current
            return {
              messages: current.messages.map((message) =>
                message.id === event.messageId && message.status === 'pending'
                  ? { ...message, status: 'streaming' }
                  : message
              )
            }
          })
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

      // Session 自动切换（#97）：不再静默。列表重新加载、切到新会话并显示它的
      // 消息会为空；会话顶部的边界条会把刚归档的那个会话连同入口一起呈现，所以
      // 这次切换是可见、可返回的，而不是内容凭空消失。
      case 'session-auto-switched': {
        void (async () => {
          const state = useChatStore.getState()
          const notebookId = state.currentSession?.notebookId
          if (!notebookId) return

          await state.loadSessions(notebookId)
          const newSession = useChatStore
            .getState()
            .sessions.find((session) => session.id === event.newSessionId)
          if (!newSession) return

          useChatStore.getState().setCurrentSession(newSession)
          await useChatStore.getState().loadMessages(newSession.id)
        })()
        break
      }
    }
  })

  return () => {
    cleanupTurn()
  }
}
