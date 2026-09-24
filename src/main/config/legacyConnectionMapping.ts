/**
 * 旧版 Provider 配置 -> Model Connection 的纯映射逻辑。
 *
 * 这个模块不依赖 Electron，便于单独测试。解密由调用方通过 `decrypt` 注入。
 *
 * 旧模型：providers[providerName] = { baseUrl, apiKey, models[], modelDetails[] }
 * 新模型：connections.chat / connections.embedding = { protocol, baseUrl, apiKey, modelId }
 *
 * 旧的内置 provider 全部是 OpenAI 兼容端点，因此统一映射到
 * `openai-completions` 协议。用户声明的模型 ID 保持不变。
 */

import type { APIProtocol, ConnectionMap, ModelConnection } from '../../shared/types'

export interface LegacyModelEntry {
  id: string
  type?: string
  [key: string]: unknown
}

export interface LegacyProviderConfigData {
  baseUrl?: string
  apiKey?: string
  displayName?: string
  /** 用户在旧 UI 中勾选的模型 ID */
  models?: string[]
  /** 旧 UI 缓存下来的模型元数据（含 type 猜测结果） */
  modelDetails?: LegacyModelEntry[]
}

export interface LegacyProviderConfig {
  providerName: string
  config: LegacyProviderConfigData
  enabled: boolean
  updatedAt: number
}

export interface LegacySettingsShape {
  defaultChatModel?: string
  defaultEmbeddingModel?: string
}

interface LegacyProviderDefaults {
  baseUrl: string
  protocol: APIProtocol
  apiKey?: string
}

/**
 * 旧内置 provider 的默认 baseUrl。仅迁移需要，新代码不再使用。
 */
export const LEGACY_PROVIDER_DEFAULTS: Record<string, LegacyProviderDefaults> = {
  openai: { baseUrl: 'https://api.openai.com/v1', protocol: 'openai-completions' },
  deepseek: { baseUrl: 'https://api.deepseek.com', protocol: 'openai-completions' },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    protocol: 'openai-completions'
  },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1', protocol: 'openai-completions' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', protocol: 'openai-completions' },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    protocol: 'openai-completions',
    apiKey: 'ollama'
  },
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai-completions' }
}

export interface DeriveConnectionsInput {
  providers: Record<string, LegacyProviderConfig>
  settings: LegacySettingsShape
  cachedModels?: Record<string, { models: LegacyModelEntry[] }>
  /** 解密单个 provider 的 config，默认按原样返回 */
  decrypt?: (config: LegacyProviderConfigData) => LegacyProviderConfigData
}

export interface DeriveConnectionsResult {
  connections: ConnectionMap
  warnings: string[]
}

interface ResolvedLegacyProvider {
  name: string
  enabled: boolean
  config: LegacyProviderConfigData
}

/**
 * Ollama 的旧 baseUrl 是原生 API（/api），新协议需要 OpenAI 兼容的 /v1。
 */
function normalizeLegacyBaseUrl(providerName: string, baseUrl: string): string {
  if (providerName !== 'ollama') {
    return baseUrl
  }
  const cleaned = baseUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '')
  return cleaned.endsWith('/v1') ? cleaned : `${cleaned}/v1`
}

function resolveProvider(
  name: string,
  providers: Record<string, LegacyProviderConfig>,
  decrypt: (config: LegacyProviderConfigData) => LegacyProviderConfigData
): ResolvedLegacyProvider | null {
  const provider = providers[name]
  if (!provider) {
    return null
  }
  return { name, enabled: provider.enabled, config: decrypt({ ...provider.config }) }
}

function getModelEntries(
  provider: ResolvedLegacyProvider,
  cachedModels: Record<string, { models: LegacyModelEntry[] }>
): LegacyModelEntry[] {
  const fromConfig = provider.config.modelDetails
  if (Array.isArray(fromConfig) && fromConfig.length > 0) {
    return fromConfig
  }
  const fromCache = cachedModels[provider.name]?.models
  return Array.isArray(fromCache) ? fromCache : []
}

function getSelectedModelIds(provider: ResolvedLegacyProvider): string[] {
  const selected = provider.config.models
  return Array.isArray(selected) ? selected.filter((m): m is string => typeof m === 'string') : []
}

function findModelId(
  provider: ResolvedLegacyProvider,
  modelEntries: LegacyModelEntry[],
  capability: 'chat' | 'embedding'
): string | null {
  const selected = getSelectedModelIds(provider)
  const candidates = selected.length > 0 ? selected : modelEntries.map((m) => m.id)

  for (const modelId of candidates) {
    const entry = modelEntries.find((m) => m.id === modelId)
    const type = entry?.type
    if (capability === 'embedding') {
      if (type === 'embedding') {
        return modelId
      }
    } else if (type !== 'embedding' && type !== 'reranker') {
      return modelId
    }
  }

  return null
}

function buildConnection(
  provider: ResolvedLegacyProvider,
  modelId: string
): ModelConnection | null {
  const defaults = LEGACY_PROVIDER_DEFAULTS[provider.name]
  const rawBaseUrl = provider.config.baseUrl || defaults?.baseUrl || ''
  if (!rawBaseUrl) {
    return null
  }

  return {
    protocol: defaults?.protocol ?? 'openai-completions',
    baseUrl: normalizeLegacyBaseUrl(provider.name, rawBaseUrl),
    apiKey: provider.config.apiKey || defaults?.apiKey || '',
    modelId
  }
}

function deriveConnection(
  capability: 'chat' | 'embedding',
  defaultModelKey: string | undefined,
  providers: Record<string, LegacyProviderConfig>,
  cachedModels: Record<string, { models: LegacyModelEntry[] }>,
  decrypt: (config: LegacyProviderConfigData) => LegacyProviderConfigData,
  warnings: string[]
): ModelConnection | null {
  // 1. 优先使用旧设置中显式选择的默认模型：<providerName>:<modelId>
  if (defaultModelKey && defaultModelKey.includes(':')) {
    const [providerName, ...modelIdParts] = defaultModelKey.split(':')
    const modelId = modelIdParts.join(':')
    const provider = resolveProvider(providerName, providers, decrypt)

    if (!provider) {
      warnings.push(
        `Default ${capability} model "${defaultModelKey}" references unknown provider "${providerName}"`
      )
    } else {
      const connection = buildConnection(provider, modelId)
      if (connection) {
        return connection
      }
      warnings.push(
        `Provider "${providerName}" has no base URL; cannot migrate ${capability} model`
      )
    }
  }

  // 2. 回退：找一个启用的 provider，其中勾选的模型类型匹配该 capability
  for (const name of Object.keys(providers)) {
    const provider = resolveProvider(name, providers, decrypt)
    if (!provider || !provider.enabled) {
      continue
    }
    const modelEntries = getModelEntries(provider, cachedModels)
    const modelId = findModelId(provider, modelEntries, capability)
    if (!modelId) {
      continue
    }
    const connection = buildConnection(provider, modelId)
    if (connection) {
      return connection
    }
  }

  warnings.push(`No legacy configuration could be mapped to a ${capability} connection`)
  return null
}

/**
 * 从旧 Provider 配置推导 chat / embedding connection。
 * 无法映射时返回带 warning 的空结果，而不是伪造一个可用配置。
 */
export function deriveConnections(input: DeriveConnectionsInput): DeriveConnectionsResult {
  const cachedModels = input.cachedModels ?? {}
  const decrypt = input.decrypt ?? ((config) => config)
  const warnings: string[] = []

  const chat = deriveConnection(
    'chat',
    input.settings.defaultChatModel,
    input.providers,
    cachedModels,
    decrypt,
    warnings
  )
  const embedding = deriveConnection(
    'embedding',
    input.settings.defaultEmbeddingModel,
    input.providers,
    cachedModels,
    decrypt,
    warnings
  )

  const connections: ConnectionMap = {}
  if (chat) {
    connections.chat = chat
  }
  if (embedding) {
    connections.embedding = embedding
  }

  return { connections, warnings }
}
