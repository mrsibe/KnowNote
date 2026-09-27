import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV2, simulateReadableStream } from 'ai/test'
import type { LanguageModelV2FinishReason, LanguageModelV2StreamPart } from '@ai-sdk/provider'
import { ModelClient } from '../src/main/models/ModelClient.ts'
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
 * These tests pin the three outcomes apart, because they are not the same
 * statement: completed, truncated at the output ceiling, and failed.
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
  errors: Error[]
  completed: boolean
}

/** Drives the real client, with the provider replaced by a scripted stream. */
function runStream(chunks: LanguageModelV2StreamPart[]): Promise<Outcome> {
  const model = new MockLanguageModelV2({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [{ type: 'stream-start', warnings: [] }, ...chunks] as never[]
      })
    })
  })

  const client = new ModelClient('chat', connection)
  // `getAIModel` is the only thing that reaches the provider, so this substitutes
  // the scripted model without a test-only seam in the production class.
  client.getAIModel = () => model

  return new Promise<Outcome>((resolve, reject) => {
    const outcome: Outcome = { chunks: [], errors: [], completed: false }
    const timer = setTimeout(() => reject(new Error('the stream never reported an outcome')), 5_000)

    void client.sendMessageStream(
      [{ role: 'user', content: 'hello' }],
      (chunk) => outcome.chunks.push(chunk),
      (error) => {
        outcome.errors.push(error)
        clearTimeout(timer)
        resolve(outcome)
      },
      () => {
        outcome.completed = true
        clearTimeout(timer)
        resolve(outcome)
      }
    )
  })
}

test('a clean stream completes and reports its provider finish reason', async () => {
  const outcome = await runStream([...textChunks('a complete answer'), finishChunk('stop')])

  assert.equal(outcome.errors.length, 0, 'a clean stream reported an error')
  assert.equal(outcome.completed, true, 'a clean stream did not complete')
  assert.equal(
    outcome.chunks.map((chunk) => chunk.content).join(''),
    'a complete answer',
    'the answer text was not delivered'
  )

  const done = outcome.chunks.at(-1)
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
  const outcome = await runStream([
    ...textChunks('the beginning of an answer'),
    { type: 'error', error: new Error('upstream provider returned 500') } as never,
    ...textChunks(' and it continues after the failure'),
    finishChunk('stop')
  ])

  assert.equal(outcome.errors.length, 1, 'the in-stream error was not reported')
  assert.match(outcome.errors[0].message, /upstream provider returned 500/)
  assert.equal(outcome.completed, false, 'a failed stream was reported as a completed answer')
  assert.equal(
    outcome.chunks.some((chunk) => chunk.done),
    false,
    'a failed stream still emitted the terminal chunk, so the truncated answer reads as finished'
  )
})

test('the output ceiling is reported as a finish reason, not as a failure', async () => {
  // Truncation is a completion with a stated reason. Treating it as an error
  // would discard an answer the reader can still use.
  const outcome = await runStream([
    ...textChunks('an answer that ran out of room'),
    finishChunk('length')
  ])

  assert.equal(outcome.errors.length, 0, 'truncation was reported as an error')
  assert.equal(outcome.completed, true, 'truncation did not complete')
  assert.equal(
    outcome.chunks.at(-1)?.metadata?.finishReason,
    'length',
    'the length ceiling was not reported, so a truncated answer is indistinguishable from a whole one'
  )
})
