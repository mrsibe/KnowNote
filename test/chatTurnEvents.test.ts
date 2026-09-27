import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { UIMessageChunk } from 'ai'
import { setupChatListeners, useChatStore } from '../src/renderer/src/store/chatStore.ts'
import type { ChatMessage, ChatTurnEvent } from '../src/shared/types/chat.ts'
import {
  answerNoticeKey,
  isAnswerLive,
  keepsPartialAnswer
} from '../src/shared/utils/answerState.ts'

/**
 * The renderer's half of the stream protocol (#141).
 *
 * It receives the SDK's own events and hands them to the SDK's assembler, so the
 * answer it shows is the one Main persisted. What these tests pin is that the
 * renderer no longer merges deltas itself, that a hole in the delivered sequence is
 * reported rather than shown as a quietly short answer, and that the outcome event
 * is what ends the turn.
 */

let deliver: ((event: ChatTurnEvent) => void) | undefined
let activeSession: unknown = null

function installApi(): void {
  ;(globalThis as unknown as { window: unknown }).window = {
    api: {
      onTurnEvent: (callback: (event: ChatTurnEvent) => void) => {
        deliver = callback
        return () => {
          deliver = undefined
        }
      },
      getActiveSession: async () => activeSession,
      retryMessage: async (messageId: string) => ({
        success: true,
        messageId: `msg_retry_of_${messageId}`
      }),
      continueMessage: async (messageId: string) => ({ success: true, messageId })
    }
  }
}

/** The seed the store builds for a continuation, mirrored for the test. */
const seedOf = (message: ChatMessage): never =>
  ({
    id: message.id,
    role: 'assistant',
    parts: [{ type: 'text', text: message.content, state: 'done' }]
  }) as never

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
  // `pending` until the first event arrives (#142).
  status: 'pending',
  finishReason: null,
  error: null,
  usage: null,
  finishedAt: null,
  attemptOf: null,
  createdAt: new Date()
})

/** A turn the renderer is following, as `sendMessage` would have registered it. */
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

const textStream = (messageId: string, text: string): ChatTurnEvent[] => [
  chunk(messageId, 1, { type: 'start' }),
  chunk(messageId, 2, { type: 'start-step' }),
  chunk(messageId, 3, { type: 'text-start', id: 't1' }),
  chunk(messageId, 4, { type: 'text-delta', id: 't1', delta: text }),
  chunk(messageId, 5, { type: 'text-end', id: 't1' }),
  chunk(messageId, 6, { type: 'finish-step' })
]

const messageOf = (messageId: string): ChatMessage | undefined =>
  useChatStore.getState().messages.find((message) => message.id === messageId)

test('the events assemble into the answer on screen', async () => {
  installApi()
  const close = setupChatListeners()
  seedTurn('msg_assemble')

  for (const event of textStream('msg_assemble', 'the answer')) deliver?.(event)

  await waitFor(() => messageOf('msg_assemble')?.content === 'the answer')

  // The first event is what turns "waiting" into "streaming", the same transition
  // the execution makes in Main — and only the outcome event ends the turn, which is
  // what keeps the renderer from claiming an ending the database has not recorded.
  assert.equal(messageOf('msg_assemble')?.status, 'streaming')
  assert.equal(isAnswerLive(messageOf('msg_assemble')?.status), true)

  close()
})

test('a gap in the sequence is recorded instead of shown as a short answer', async () => {
  installApi()
  const close = setupChatListeners()
  seedTurn('msg_gap')

  deliver?.(chunk('msg_gap', 1, { type: 'text-start', id: 't1' }))
  deliver?.(chunk('msg_gap', 4, { type: 'text-delta', id: 't1', delta: 'the answer' }))

  await waitFor(() => useChatStore.getState().turns['msg_gap']?.sequenceGap === true)
  assert.equal(useChatStore.getState().turns['msg_gap']?.lastSeq, 4)

  close()
})

test('the outcome ends the turn and applies what it carried', async () => {
  installApi()
  const close = setupChatListeners()
  seedTurn('msg_outcome')

  for (const event of textStream('msg_outcome', 'the answer')) deliver?.(event)
  await waitFor(() => messageOf('msg_outcome')?.content === 'the answer')

  deliver?.({
    type: 'outcome',
    executionId: 'exec_1',
    messageId: 'msg_outcome',
    seq: 7,
    outcome: { status: 'truncated' },
    finishReason: 'length',
    usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 },
    messageMetadata: { retrieval: 'used', sources: [] }
  })

  await waitFor(() => messageOf('msg_outcome')?.status === 'truncated')
  const message = messageOf('msg_outcome')
  assert.equal(message?.content, 'the answer', 'the assembled answer was replaced')
  assert.equal(message?.status, 'truncated')
  assert.equal(message?.finishReason, 'length')
  assert.equal(message?.usage?.totalTokens, 8)
  assert.deepEqual(message?.metadata, { retrieval: 'used', sources: [] })
  assert.equal(useChatStore.getState().turns['msg_outcome'], undefined, 'the turn was not closed')
  assert.equal(
    useChatStore.getState().streamingMessages['notebook_1'],
    undefined,
    'the notebook still looks like it is streaming'
  )

  // What the reader sees now and what a reload shows are the same inputs, because
  // the live-only overlay is gone and every field left is one a stored row has.
  assert.equal(answerNoticeKey(message!), 'answerTruncated', 'the ended answer lost its notice')
  assert.equal(isAnswerLive(message?.status), false)
  assert.equal(keepsPartialAnswer(message?.status), true)

  close()
})

test('a failed turn keeps the answer and adds the reason beside it', async () => {
  installApi()
  const close = setupChatListeners()
  seedTurn('msg_failed')

  deliver?.(chunk('msg_failed', 1, { type: 'text-start', id: 't1' }))
  deliver?.(chunk('msg_failed', 2, { type: 'text-delta', id: 't1', delta: 'half' }))

  deliver?.({
    type: 'outcome',
    executionId: 'exec_1',
    messageId: 'msg_failed',
    seq: 3,
    outcome: { status: 'failed', error: { message: 'socket hang up' }, reason: 'error' },
    messageMetadata: {}
  })

  await waitFor(() => messageOf('msg_failed')?.status === 'failed')
  const message = messageOf('msg_failed')

  // What changed in #142: the part that arrived is kept, and the reason is a line
  // beside it. It used to *replace* the answer, which threw away the only thing the
  // reader had.
  assert.equal(message?.content, 'half')
  assert.equal(message?.error?.message, 'socket hang up')
  assert.equal(answerNoticeKey(message!), 'answerFailed')

  close()
})

test('an automatic session switch follows the turn', async () => {
  installApi()
  const close = setupChatListeners()
  seedTurn('msg_switch')

  const current = { id: 'session_1', notebookId: 'notebook_1', title: 't' }
  useChatStore.setState({ currentSession: current as never })
  activeSession = { id: 'session_2', notebookId: 'notebook_1', title: 't' }

  deliver?.({ type: 'session-auto-switched', sessionId: 'session_1', newSessionId: 'session_2' })

  await waitFor(() => useChatStore.getState().currentSession?.id === 'session_2')

  close()
})

test('a continuation appends to the answer on screen instead of replacing it', async () => {
  installApi()
  const close = setupChatListeners()
  seedTurn('msg_continue')

  // The store registers the turn with the answer as its seed (as `continueMessage`
  // does), so the assembler starts from what the reader can already see (#151).
  const existing = placeholder('msg_continue')
  const withAnswer: ChatMessage = { ...existing, content: 'the beginning. ', status: 'aborted' }
  useChatStore.setState({
    messages: [withAnswer],
    turns: { msg_continue: { notebookId: 'notebook_1', message: seedOf(withAnswer) } }
  })

  deliver?.(chunk('msg_continue', 1, { type: 'text-start', id: 't1' }))
  deliver?.(chunk('msg_continue', 2, { type: 'text-delta', id: 't1', delta: 'and the rest' }))
  deliver?.(chunk('msg_continue', 3, { type: 'text-end', id: 't1' }))

  await waitFor(() => messageOf('msg_continue')?.content === 'the beginning. and the rest')

  close()
})

test('a retry adds a sibling that points at the question it answers', async () => {
  installApi()
  const close = setupChatListeners()
  seedTurn('msg_first_attempt')

  const original = messageOf('msg_first_attempt')!
  useChatStore.setState({
    messages: [{ ...original, content: 'half', status: 'failed' }],
    // The action needs the session the question belongs to.
    currentSession: { id: 'session_1', notebookId: 'notebook_1', title: 't' } as never
  })

  await useChatStore.getState().retryMessage('notebook_1', 'msg_first_attempt')

  const sibling = messageOf('msg_retry_of_msg_first_attempt')
  assert.equal(sibling?.status, 'pending', 'the sibling did not start as a pending turn')
  assert.equal(
    sibling?.attemptOf,
    'msg_first_attempt',
    'the sibling does not point at the question it answers'
  )
  assert.equal(
    useChatStore.getState().turns['msg_retry_of_msg_first_attempt']?.notebookId,
    'notebook_1',
    'the sibling’s turn was not registered'
  )
  assert.equal(
    messageOf('msg_first_attempt')?.content,
    'half',
    'the attempt that failed was changed'
  )

  close()
})
