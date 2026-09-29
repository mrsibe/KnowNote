import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { UIMessageChunk } from 'ai'
import { setupChatListeners, useChatStore } from '../src/renderer/src/store/chatStore.ts'
import type { ChatMessage, ChatTurnEvent } from '../src/shared/types/chat.ts'
import { messageText } from '../src/shared/utils/uiMessage.ts'

/**
 * #177: a streaming answer must not re-render the whole transcript per chunk.
 *
 * The assembler emits a snapshot per chunk; the store holds the latest one per
 * message and commits on a short timer. These tests pin the three properties the
 * acceptance names: coalescing, last-one-wins, and terminal state applied now —
 * never on the next turn of the throttle.
 */

let deliver: ((event: ChatTurnEvent) => void) | undefined

function installApi(): void {
  ;(globalThis as unknown as { window: unknown }).window = {
    api: {
      onTurnEvent: (callback: (event: ChatTurnEvent) => void) => {
        deliver = callback
        return () => {
          deliver = undefined
        }
      },
      getActiveSession: async () => null
    }
  }
}

const waitFor = async (condition: () => boolean, timeoutMs = 1000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('the condition never became true')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const placeholder = (messageId: string): ChatMessage => ({
  id: messageId,
  sessionId: 'session_1',
  notebookId: 'notebook_1',
  role: 'assistant',
  content: '',
  reasoningContent: null,
  status: 'pending',
  finishReason: null,
  error: null,
  usage: null,
  finishedAt: null,
  attemptOf: null,
  createdAt: new Date()
})

function seedTurn(messageId: string): void {
  useChatStore.setState({
    messages: [placeholder(messageId)],
    turns: { [messageId]: { notebookId: 'notebook_1' } },
    streamingMessages: { notebook_1: messageId },
    currentSession: null,
    sessions: []
  })
}

const chunk = (messageId: string, seq: number, event: UIMessageChunk): ChatTurnEvent => ({
  type: 'chunk',
  executionId: 'exec_1',
  messageId,
  seq,
  event
})

const liveTextOf = (messageId: string): string =>
  messageText(useChatStore.getState().turns[messageId]?.message)

test('many chunks collapse into far fewer store commits', async () => {
  installApi()
  const close = setupChatListeners()
  seedTurn('msg_throttle')

  let commits = 0
  const unsubscribe = useChatStore.subscribe(() => {
    commits += 1
  })

  deliver?.(chunk('msg_throttle', 1, { type: 'text-start', id: 't1' }))
  for (let index = 0; index < 120; index++) {
    deliver?.(chunk('msg_throttle', index + 2, { type: 'text-delta', id: 't1', delta: 'x' }))
  }

  await waitFor(() => liveTextOf('msg_throttle').length === 120)
  unsubscribe()

  // 120 chunks on one tick must not be 120 commits. The only writes are the
  // pending→streaming transition and the flush itself.
  assert.ok(commits <= 4, `expected ≤4 commits for 120 chunks, got ${commits}`)
  assert.equal(liveTextOf('msg_throttle'), 'x'.repeat(120))

  close()
})

test('a snapshot inside the throttle window is not dropped: last one wins', async () => {
  installApi()
  const close = setupChatListeners()
  seedTurn('msg_last')

  deliver?.(chunk('msg_last', 1, { type: 'text-start', id: 't1' }))
  deliver?.(chunk('msg_last', 2, { type: 'text-delta', id: 't1', delta: 'first' }))
  deliver?.(chunk('msg_last', 3, { type: 'text-delta', id: 't1', delta: '-second' }))

  // Both deltas land inside one throttle window. If the pending snapshot were
  // dropped rather than replaced, the text would read "first" or "-second".
  await waitFor(() => liveTextOf('msg_last') === 'first-second')

  close()
})

test('the terminal outcome is applied synchronously, not on the timer', async () => {
  installApi()
  const close = setupChatListeners()
  seedTurn('msg_terminal')

  deliver?.(chunk('msg_terminal', 1, { type: 'text-start', id: 't1' }))
  deliver?.(chunk('msg_terminal', 2, { type: 'text-delta', id: 't1', delta: 'the answer' }))
  deliver?.({
    type: 'outcome',
    executionId: 'exec_1',
    messageId: 'msg_terminal',
    seq: 3,
    outcome: { status: 'completed' },
    finishReason: 'stop',
    messageMetadata: {}
  })

  // No timer wait: once the turn settles, the content is already there.
  await waitFor(() => useChatStore.getState().streamingMessages['notebook_1'] === undefined)
  const message = useChatStore.getState().messages.find((item) => item.id === 'msg_terminal')
  assert.equal(message?.content, 'the answer')

  close()
})
