import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV2, simulateReadableStream } from 'ai/test'
import type { LanguageModelV2FinishReason, LanguageModelV2StreamPart } from '@ai-sdk/provider'
import { ModelClient } from '../src/main/models/ModelClient.ts'
import {
  ChatStreamManager,
  type ChatStreamEvent,
  type ChatTurnStore
} from '../src/main/services/chat/ChatStreamManager.ts'
import type {
  ChatExecutionOutcome,
  ChatMessageMetadata,
  ChatTokenUsage
} from '../src/shared/types/chat.ts'
import type { ModelConnection } from '../src/shared/types/connection.ts'

/**
 * Who owns a running turn, and what it is allowed to become (#140).
 *
 * Before this, a turn was an `AbortController` in a `Map` inside the `send-message`
 * IPC handler, and everything else about it lived in that handler's closure. These
 * tests drive the real `ChatStreamManager` with a scripted provider, so the rules
 * the epic depends on are checked as behaviour rather than as comments:
 *
 *   - a turn ends exactly once, and the first terminal signal is the one that counts
 *   - a stop is recorded before it is acted on, so the SDK's AbortError that comes
 *     back cannot re-label the turn
 *   - the terminal state is persisted *before* the renderer is told anything
 *   - a failed or stopped turn keeps the partial answer it produced
 */

const connection: ModelConnection = {
  protocol: 'openai-completions',
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'test-key',
  modelId: 'test-model'
}

const textChunks = (text: string): LanguageModelV2StreamPart[] => [
  { type: 'text-start', id: 'text-1' },
  { type: 'text-delta', id: 'text-1', delta: text },
  { type: 'text-end', id: 'text-1' }
]

const finishChunk = (finishReason: LanguageModelV2FinishReason): LanguageModelV2StreamPart => ({
  type: 'finish',
  finishReason,
  usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 }
})

/** A provider stream that errors out when the signal is aborted, like a real transport. */
const abortableStream = (signal: AbortSignal | undefined, text: string): ReadableStream<never> =>
  new ReadableStream({
    async start(controller) {
      for (const chunk of [
        { type: 'stream-start', warnings: [] },
        ...textChunks(text)
      ] as never[]) {
        controller.enqueue(chunk)
      }
      await new Promise<void>((resolve) => {
        if (!signal || signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
      controller.error(new DOMException('The operation was aborted.', 'AbortError'))
    }
  })

/** The real client, with the provider replaced by a scripted stream. */
function scriptedClient(chunks: LanguageModelV2StreamPart[]): ModelClient {
  const model = new MockLanguageModelV2({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [{ type: 'stream-start', warnings: [] }, ...chunks] as never[]
      })
    })
  })
  const client = new ModelClient('chat', connection)
  client.getAIModel = () => model
  return client
}

function abortableClient(text: string): ModelClient {
  const model = new MockLanguageModelV2({
    doStream: async ({ abortSignal }) => ({ stream: abortableStream(abortSignal, text) as never })
  })
  const client = new ModelClient('chat', connection)
  client.getAIModel = () => model
  return client
}

interface StoredTurn {
  messageId: string
  content?: string
  reasoningContent?: string
  metadata?: ChatMessageMetadata
  outcome?: ChatExecutionOutcome
  finishReason?: string
  usage?: ChatTokenUsage
}

/**
 * A store that records what was written, into a log shared with the event spy,
 * because "persist before announcing" is one of the invariants under test and can
 * only be asserted across both.
 */
function fakeStore(log: string[] = []) {
  const turns = new Map<string, StoredTurn>()
  let counter = 0

  const store: ChatTurnStore = {
    createTurn: () => {
      const id = `msg_${++counter}`
      turns.set(id, { messageId: id })
      log.push(`create:${id}`)
      return { id }
    },
    saveTurnMetadata: (messageId, metadata) => {
      Object.assign(turns.get(messageId)!, { metadata })
      log.push(`metadata:${messageId}`)
    },
    saveTurnContent: (messageId, content, reasoningContent) => {
      Object.assign(turns.get(messageId)!, { content, reasoningContent })
      log.push(`content:${messageId}`)
    },
    saveTurnOutcome: (messageId, outcome, finishReason, usage) => {
      Object.assign(turns.get(messageId)!, { outcome, finishReason, usage })
      log.push(`outcome:${messageId}`)
    }
  }

  return { store, turns }
}

function fakeAutoSwitch(newSessionId: string | null = null) {
  const calls: Array<{ sessionId: string; tokensUsed: number }> = []
  return {
    calls,
    service: {
      recordTokenUsageAndCheckSwitch: async (sessionId: string, tokensUsed: number) => {
        calls.push({ sessionId, tokensUsed })
        return newSessionId
      }
    }
  }
}

/** Collects what the outside world was told, and resolves when the turn ends. */
function collectEvents(log: string[] = []) {
  const events: ChatStreamEvent[] = []
  let resolveTerminal = (): void => {}
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve
  })

  return {
    events,
    terminal,
    emit: (event: ChatStreamEvent): void => {
      events.push(event)
      log.push(`emit:${event.type}`)
      if (event.type === 'finish' || event.type === 'error') resolveTerminal()
    },
    types: () => events.map((event) => event.type)
  }
}

const turnRequest = (client: ModelClient | null) => ({
  sessionId: 'session-1',
  notebookId: 'notebook-1',
  userContent: 'what does the document say?',
  messages: [{ role: 'user' as const, content: 'what does the document say?' }],
  client,
  retrieval: 'none' as const,
  sources: [],
  citations: [],
  citationContexts: []
})

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30))

test('a completed turn is persisted once, before the renderer hears about it', async () => {
  const log: string[] = []
  const { store, turns } = fakeStore(log)
  const autoSwitch = fakeAutoSwitch()
  const manager = new ChatStreamManager({ store, sessionAutoSwitchService: autoSwitch.service })
  const browser = collectEvents(log)

  const execution = manager.start({
    ...turnRequest(scriptedClient([...textChunks('the answer'), finishChunk('stop')])),
    emit: browser.emit
  })

  // Nothing has been streamed yet: the turn exists, waiting for its first token.
  assert.equal(execution.status, 'pending', 'a new turn was already streaming')
  assert.equal(manager.runningCount, 1, 'the running turn is not in the registry')

  await browser.terminal
  await settled()

  const record = turns.get(execution.messageId)
  assert.equal(record?.content, 'the answer', 'the answer was not persisted')
  assert.equal(record?.outcome?.status, 'completed', 'a completed turn was not recorded as one')
  assert.equal(record?.finishReason, 'stop', 'the provider reason was not persisted')
  assert.equal(record?.usage?.totalTokens, 8, 'the reported usage was not persisted')
  assert.equal(execution.status, 'completed', 'the execution did not settle')

  assert.deepEqual(browser.types(), ['text-delta', 'finish'], 'the renderer saw something else')
  assert.equal(manager.runningCount, 0, 'a finished turn is still in the registry')
  assert.equal(
    manager.getByMessageId(execution.messageId),
    undefined,
    'a finished turn is still findable'
  )

  // Invariant 4: the write happens first, so a failed write cannot leave the
  // transcript claiming a turn the database does not have.
  assert.ok(
    log.indexOf(`outcome:${execution.messageId}`) < log.indexOf('emit:finish'),
    `the renderer was told before the turn was written: ${log.join(' ')}`
  )
  assert.equal(autoSwitch.calls.length, 1, 'the turn was not accounted for')
})

test('a turn is streaming as soon as the first chunk arrives', async () => {
  const { store } = fakeStore()
  const manager = new ChatStreamManager({
    store,
    sessionAutoSwitchService: fakeAutoSwitch().service
  })

  const seen: string[] = []
  const execution = manager.start({
    ...turnRequest(scriptedClient([...textChunks('the answer'), finishChunk('stop')])),
    emit: (event) => {
      seen.push(event.type)
    }
  })

  assert.equal(execution.status, 'pending', 'a turn streams before its first chunk')
  await settled()
  assert.equal(execution.status, 'completed', 'the turn did not settle')
  assert.equal(seen.includes('text-delta'), true, 'no text was streamed')
})

test('truncation completes the turn with a stated reason, and is not a failure', async () => {
  const { store, turns } = fakeStore()
  const manager = new ChatStreamManager({
    store,
    sessionAutoSwitchService: fakeAutoSwitch().service
  })
  const browser = collectEvents()

  const execution = manager.start({
    ...turnRequest(
      scriptedClient([...textChunks('an answer that ran out'), finishChunk('length')])
    ),
    emit: browser.emit
  })

  await browser.terminal

  const record = turns.get(execution.messageId)
  assert.equal(record?.outcome?.status, 'truncated', 'truncation was not recorded as truncated')
  assert.equal(browser.types().includes('error'), false, 'truncation was reported as an error')
  // The live renderer reads the reason from the metadata (#137); #142 moves it to
  // the terminal state on the wire.
  assert.equal(record?.metadata?.finishReason, 'length', 'the reason did not reach the metadata')
})

test('an error inside the stream keeps the partial answer and reports a failure', async () => {
  const { store, turns } = fakeStore()
  const manager = new ChatStreamManager({
    store,
    sessionAutoSwitchService: fakeAutoSwitch().service
  })
  const browser = collectEvents()

  const execution = manager.start({
    ...turnRequest(
      scriptedClient([
        ...textChunks('half an answer'),
        { type: 'error', error: new Error('upstream provider returned 500') } as never,
        finishChunk('stop')
      ])
    ),
    emit: browser.emit
  })

  await browser.terminal

  const record = turns.get(execution.messageId)
  assert.equal(record?.outcome?.status, 'failed', 'a broken stream was not recorded as failed')
  assert.equal(
    record?.content,
    'half an answer',
    'a failed turn lost the partial answer it had produced'
  )
  assert.deepEqual(browser.types(), ['text-delta', 'error'], 'the renderer was told something else')
  assert.equal(manager.runningCount, 0, 'a failed turn is still in the registry')
})

test('a stop is recorded before it is acted on, and the AbortError cannot change it', async () => {
  const { store, turns } = fakeStore()
  const manager = new ChatStreamManager({
    store,
    sessionAutoSwitchService: fakeAutoSwitch().service
  })
  const browser = collectEvents()

  const execution = manager.start({
    ...turnRequest(abortableClient('the beginning of an answer')),
    emit: browser.emit
  })

  await settled()
  assert.equal(manager.abort(execution.messageId, 'user'), true, 'the stop was not accepted')
  assert.equal(execution.status, 'aborted', 'the stop did not settle the turn')

  // The stream errors on the signal and reports back afterwards; that report is
  // noise after the decision and must not re-label the turn.
  await settled()

  const record = turns.get(execution.messageId)
  assert.equal(record?.outcome?.status, 'aborted', 'the stop was overwritten by the abort error')
  assert.equal(
    record?.content,
    'the beginning of an answer',
    'a stopped turn lost its partial answer'
  )
  assert.equal(
    browser.types().includes('finish'),
    false,
    'a stopped turn was announced to the renderer as finished'
  )
  assert.equal(manager.runningCount, 0, 'a stopped turn is still in the registry')
})

test('a stop that arrives after the answer is complete does not re-label it', async () => {
  const { store, turns } = fakeStore()
  const manager = new ChatStreamManager({
    store,
    sessionAutoSwitchService: fakeAutoSwitch().service
  })
  const browser = collectEvents()

  const execution = manager.start({
    ...turnRequest(scriptedClient([...textChunks('a whole answer'), finishChunk('stop')])),
    emit: browser.emit
  })

  await browser.terminal

  assert.equal(
    manager.abort(execution.messageId, 'user'),
    false,
    'a finished turn was still stoppable'
  )
  assert.equal(
    turns.get(execution.messageId)?.outcome?.status,
    'completed',
    'a finished turn was re-labelled by a late stop'
  )
})

test('two turns in one notebook do not touch each other', async () => {
  const { store, turns } = fakeStore()
  const manager = new ChatStreamManager({
    store,
    sessionAutoSwitchService: fakeAutoSwitch().service
  })

  const firstBrowser = collectEvents()
  const secondBrowser = collectEvents()

  const first = manager.start({
    ...turnRequest(scriptedClient([...textChunks('first answer'), finishChunk('stop')])),
    emit: firstBrowser.emit
  })
  const second = manager.start({
    ...turnRequest(abortableClient('second answer, stopped')),
    emit: secondBrowser.emit
  })

  assert.equal(manager.runningCount, 2, 'the second turn displaced the first')

  await settled()
  assert.equal(manager.abort(second.messageId, 'user'), true, 'the second turn was not stoppable')
  await firstBrowser.terminal
  await settled()

  assert.equal(
    turns.get(first.messageId)?.outcome?.status,
    'completed',
    'the first turn was changed'
  )
  assert.equal(turns.get(first.messageId)?.content, 'first answer', 'the first answer was changed')
  assert.equal(
    turns.get(second.messageId)?.outcome?.status,
    'aborted',
    'the second turn was not stopped'
  )
  assert.equal(turns.get(second.messageId)?.content, 'second answer, stopped')
  assert.equal(manager.runningCount, 0, 'turns leaked in the registry')
})

test('a turn that cannot start is still a turn with an outcome', async () => {
  const { store, turns } = fakeStore()
  const manager = new ChatStreamManager({
    store,
    sessionAutoSwitchService: fakeAutoSwitch().service
  })

  const noPrompt = collectEvents()
  const withoutHistory = manager.start({
    ...turnRequest(scriptedClient([finishChunk('stop')])),
    messages: [],
    emit: noPrompt.emit
  })

  assert.equal(withoutHistory.status, 'failed', 'an empty prompt did not fail the turn')
  assert.equal(
    turns.get(withoutHistory.messageId)?.outcome?.status,
    'failed',
    'a turn that could not start was not persisted'
  )
  assert.deepEqual(noPrompt.types(), ['error'], 'the renderer was not told the turn failed')
  assert.equal(manager.runningCount, 0, 'a turn that never started is still running')

  const noModel = collectEvents()
  const withoutModel = manager.start({ ...turnRequest(null), emit: noModel.emit })

  assert.equal(withoutModel.status, 'failed', 'a missing chat model did not fail the turn')
  assert.deepEqual(noModel.types(), ['error'], 'the renderer was not told the model was missing')
  assert.equal(manager.runningCount, 0, 'a turn with no model is still running')
})

test('token accounting runs for every ending and never decides one', async () => {
  const { store, turns } = fakeStore()
  const autoSwitch = fakeAutoSwitch('session-2')
  const manager = new ChatStreamManager({ store, sessionAutoSwitchService: autoSwitch.service })
  const browser = collectEvents()

  const execution = manager.start({
    ...turnRequest(scriptedClient([...textChunks('a short answer'), finishChunk('stop')])),
    emit: browser.emit
  })

  await browser.terminal
  await settled()

  // The provider reported usage, so that is what is accounted for.
  assert.deepEqual(autoSwitch.calls, [{ sessionId: 'session-1', tokensUsed: 8 }])
  assert.equal(
    browser.events.some((event) => event.type === 'session-auto-switched'),
    true,
    'the session switch was not announced'
  )
  assert.equal(
    turns.get(execution.messageId)?.outcome?.status,
    'completed',
    'accounting changed the turn'
  )
})
