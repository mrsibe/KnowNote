/**
 * 从各协议的模型列表端点获取模型 ID。
 * 所有实现都在失败时抛出带上下文的错误，由上层决定如何提示用户。
 */

import type { ModelConnection } from '../../../shared/types/connection'

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function extractIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  const record = payload as Record<string, unknown>
  const entries = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : []

  const ids: string[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      ids.push(entry)
      continue
    }
    if (entry && typeof entry === 'object') {
      const item = entry as Record<string, unknown>
      const id = item.id ?? item.name ?? item.model
      if (typeof id === 'string' && id.length > 0) {
        ids.push(id)
      }
    }
  }

  return ids
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text ? `: ${text.slice(0, 300)}` : ''
  } catch {
    return ''
  }
}

/**
 * OpenAI 兼容端点：GET {baseUrl}/models
 * 覆盖 OpenAI / DeepSeek / Qwen / Kimi / SiliconFlow / 智谱 / Ollama / vLLM /
 * LM Studio / SGLang / OpenRouter 等。
 */
export async function listOpenAICompatibleModels(connection: ModelConnection): Promise<string[]> {
  const url = joinUrl(connection.baseUrl, 'models')
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {})
    }
  })

  if (!response.ok) {
    throw new Error(`GET ${url} returned ${response.status}${await readErrorMessage(response)}`)
  }

  return extractIds(await response.json())
}

/**
 * Anthropic Messages 端点：GET {baseUrl}/models
 */
export async function listAnthropicModels(connection: ModelConnection): Promise<string[]> {
  const url = joinUrl(connection.baseUrl, 'models')
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-api-key': connection.apiKey,
      'anthropic-version': '2023-06-01'
    }
  })

  if (!response.ok) {
    throw new Error(`GET ${url} returned ${response.status}${await readErrorMessage(response)}`)
  }

  return extractIds(await response.json())
}

/**
 * Google Generative AI 端点：GET {baseUrl}/models?key=...
 * Google 返回的模型名带 `models/` 前缀，这里去掉。
 */
export async function listGoogleModels(connection: ModelConnection): Promise<string[]> {
  const url = `${joinUrl(connection.baseUrl, 'models')}?key=${encodeURIComponent(connection.apiKey)}`
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })

  if (!response.ok) {
    throw new Error(`GET ${url} returned ${response.status}${await readErrorMessage(response)}`)
  }

  return extractIds(await response.json()).map((id) => id.replace(/^models\//, ''))
}
