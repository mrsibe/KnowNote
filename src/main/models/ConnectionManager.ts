/**
 * ConnectionManager
 *
 * 解析用户配置的 Model Connection 并构造 ModelClient。
 * 它不认识任何厂商，只按 protocol 分派。
 */

import type {
  ConnectionMap,
  ConnectionTestResult,
  ModelCapability,
  ModelConnection
} from '../../shared/types'
import { protocolSupportsEmbedding } from '../../shared/types'
import { connectionConfigManager } from '../config'
import { getProtocolAdapter } from './protocols'
import { ModelClient } from './ModelClient'
import Logger from '../../shared/utils/logger'

/**
 * 协议元数据，供 Settings UI 决定展示哪些控件（拉取模型列表等）。
 */
export interface ProtocolInfo {
  protocol: ModelConnection['protocol']
  supportsModelListing: boolean
  supportsEmbedding: boolean
}

export class ConnectionManager {
  /**
   * 读取全部连接
   */
  async getConnections(): Promise<ConnectionMap> {
    return await connectionConfigManager.getConnections()
  }

  /**
   * 读取单个连接
   */
  async getConnection(capability: ModelCapability): Promise<ModelConnection | null> {
    return await connectionConfigManager.getConnection(capability)
  }

  /**
   * 保存连接。embedding 能力会校验协议是否支持 embedding。
   */
  async saveConnection(capability: ModelCapability, connection: ModelConnection): Promise<void> {
    if (capability === 'embedding' && !protocolSupportsEmbedding(connection.protocol)) {
      throw new Error(`Protocol "${connection.protocol}" does not support embeddings`)
    }
    await connectionConfigManager.saveConnection(capability, connection)
  }

  /**
   * 删除连接
   */
  async deleteConnection(capability: ModelCapability): Promise<void> {
    await connectionConfigManager.deleteConnection(capability)
  }

  /**
   * 获取 chat 客户端，未配置时返回 null（不自动 fallback）
   */
  async getChatClient(): Promise<ModelClient | null> {
    const connection = await connectionConfigManager.getConnection('chat')
    if (!connection) {
      Logger.warn('ConnectionManager', 'No chat model configured')
      return null
    }
    return new ModelClient('chat', connection)
  }

  /**
   * 获取 embedding 客户端，未配置或协议不支持时返回 null
   */
  async getEmbeddingClient(): Promise<ModelClient | null> {
    const connection = await connectionConfigManager.getConnection('embedding')
    if (!connection) {
      Logger.warn('ConnectionManager', 'No embedding model configured')
      return null
    }
    if (!protocolSupportsEmbedding(connection.protocol)) {
      Logger.error(
        'ConnectionManager',
        `Configured embedding protocol "${connection.protocol}" does not support embeddings`
      )
      return null
    }
    return new ModelClient('embedding', connection)
  }

  /**
   * 测试连接：能列出模型即视为连通。
   */
  async testConnection(connection: ModelConnection): Promise<ConnectionTestResult> {
    try {
      const adapter = getProtocolAdapter(connection.protocol)
      if (!adapter.supportsModelListing || !adapter.listModels) {
        return { ok: false, error: `Protocol "${connection.protocol}" cannot be tested` }
      }
      await adapter.listModels(connection)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }

  /**
   * 拉取该 connection 可用的模型 ID 列表。
   */
  async fetchModels(connection: ModelConnection): Promise<string[]> {
    const adapter = getProtocolAdapter(connection.protocol)
    if (!adapter.supportsModelListing || !adapter.listModels) {
      throw new Error(
        `Protocol "${connection.protocol}" does not support fetching models; please enter the Model ID manually`
      )
    }
    const models = await adapter.listModels(connection)
    return [...new Set(models)].sort((a, b) => a.localeCompare(b))
  }

  /**
   * 协议元数据
   */
  listProtocolInfos(): ProtocolInfo[] {
    return (
      [
        'openai-completions',
        'openai-responses',
        'anthropic-messages',
        'google-generative-ai'
      ] as const
    ).map((protocol) => {
      const adapter = getProtocolAdapter(protocol)
      return {
        protocol,
        supportsModelListing: adapter.supportsModelListing,
        supportsEmbedding: protocolSupportsEmbedding(protocol)
      }
    })
  }
}
