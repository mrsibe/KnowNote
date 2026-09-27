import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV2, simulateReadableStream } from 'ai/test'
import type { LanguageModelV2FinishReason, LanguageModelV2StreamPart } from '@ai-sdk/provider'
import { ModelClient, type ChatStreamHandlers } from '../src/main/models/ModelClient.ts'
import type { ModelConnection } from '../src/shared/types/connection.ts'
import type { StreamChunk } from '../src/shared/types/chat.ts'

/**
 * What a stream that ends *badly* reports.
 *
 * `fullStream` only throws the errors that stop the stream — network errors. A
 * provider that fails inside an otherwise healthy streaming response (rate limit,
 * upstream 5xx, content filter) delivers an `error` part instead. That part used
 * to fall through the switch untouched, so the loop went on to emit its `done`
 * chunk: the renderer showed a completed answer, `chatHandlers` persisted the
 * truncated text, and the only thing the reader could see was the answer
 * stopping mid-sentence for no stated reason.
 *
 * The tests here pin the ways a turn can end apart from each other, because the
 * whole bug class they come from is two of them being reported as the same thing
 * (#138):
 *
 *   completed  a positive terminal signal (an AI SDK `finish` part)
 *   failed     the provider said so, or the stream threw
 *   aborted    the caller stopped it
 *
 * `aborted` used to be reported through `onComplete`, which is how a stopped turn
 * was persisted and rendered as a finished one. What a *missing* terminal reason
 * means is decided by `classifyTerminal` and tested in `chatExecution.test.ts`.
 */

const connection: ModelConnection = {
  protocol: 'openai-completions',
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'test-key',
  modelId: 'test-model'
}

/** The provider's chunks for a short answer. */
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

interface Outcome {
  chunks: StreamChunk[]
  errors: Array<{ error: Error; reason: string }>
  completed: boolean
  aborted: boolean
}

/**
 * A provider stream that reacts to the abort signal the way a real transport
 * does: it errors out instead of quietly closing. A stream that ignores the
 * signal would leave the SDK's iterator open forever — which is a property of
 * that fake, not of the code under test.
 */
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

/** Drives the real client, with the provider replaced by a scripted stream. */
function runStream(
  chunks: LanguageModelV2StreamPart[],
  options: { abortAfterMs?: number; text?: string } = {}
): { outcome: Promise<Outcome>; abort: () => void } {
  const model = new MockLanguageModelV2({
    doStream: async ({ abortSignal }) => ({
      stream: options.abortAfterMs
        ? (abortableStream(abortSignal, options.text ?? '') as never)
        : simulateReadableStream({
            chunks: [{ type: 'stream-start', warnings: [] }, ...chunks] as never[]
          })
    })
  })

  const client = new ModelClient('chat', connection)
  // `getAIModel` is the only thing that reaches the provider, so this substitutes
  // the scripted model without a test-only seam in the production class.
  client.getAIModel = () => model

  let abort = (): void => {}
  const outcome = new Promise<Outcome>((resolve, reject) => {
    const result: Outcome = { chunks: [], errors: [], completed: false, aborted: false }
    const timer = setTimeout(() => reject(new Error('the stream never reported an outcome')), 5_000)
    const finish = (): void => {
      clearTimeout(timer)
      resolve(result)
    }

    const handlers: ChatStreamHandlers = {
      onChunk: (chunk) => result.chunks.push(chunk),
      onError: (error, reason) => {
        result.errors.push({ error, reason })
        finish()
      },
      onAbort: () => {
        result.aborted = true
        finish()
      },
      onComplete: () => {
        result.completed = true
        finish()
      }
    }

    void client
      .sendMessageStream([{ role: 'user', content: 'hello' }], handlers)
      .then((controller) => {
        abort = () => controller.abort()
        if (options.abortAfterMs !== undefined) {
          setTimeout(abort, options.abortAfterMs)
        }
      })
  })

  return { outcome, abort: () => abort() }
}

test('a clean stream completes and reports its provider finish reason', async () => {
  const { outcome } = runStream([...textChunks('a complete answer'), finishChunk('stop')])
  const result = await outcome

  assert.equal(result.errors.length, 0, 'a clean stream reported an error')
  assert.equal(result.completed, true, 'a clean stream did not complete')
  assert.equal(
    result.chunks.map((chunk) => chunk.content).join(''),
    'a complete answer',
    'the answer text was not delivered'
  )

  const done = result.chunks.at(-1)
  assert.equal(done?.done, true, 'the last chunk was not the terminal one')
  assert.equal(
    done?.metadata?.finishReason,
    'stop',
    'the finish reason did not reach the caller, so the UI cannot tell why the answer ended'
  )
})

test('an error inside the stream fails the turn instead of completing it', async () => {
  // The trailing text and the `finish` chunk are deliberate: the SDK keeps
  // delivering after an error part, and the stream still closes cleanly. Only the
  // error part says the answer is not usable.
  const { outcome } = runStream([
    ...textChunks('the beginning of an answer'),
    { type: 'error', error: new Error('upstream provider returned 500') } as never,
    ...textChunks(' and it continues after the failure'),
    finishChunk('stop')
  ])
  const result = await outcome

  assert.equal(result.errors.length, 1, 'the in-stream error was not reported')
  assert.match(result.errors[0].error.message, /upstream provider returned 500/)
  assert.equal(result.errors[0].reason, 'error', 'a provider failure was not reported as one')
  assert.equal(result.completed, false, 'a failed stream was reported as a completed answer')
  assert.equal(
    result.chunks.some((chunk) => chunk.done),
    false,
    'a failed stream still emitted the terminal chunk, so the truncated answer reads as finished'
  )
})

test('the output ceiling is reported as a finish reason, not as a failure', async () => {
  // Truncation is a completion with a stated reason. Treating it as an error
  // would discard an answer the reader can still use.
  const { outcome } = runStream([
    ...textChunks('an answer that ran out of room'),
    finishChunk('length')
  ])
  const result = await outcome

  assert.equal(result.errors.length, 0, 'truncation was reported as an error')
  assert.equal(result.completed, true, 'truncation did not complete')
  assert.equal(
    result.chunks.at(-1)?.metadata?.finishReason,
    'length',
    'the length ceiling was not reported, so a truncated answer is indistinguishable from a whole one'
  )
})

test('a cleanly closed stream still carries the SDK terminal part, with an unnamed reason', async () => {
  // Pins the SDK contract this whole path stands on: `streamText` emits a
  // `finish` part whenever the model stream closes cleanly, and fills in
  // 'unknown' when the provider named no reason (ai@5.0.265). This test is what
  // makes "no terminal part at all" a fact rather than an assumption — see
  // `classifyTerminal` for what that case means for the turn.
  const { outcome } = runStream([...textChunks('text, and then nothing at all')])
  const result = await outcome

  assert.equal(result.errors.length, 0, 'the SDK terminal part was reported as an error')
  assert.equal(result.completed, true, 'the SDK terminal part did not complete the stream')
  assert.equal(
    result.chunks.at(-1)?.metadata?.finishReason,
    'unknown',
    'the SDK stopped synthesising a finish reason, so a missing one no longer proves anything'
  )
})

test('an abort is reported as an abort, never as a completion', async () => {
  // `onComplete` here is how `aborted` used to be persisted and rendered as
  // `completed`: the reader stopped the turn and the app said it had finished.
  const { outcome } = runStream([], {
    abortAfterMs: 20,
    text: 'partial answer before the reader hit stop'
  })
  const result = await outcome

  assert.equal(result.aborted, true, 'the abort was not reported')
  assert.equal(result.completed, false, 'an aborted turn was reported as a completed answer')
  assert.equal(
    result.chunks.some((chunk) => chunk.done),
    false,
    'an aborted turn still emitted the terminal chunk'
  )
})
