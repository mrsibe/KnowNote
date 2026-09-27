import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV2, simulateReadableStream } from 'ai/test'
import type { LanguageModelV2FinishReason, LanguageModelV2StreamPart } from '@ai-sdk/provider'
import { ModelClient } from '../src/main/models/ModelClient.ts'
import {
  ChatStreamManager,
  type ChatTurnStore
} from '../src/main/services/chat/ChatStreamManager.ts'
import { MAX_ATTEMPTS } from '../src/main/services/chat/retryPolicy.ts'
import type {
  ChatExecutionOutcome,
  ChatMessageMetadata,
  ChatTokenUsage,
  ChatTurnEvent
} from '../src/shared/types/chat.ts'
import type { ModelConnection } from '../src/shared/types/connection.ts'

/**
 * What crosses the process boundary while a turn runs, and who decides what it was
 * (#141).
 *
 * The events the renderer receives are the SDK's own, forwarded verbatim: nothing
 * here can drop an event type it does not recognise, which is what the old reduced
 * protocol did to an `error` part (#137). The terminal chunks are the one exception,
 * and they are not lost — the manager's own `outcome` event carries what they said,
 * *after* the turn is persisted (#138 invariant 4).
 *
 * These tests drive the real manager through the real `ModelClient` with a scripted
 * provider.
 */

const connection: ModelConnection = {
  protocol: 'openai-completions',
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'test-key',
  modelId: 'test-model'
}

/** Provider-vocabulary chunks: `delta`, not `text`, and a terminal `finish`. */
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

/**
 * A provider that holds the connection open until the signal is aborted, the way a
 * real transport does, and reports whether it saw the cancel.
 */
function abortableClient(text: string): { client: ModelClient; cancelled: () => boolean } {
  let cancelled = false
  const model = new MockLanguageModelV2({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({
        async start(controller) {
          for (const chunk of [
            { type: 'stream-start', warnings: [] },
            ...textChunks(text)
          ] as never[]) {
            controller.enqueue(chunk)
          }
          await new Promise<void>((resolve) => {
            if (!abortSignal || abortSignal.aborted) resolve()
            else
              abortSignal.addEventListener(
                'abort',
                () => {
                  cancelled = true
                  resolve()
                },
                { once: true }
              )
          })
          controller.error(new DOMException('The operation was aborted.', 'AbortError'))
        }
      }) as never
    })
  })
  const client = new ModelClient('chat', connection)
  client.getAIModel = () => model
  return { client, cancelled: () => cancelled }
}

/** A provider whose stream dies mid-flight, as a dropped connection would. */
function erroringClient(text: string): ModelClient {
  const model = new MockLanguageModelV2({
    doStream: async () => ({
      stream: new ReadableStream({
        async start(controller) {
          for (const chunk of [
            { type: 'stream-start', warnings: [] },
            ...textChunks(text)
          ] as never[]) {
            controller.enqueue(chunk)
          }
          await new Promise((resolve) => setTimeout(resolve, 5))
          controller.error(new Error('socket hang up'))
        }
      }) as never
    })
  })
  const client = new ModelClient('chat', connection)
  client.getAIModel = () => model
  return client
}

/**
 * A provider whose first `failures` attempts die with `message`, and whose later
 * attempts answer. Counts the calls, because "was it retried" is the point.
 */
function flakyClient(
  failures: number,
  message: string,
  text: string
): { client: ModelClient; calls: () => number } {
  const model = new MockLanguageModelV2({
    doStream: async () => {
      const attempt = model.doStreamCalls.length
      if (attempt <= failures) {
        return {
          stream: new ReadableStream({
            async start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] })
              await new Promise((resolve) => setTimeout(resolve, 5))
              controller.error(new Error(message))
            }
          }) as never
        }
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            ...textChunks(text),
            finishChunk('stop')
          ] as never[]
        })
      }
    }
  })
  const client = new ModelClient('chat', connection)
  client.getAIModel = () => model
  return { client, calls: () => model.doStreamCalls.length }
}

/**
 * A provider that sends an answer and then holds the connection open, which is what
 * the idle deadline is for.
 */
function silentClient(text: string): { client: ModelClient; cancelled: () => boolean } {
  let cancelled = false
  const model = new MockLanguageModelV2({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({
        async start(controller) {
          for (const chunk of [
            { type: 'stream-start', warnings: [] },
            ...textChunks(text)
          ] as never[]) {
            controller.enqueue(chunk)
          }
          await new Promise<void>((resolve) => {
            if (!abortSignal || abortSignal.aborted) resolve()
            else
              abortSignal.addEventListener(
                'abort',
                () => {
                  cancelled = true
                  resolve()
                },
                { once: true }
              )
          })
          // A real transport reports the cancellation by erroring the stream; a mock
          // that just goes quiet would leave the reader waiting forever.
          controller.error(new DOMException('The operation was aborted.', 'AbortError'))
        }
      }) as never
    })
  })
  const client = new ModelClient('chat', connection)
  client.getAIModel = () => model
  return { client, cancelled: () => cancelled }
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

/** A store that records what was written, into a log shared with the event spy. */
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

/** Collects the events the renderer would receive. */
function collectEvents(log: string[] = []) {
  const events: ChatTurnEvent[] = []
  let resolveOutcome = (): void => {}
  const outcome = new Promise<void>((resolve) => {
    resolveOutcome = resolve
  })

  return {
    events,
    outcome,
    emit: (event: ChatTurnEvent): void => {
      events.push(event)
      log.push(`emit:${event.type}`)
      if (event.type === 'outcome') resolveOutcome()
    },
    /** The forwarded chunks' SDK event types, in order. */
    chunkTypes: () => events.flatMap((event) => (event.type === 'chunk' ? [event.event.type] : [])),
    outcomeEvent: () => events.find((event) => event.type === 'outcome')
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

/** Waits for a condition instead of sleeping, so the tests do not race the stream. */
const waitFor = async (condition: () => boolean, timeoutMs = 1000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('the condition never became true')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test('the SDK events are forwarded as they are, and the terminal chunk is not', async () => {
  const log: string[] = []
  const { store, turns } = fakeStore(log)
  const autoSwitch = fakeAutoSwitch()
  const manager = new ChatStreamManager({ store, sessionAutoSwitchService: autoSwitch.service })
  const browser = collectEvents(log)

  const execution = manager.start({
    ...turnRequest(
      scriptedClient([
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: 'thinking' },
        { type: 'reasoning-end', id: 'r1' },
        ...textChunks('the answer'),
        finishChunk('stop')
      ])
    ),
    emit: browser.emit
  })

  assert.equal(execution.status, 'pending', 'a new turn was already streaming')
  await browser.outcome
  await settled()

  // Everything the old protocol dropped or reduced, arriving as the SDK made it:
  // `start` / `start-step` / `text-start` / `text-end` / `finish-step` carried no
  // place in a `text-delta | reasoning-delta | finish` protocol.
  assert.deepEqual(browser.chunkTypes(), [
    'start',
    'start-step',
    'reasoning-start',
    'reasoning-delta',
    'reasoning-end',
    'text-start',
    'text-delta',
    'text-end',
    'finish-step'
  ])
  assert.equal(
    browser.chunkTypes().includes('finish'),
    false,
    'the terminal chunk was forwarded, so the renderer was told the turn ended before it was persisted'
  )

  // Sequence numbers are contiguous from 1, which is what makes a gap detectable.
  const seqs = browser.events.flatMap((event) => (event.type === 'chunk' ? [event.seq] : []))
  assert.deepEqual(
    seqs,
    seqs.map((_, index) => index + 1)
  )

  const record = turns.get(execution.messageId)
  assert.equal(record?.content, 'the answer', 'the answer was not assembled from the events')
  assert.equal(record?.reasoningContent, 'thinking', 'the reasoning was not assembled')
  assert.equal(record?.outcome?.status, 'completed')
  assert.equal(record?.finishReason, 'stop', 'the provider reason was not persisted')
  assert.equal(record?.usage?.totalTokens, 8, 'the reported usage was not persisted')

  const outcomeEvent = browser.outcomeEvent()
  assert.equal(outcomeEvent?.type, 'outcome')
  assert.equal(outcomeEvent?.outcome.status, 'completed')
  assert.equal(outcomeEvent?.finishReason, 'stop')
  assert.equal(outcomeEvent?.usage?.totalTokens, 8)

  // One home for one fact: the provider's reason is on the outcome event and in the
  // record's `finish_reason`, not copied into the provenance bag. It rode there from
  // #137 to #142 only because the transcript had no status to render from.
  assert.equal(
    (outcomeEvent?.messageMetadata as ChatMessageMetadata | undefined)?.finishReason,
    undefined,
    'the finish reason was written into the metadata bag again'
  )

  // Invariant 4: the write happens first, so a failed write cannot leave the
  // transcript claiming a turn the database does not have.
  assert.ok(
    log.indexOf(`outcome:${execution.messageId}`) < log.indexOf('emit:outcome'),
    `the renderer was told before the turn was written: ${log.join(' ')}`
  )

  assert.equal(manager.runningCount, 0, 'a finished turn is still in the registry')
  assert.equal(autoSwitch.calls.length, 1, 'the turn was not accounted for')
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

  await browser.outcome

  assert.equal(turns.get(execution.messageId)?.outcome?.status, 'truncated')
  assert.equal(browser.outcomeEvent()?.outcome.status, 'truncated')
})

test('an error chunk fails the turn, and keeps the part that arrived', async () => {
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

  await browser.outcome

  const record = turns.get(execution.messageId)
  assert.equal(record?.outcome?.status, 'failed', 'a broken stream was not recorded as failed')
  assert.equal(record?.content, 'half an answer', 'a failed turn lost its partial answer')
  if (record?.outcome?.status !== 'failed') throw new Error('unreachable')
  assert.match(
    record.outcome.error.message,
    /upstream provider returned 500/,
    'the real provider error did not survive to the outcome'
  )
  assert.equal(browser.outcomeEvent()?.outcome.status, 'failed')
})

test('a dropped connection fails the turn, and keeps the part that arrived', async () => {
  const { store, turns } = fakeStore()
  const manager = new ChatStreamManager({
    store,
    sessionAutoSwitchService: fakeAutoSwitch().service
  })
  const browser = collectEvents()

  const execution = manager.start({
    ...turnRequest(erroringClient('half an answer')),
    emit: browser.emit
  })

  await browser.outcome

  const record = turns.get(execution.messageId)
  assert.equal(record?.outcome?.status, 'failed')
  assert.equal(record?.content, 'half an answer', 'a dropped connection lost the partial answer')
  if (record?.outcome?.status !== 'failed') throw new Error('unreachable')
  assert.match(record.outcome.error.message, /socket hang up/)
})

test('a stop is recorded before it is acted on, and cancels the provider request', async () => {
  const { store, turns } = fakeStore()
  const manager = new ChatStreamManager({
    store,
    sessionAutoSwitchService: fakeAutoSwitch().service
  })
  const browser = collectEvents()
  const provider = abortableClient('the beginning of an answer')

  const execution = manager.start({
    ...turnRequest(provider.client),
    emit: browser.emit
  })

  // Wait for the answer to start arriving, so the stop lands mid-turn rather than
  // before the first chunk.
  await waitFor(() => browser.chunkTypes().includes('text-delta'))
  assert.equal(manager.abort(execution.messageId, 'user'), true, 'the stop was not accepted')
  assert.equal(execution.status, 'aborted', 'the stop did not settle the turn')

  // The point of the signal belonging to the execution: the provider request is
  // actually cancelled, not merely recorded as stopped.
  await settled()
  assert.equal(provider.cancelled(), true, 'the provider request was never cancelled')
  assert.equal(execution.signal.aborted, true)

  const record = turns.get(execution.messageId)
  assert.equal(record?.outcome?.status, 'aborted', 'the stop was overwritten by the AbortError')
  assert.equal(
    record?.content,
    'the beginning of an answer',
    'a stopped turn lost its partial answer'
  )

  // The renderer is told, because that event is also what ends the stream it
  // assembles — and `aborted` is not a claim that the answer finished.
  assert.equal(browser.outcomeEvent()?.outcome.status, 'aborted')
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

  await browser.outcome

  assert.equal(manager.abort(execution.messageId, 'user'), false, 'a finished turn was stoppable')
  assert.equal(turns.get(execution.messageId)?.outcome?.status, 'completed')
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
    ...turnRequest(abortableClient('second answer, stopped').client),
    emit: secondBrowser.emit
  })

  assert.equal(manager.runningCount, 2, 'the second turn displaced the first')
  await waitFor(() => secondBrowser.chunkTypes().includes('text-delta'))
  assert.equal(manager.abort(second.messageId, 'user'), true)
  await firstBrowser.outcome
  await settled()

  assert.equal(turns.get(first.messageId)?.outcome?.status, 'completed')
  assert.equal(turns.get(first.messageId)?.content, 'first answer')
  assert.equal(turns.get(second.messageId)?.outcome?.status, 'aborted')
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
  assert.equal(turns.get(withoutHistory.messageId)?.outcome?.status, 'failed')
  assert.equal(noPrompt.outcomeEvent()?.outcome.status, 'failed')
  assert.equal(manager.runningCount, 0, 'a turn that never started is still running')

  const noModel = collectEvents()
  const withoutModel = manager.start({ ...turnRequest(null), emit: noModel.emit })

  assert.equal(withoutModel.status, 'failed', 'a missing chat model did not fail the turn')
  assert.equal(noModel.outcomeEvent()?.outcome.status, 'failed')
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

  await browser.outcome
  await settled()

  assert.deepEqual(autoSwitch.calls, [{ sessionId: 'session-1', tokensUsed: 8 }])
  assert.equal(
    browser.events.some((event) => event.type === 'session-auto-switched'),
    true,
    'the session switch was not announced'
  )
  assert.equal(turns.get(execution.messageId)?.outcome?.status, 'completed')
})

test('a transient failure before anything is shown is retried, and the answer arrives', async () => {
  const { store, turns } = fakeStore()
  const manager = new ChatStreamManager({
    store,
    sessionAutoSwitchService: fakeAutoSwitch().service
  })
  const browser = collectEvents()
  const provider = flakyClient(1, '429 Too Many Requests', 'the answer, second try')

  const execution = manager.start({ ...turnRequest(provider.client), emit: browser.emit })
  await browser.outcome

  assert.equal(execution.status, 'completed', 'the retry did not produce an answer')
  assert.equal(turns.get(execution.messageId)?.content, 'the answer, second try')
  assert.equal(provider.calls(), 2, 'the turn was not attempted twice')
  // Nothing of the first attempt reached the reader.
  assert.equal(
    browser.chunkTypes().includes('text-delta'),
    true,
    'the second attempt’s answer was never forwarded'
  )
})

test('a transient failure after content has been shown is reported, not retried', async () => {
  const { store, turns } = fakeStore()
  const manager = new ChatStreamManager({
    store,
    sessionAutoSwitchService: fakeAutoSwitch().service
  })
  const browser = collectEvents()

  const execution = manager.start({
    ...turnRequest(erroringClient('half an answer')),
    emit: browser.emit
  })
  await browser.outcome

  // 'socket hang up' is transient, but the reader already has half an answer: a
  // second attempt would duplicate or silently replace it.
  assert.equal(turns.get(execution.messageId)?.outcome?.status, 'failed')
  assert.equal(turns.get(execution.messageId)?.content, 'half an answer')
})

test('a deterministic failure is not retried', async () => {
  const { store, turns } = fakeStore()
  const manager = new ChatStreamManager({
    store,
    sessionAutoSwitchService: fakeAutoSwitch().service
  })
  const browser = collectEvents()
  const provider = flakyClient(99, 'invalid api key', 'never')

  const execution = manager.start({ ...turnRequest(provider.client), emit: browser.emit })
  await browser.outcome

  assert.equal(provider.calls(), 1, 'a deterministic failure was retried')
  assert.equal(turns.get(execution.messageId)?.outcome?.status, 'failed')
})

test('retries are bounded, so a provider that is down is not hammered', async () => {
  const { store, turns } = fakeStore()
  const manager = new ChatStreamManager({
    store,
    sessionAutoSwitchService: fakeAutoSwitch().service
  })
  const browser = collectEvents()
  const provider = flakyClient(99, '503 Service Unavailable', 'never')

  const execution = manager.start({ ...turnRequest(provider.client), emit: browser.emit })
  await browser.outcome

  assert.equal(provider.calls(), MAX_ATTEMPTS, 'the attempts were not bounded')
  assert.equal(turns.get(execution.messageId)?.outcome?.status, 'failed')
})

test('a stream that goes quiet is cancelled and fails with a timeout', async () => {
  const { store, turns } = fakeStore()
  const manager = new ChatStreamManager({
    store,
    sessionAutoSwitchService: fakeAutoSwitch().service,
    idleTimeoutMs: 30
  })
  const browser = collectEvents()
  const provider = silentClient('half an answer, then silence')

  const execution = manager.start({ ...turnRequest(provider.client), emit: browser.emit })
  await browser.outcome

  assert.equal(provider.cancelled(), true, 'the silent request was never cancelled')
  const record = turns.get(execution.messageId)
  assert.equal(record?.outcome?.status, 'failed')
  assert.equal(
    record?.content,
    'half an answer, then silence',
    'the deadline dropped the part that had arrived'
  )
  if (record?.outcome?.status !== 'failed') throw new Error('unreachable')
  assert.equal(record.outcome.reason, 'timeout', 'the failure was not recorded as a timeout')
})
