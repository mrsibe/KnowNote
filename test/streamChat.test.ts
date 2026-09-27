import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV2, simulateReadableStream } from 'ai/test'
import type { LanguageModelV2StreamPart } from '@ai-sdk/provider'
import type { UIMessageChunk } from 'ai'
import { ModelClient } from '../src/main/models/ModelClient.ts'
import type { ModelConnection } from '../src/shared/types/connection.ts'

/**
 * What the AI SDK seam guarantees (#141).
 *
 * `ModelClient.streamChat` answers one question — given a model and messages, give
 * me a stream — and hands back the SDK's own UI events. These tests pin the three
 * things the layers above depend on: the events are the SDK's (nothing is filtered
 * down to a shape of our own), a provider failure arrives as an event *with its real
 * message*, and the signal the caller passes is the one that cancels the request.
 */

const connection: ModelConnection = {
  protocol: 'openai-completions',
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'test-key',
  modelId: 'test-model'
}

const collect = async (events: AsyncIterable<UIMessageChunk>): Promise<string[]> => {
  const types: string[] = []
  for await (const event of events) types.push(event.type)
  return types
}

/** Waits for a condition instead of sleeping, so the tests do not race the stream. */
const waitFor = async (condition: () => boolean, timeoutMs = 1000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('the condition never became true')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const clientFor = (chunks: LanguageModelV2StreamPart[]): ModelClient => {
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

/** Builds a client and hands back the model, so the call args can be inspected. */
const inspectingClient = (
  connectionOverride: Partial<ModelConnection>
): { client: ModelClient; model: MockLanguageModelV2 } => {
  const model = new MockLanguageModelV2({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          {
            type: 'finish',
            finishReason: 'stop',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
          }
        ] as never[]
      })
    })
  })
  const client = new ModelClient('chat', { ...connection, ...connectionOverride })
  client.getAIModel = () => model
  return { client, model }
}

test('the stream is the SDK’s own event stream, not a reduced protocol of ours', async () => {
  const client = clientFor([
    { type: 'reasoning-start', id: 'r1' },
    { type: 'reasoning-delta', id: 'r1', delta: 'thinking' },
    { type: 'reasoning-end', id: 'r1' },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: 'the answer' },
    { type: 'text-end', id: 't1' },
    {
      type: 'finish',
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
    }
  ])

  const types = await collect(client.streamChat([{ role: 'user', content: 'hi' }]).events)

  // Every one of these had no place in the old `text-delta | reasoning-delta |
  // finish` protocol, and each is now delivered rather than dropped.
  for (const expected of [
    'start',
    'start-step',
    'reasoning-start',
    'reasoning-delta',
    'reasoning-end',
    'text-start',
    'text-delta',
    'text-end',
    'finish-step',
    'finish'
  ]) {
    assert.ok(types.includes(expected), `the ${expected} event never reached the caller`)
  }
})

test('a provider error arrives as an event carrying its real message', async () => {
  const client = clientFor([
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: 'half' },
    { type: 'error', error: new Error('upstream provider returned 500') } as never,
    { type: 'text-end', id: 't1' },
    {
      type: 'finish',
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
    }
  ])

  const seen: UIMessageChunk[] = []
  for await (const event of client.streamChat([{ role: 'user', content: 'hi' }]).events) {
    seen.push(event)
  }

  const error = seen.find((event) => event.type === 'error')
  assert.ok(error, 'the provider error never became an event')
  // The SDK would answer "An error occurred." if the seam did not pass its own
  // `onError` through, and the reader would lose the only explanation they get.
  assert.match(
    (error as Extract<UIMessageChunk, { type: 'error' }>).errorText,
    /upstream provider returned 500/
  )
})

test('a transport failure surfaces as a rejection, which the owner turns into an outcome', async () => {
  const model = new MockLanguageModelV2({
    doStream: async () => ({
      stream: new ReadableStream({
        async start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          await new Promise((resolve) => setTimeout(resolve, 5))
          controller.error(new Error('socket hang up'))
        }
      }) as never
    })
  })
  const client = new ModelClient('chat', connection)
  client.getAIModel = () => model

  await assert.rejects(
    () => collect(client.streamChat([{ role: 'user', content: 'hi' }]).events),
    /socket hang up/
  )
})

test('the signal the caller passes is the one that cancels the request', async () => {
  // What #145 got wrong: the execution owned a signal that nothing used, so the
  // provider stream kept running and only the bookkeeping was stopped.
  let observed: AbortSignal | undefined
  const model = new MockLanguageModelV2({
    doStream: async ({ abortSignal }) => {
      observed = abortSignal
      return {
        stream: new ReadableStream({
          async start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({
              type: 'text-start',
              id: 't1'
            } as never)
            await new Promise<void>((resolve) => {
              if (!abortSignal || abortSignal.aborted) resolve()
              else abortSignal.addEventListener('abort', () => resolve(), { once: true })
            })
            controller.error(new DOMException('The operation was aborted.', 'AbortError'))
          }
        }) as never
      }
    }
  })
  const client = new ModelClient('chat', connection)
  client.getAIModel = () => model

  const controller = new AbortController()
  const events = client.streamChat([{ role: 'user', content: 'hi' }], {
    signal: controller.signal
  }).events

  const seen: string[] = []
  const streaming = (async () => {
    for await (const event of events) seen.push(event.type)
  })()

  // The provider call is made on the first read, not when `streamChat` returns, so
  // this waits for it rather than assuming a turn of the event loop.
  await waitFor(() => observed !== undefined)
  assert.equal(observed, controller.signal, 'the caller’s signal was not handed to the provider')

  controller.abort()

  // The UI stream ends rather than rejecting: the SDK turns an abort into an
  // `abort` event, which is what the manager reads as a stop. What matters here is
  // that the stream that ends is this one — the request the caller could cancel.
  await streaming
  assert.equal(seen.at(-1), 'abort', 'an aborted request did not end as an abort')
})

test('no ceiling is sent unless the connection asks for one', async () => {
  // The reasoning-model case: thinking tokens share this budget, so a hard-coded
  // default was a ceiling reached early (#150).
  const withoutCeiling = inspectingClient({})
  await collect(withoutCeiling.client.streamChat([{ role: 'user', content: 'hi' }]).events)
  assert.equal(
    withoutCeiling.model.doStreamCalls[0]?.maxOutputTokens,
    undefined,
    'a ceiling was sent for a connection that asked for none'
  )

  const withCeiling = inspectingClient({ maxOutputTokens: 8192 })
  await collect(withCeiling.client.streamChat([{ role: 'user', content: 'hi' }]).events)
  assert.equal(withCeiling.model.doStreamCalls[0]?.maxOutputTokens, 8192)
})
