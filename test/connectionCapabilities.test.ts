import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { streamText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { ModelClient } from '../src/main/models/ModelClient.ts'
import {
  openaiCompletionsAdapter,
  PROVIDER_OPTIONS_KEY
} from '../src/main/models/protocols/openaiCompletions.ts'
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
      openaiCompatible: { reasoningEffort: 'low' }
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

test('structured output pins the pre-v6 strictness default for openai-responses', () => {
  // AI SDK 6 flips the OpenAI-family `strictJsonSchema` default to true. The
  // structured-output schemas use `.optional()` fields, which strict mode rejects
  // because every property has to be listed in `required`.
  //
  // Only openai-responses is affected: it always sends a JSON schema. The
  // openai-completions adapter goes through `@ai-sdk/openai-compatible`, which
  // only sends a schema when `structuredOutputs` is enabled and otherwise sends
  // `json_object`, so its strictness never applies.
  assert.deepEqual(openaiResponsesAdapter.structuredOutputProviderOptions?.(base), {
    openai: { strictJsonSchema: false }
  })
  assert.equal(openaiCompletionsAdapter.structuredOutputProviderOptions?.(base), undefined)
  // Anthropic and Gemini structured output is unaffected by that default.
  assert.equal(anthropicMessagesAdapter.structuredOutputProviderOptions?.(base), undefined)
  assert.equal(googleGenerativeAiAdapter.structuredOutputProviderOptions?.(base), undefined)
})

/** A client that records what reached the provider. */
function inspectingClient(connection: Partial<ModelConnection>): {
  client: ModelClient
  model: MockLanguageModelV3
} {
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 }
            }
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
    openaiCompatible: { reasoningEffort: 'low' }
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

test('provider metadata is namespaced under the camelCase key', async () => {
  // The provider picks the `providerMetadata` key from the key the caller sends in
  // `providerOptions`. Sending the deprecated kebab-case key would put
  // `providerMetadata['openai-compatible']` in front of every consumer and log a
  // deprecation warning on each call, so this pins the camelCase form.
  const sse = [
    'data: {"id":"1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\n',
    'data: {"id":"1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
    'data: [DONE]\n\n'
  ].join('')

  const provider = createOpenAICompatible({
    name: PROVIDER_OPTIONS_KEY,
    baseURL: 'https://example.invalid/v1',
    apiKey: 'test',
    fetch: async () =>
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  })

  const result = streamText({
    model: provider('test-model'),
    prompt: 'hi',
    providerOptions: { [PROVIDER_OPTIONS_KEY]: { reasoningEffort: 'low' } }
  })
  for await (const chunk of result.textStream) {
    void chunk
  }

  assert.deepEqual(Object.keys((await result.providerMetadata) ?? {}), [PROVIDER_OPTIONS_KEY])
  assert.equal(PROVIDER_OPTIONS_KEY, 'openaiCompatible')
})
