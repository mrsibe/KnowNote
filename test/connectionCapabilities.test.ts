import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV2, simulateReadableStream } from 'ai/test'
import { ModelClient } from '../src/main/models/ModelClient.ts'
import { openaiCompletionsAdapter } from '../src/main/models/protocols/openaiCompletions.ts'
import { openaiResponsesAdapter } from '../src/main/models/protocols/openaiResponses.ts'
import { anthropicMessagesAdapter } from '../src/main/models/protocols/anthropicMessages.ts'
import { googleGenerativeAiAdapter } from '../src/main/models/protocols/googleGenerativeAi.ts'
import type { ModelConnection } from '../src/shared/types/connection.ts'

/**
 * #179: reasoning-effort metadata is translated per protocol, and nothing is sent
 * for a connection that declared none.
 *
 * The last part is the important one: an unknown OpenAI-compatible endpoint must
 * receive exactly the request it received before these fields existed.
 */

const base: ModelConnection = {
  protocol: 'openai-completions',
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'test-key',
  modelId: 'test-model'
}

test('openai-compatible connections translate effort into reasoningEffort', () => {
  assert.deepEqual(
    openaiCompletionsAdapter.chatProviderOptions?.({ ...base, reasoningEffort: 'low' }),
    {
      'openai-compatible': { reasoningEffort: 'low' }
    }
  )
  assert.equal(openaiCompletionsAdapter.chatProviderOptions?.({ ...base }), undefined)
})

test('openai-responses connections translate effort into reasoningEffort', () => {
  assert.deepEqual(
    openaiResponsesAdapter.chatProviderOptions?.({
      ...base,
      protocol: 'openai-responses',
      reasoningEffort: 'high'
    }),
    { openai: { reasoningEffort: 'high' } }
  )
  assert.equal(openaiResponsesAdapter.chatProviderOptions?.({ ...base }), undefined)
})

test('anthropic takes an explicit budget, or an effort level', () => {
  assert.deepEqual(
    anthropicMessagesAdapter.chatProviderOptions?.({
      ...base,
      protocol: 'anthropic-messages',
      reasoningBudget: 4096
    }),
    { anthropic: { thinking: { type: 'enabled', budgetTokens: 4096 } } }
  )
  assert.deepEqual(
    anthropicMessagesAdapter.chatProviderOptions?.({
      ...base,
      protocol: 'anthropic-messages',
      reasoningEffort: 'medium'
    }),
    { anthropic: { effort: 'medium' } }
  )
  assert.equal(anthropicMessagesAdapter.chatProviderOptions?.({ ...base }), undefined)
})

test('gemini takes a thinking budget, not an effort level', () => {
  assert.deepEqual(
    googleGenerativeAiAdapter.chatProviderOptions?.({
      ...base,
      protocol: 'google-generative-ai',
      reasoningBudget: 2048
    }),
    { google: { thinkingConfig: { thinkingBudget: 2048 } } }
  )
  // Gemini has no effort vocabulary here, so an effort alone sends nothing.
  assert.equal(
    googleGenerativeAiAdapter.chatProviderOptions?.({
      ...base,
      protocol: 'google-generative-ai',
      reasoningEffort: 'low'
    }),
    undefined
  )
})

/** A client that records what reached the provider. */
function inspectingClient(connection: Partial<ModelConnection>): {
  client: ModelClient
  model: MockLanguageModelV2
} {
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
  const client = new ModelClient('chat', { ...base, ...connection })
  client.getAIModel = () => model
  return { client, model }
}

const drain = async (client: ModelClient): Promise<void> => {
  // The request is what is under test, so the stream body is deliberately ignored.
  for await (const chunk of client.streamChat([{ role: 'user', content: 'hi' }]).events) {
    void chunk
  }
}

test('the reasoning configuration reaches the provider request', async () => {
  const { client, model } = inspectingClient({ reasoningEffort: 'low' })
  await drain(client)

  assert.deepEqual(model.doStreamCalls[0]?.providerOptions, {
    'openai-compatible': { reasoningEffort: 'low' }
  })
})

test('a connection with no reasoning metadata sends no provider options', async () => {
  const { client, model } = inspectingClient({})
  await drain(client)

  assert.equal(
    model.doStreamCalls[0]?.providerOptions,
    undefined,
    'a connection that declared no reasoning settings was given some anyway'
  )
})
