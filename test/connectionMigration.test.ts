import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveConnections,
  type LegacyProviderConfig,
  type LegacyProviderConfigData
} from '../src/main/config/legacyConnectionMapping.ts'

interface BuiltinCase {
  provider: string
  baseUrl: string
  apiKey: string
  chat: string
  embedding?: string
  /** 迁移后期望的 baseUrl（Ollama 的 /api 会转成 /v1） */
  expectedBaseUrl?: string
  expectedApiKey?: string
}

/**
 * 7 个内置 provider 的典型配置。旧版本中它们全部是 OpenAI 兼容端点。
 */
const BUILTIN_CASES: BuiltinCase[] = [
  {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-openai',
    chat: 'gpt-4o',
    embedding: 'text-embedding-3-small'
  },
  {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-deepseek',
    chat: 'deepseek-chat',
    embedding: 'deepseek-embedding'
  },
  {
    provider: 'qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: 'sk-qwen',
    chat: 'qwen-max',
    embedding: 'text-embedding-v2'
  },
  {
    provider: 'kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: 'sk-kimi',
    chat: 'kimi-k2-turbo-preview'
  },
  {
    provider: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: 'sk-siliconflow',
    chat: 'deepseek-ai/DeepSeek-V3',
    embedding: 'BAAI/bge-m3'
  },
  {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/api',
    apiKey: '',
    chat: 'gemma3:12b',
    embedding: 'bge-m3',
    expectedBaseUrl: 'http://localhost:11434/v1',
    expectedApiKey: 'ollama'
  },
  {
    provider: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: 'sk-zhipu',
    chat: 'glm-4-plus',
    embedding: 'embedding-3'
  }
]

function buildProvider(c: BuiltinCase): LegacyProviderConfig {
  const models = [c.chat, ...(c.embedding ? [c.embedding] : [])]
  const config: LegacyProviderConfigData = {
    baseUrl: c.baseUrl,
    apiKey: c.apiKey,
    models,
    modelDetails: [
      { id: c.chat, type: 'chat' },
      ...(c.embedding ? [{ id: c.embedding, type: 'embedding' }] : [])
    ]
  }
  return { providerName: c.provider, config, enabled: true, updatedAt: Date.now() }
}

for (const c of BUILTIN_CASES) {
  test(`migrates builtin provider: ${c.provider}`, () => {
    const providers = { [c.provider]: buildProvider(c) }
    const { connections, warnings } = deriveConnections({
      providers,
      settings: {
        defaultChatModel: `${c.provider}:${c.chat}`,
        defaultEmbeddingModel: c.embedding ? `${c.provider}:${c.embedding}` : undefined
      }
    })

    assert.deepEqual(connections.chat, {
      protocol: 'openai-completions',
      baseUrl: c.expectedBaseUrl ?? c.baseUrl,
      apiKey: c.expectedApiKey ?? c.apiKey,
      modelId: c.chat
    })

    if (c.embedding) {
      assert.deepEqual(connections.embedding, {
        protocol: 'openai-completions',
        baseUrl: c.expectedBaseUrl ?? c.baseUrl,
        apiKey: c.expectedApiKey ?? c.apiKey,
        modelId: c.embedding
      })
      assert.deepEqual(warnings, [])
    } else {
      assert.equal(connections.embedding, undefined)
    }
  })
}

test('falls back to selected models when no default model is set', () => {
  const c = BUILTIN_CASES[0]
  const { connections } = deriveConnections({
    providers: { [c.provider]: buildProvider(c) },
    settings: {}
  })

  assert.equal(connections.chat?.modelId, c.chat)
  assert.equal(connections.embedding?.modelId, c.embedding)
})

test('does not guess model types: user-declared chat model keeps its id', () => {
  const c = BUILTIN_CASES.find((item) => item.provider === 'ollama')!
  const { connections } = deriveConnections({
    providers: { ollama: buildProvider(c) },
    settings: { defaultChatModel: 'ollama:gemma3:12b' }
  })

  assert.equal(connections.chat?.modelId, 'gemma3:12b')
})

test('reports a warning instead of fabricating a connection', () => {
  const { connections, warnings } = deriveConnections({
    providers: {
      custom: {
        providerName: 'custom',
        config: { apiKey: 'sk', models: ['some-model'] } as LegacyProviderConfigData,
        enabled: true,
        updatedAt: 0
      }
    },
    settings: { defaultChatModel: 'missing:some-model' }
  })

  assert.equal(connections.chat, undefined)
  assert.ok(warnings.some((w) => w.includes('missing')))
})

test('decrypts provider config through the injected decrypt function', () => {
  const c = BUILTIN_CASES[0]
  const provider = buildProvider(c)
  provider.config.apiKey = '__encrypted__'

  const { connections } = deriveConnections({
    providers: { [c.provider]: provider },
    settings: { defaultChatModel: `${c.provider}:${c.chat}` },
    decrypt: (config) => ({ ...config, apiKey: 'sk-decrypted' })
  })

  assert.equal(connections.chat?.apiKey, 'sk-decrypted')
})
