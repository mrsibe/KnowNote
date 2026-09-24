/**
 * ConnectionConfigManager
 * 持久化 Model Connection 配置（apiKey 使用 safeStorage 加密）。
 */

import type Store from 'electron-store'
import type { ConnectionMap, ModelCapability, ModelConnection } from '../../shared/types'
import { MODEL_CAPABILITIES } from '../../shared/types'
import type { StoreSchema } from './types'
import { encryptObjectFields, decryptObjectFields, isEncryptionAvailable } from './secureStorage'
import Logger from '../../shared/utils/logger'

const SENSITIVE_FIELDS = ['apiKey']

export class ConnectionConfigManager {
  private getStore: () => Promise<Store<StoreSchema>>

  constructor(getStore: () => Promise<Store<StoreSchema>>) {
    this.getStore = getStore
  }

  /**
   * 读取全部连接（自动解密 apiKey）
   */
  async getConnections(): Promise<ConnectionMap> {
    const store = await this.getStore()
    const stored = store.get('connections', {}) as ConnectionMap
    const result: ConnectionMap = {}

    for (const capability of MODEL_CAPABILITIES) {
      const connection = stored?.[capability]
      if (connection) {
        result[capability] = decryptObjectFields({ ...connection }, SENSITIVE_FIELDS)
      }
    }

    return result
  }

  /**
   * 读取单个连接
   */
  async getConnection(capability: ModelCapability): Promise<ModelConnection | null> {
    const connections = await this.getConnections()
    return connections[capability] ?? null
  }

  /**
   * 保存单个连接（覆盖同一 capability 的已有连接）
   */
  async saveConnection(capability: ModelCapability, connection: ModelConnection): Promise<void> {
    const store = await this.getStore()
    const connections = { ...((store.get('connections', {}) as ConnectionMap) || {}) }

    let stored: ModelConnection = { ...connection }
    if (isEncryptionAvailable()) {
      stored = encryptObjectFields(stored, SENSITIVE_FIELDS)
    } else {
      Logger.warn(
        'ConnectionConfigManager',
        `Encryption not available, storing ${capability} apiKey in plain text`
      )
    }

    connections[capability] = stored
    store.set('connections', connections)
    Logger.info('ConnectionConfigManager', `Saved ${capability} connection`)
  }

  /**
   * 删除单个连接
   */
  async deleteConnection(capability: ModelCapability): Promise<void> {
    const store = await this.getStore()
    const connections = { ...((store.get('connections', {}) as ConnectionMap) || {}) }
    delete connections[capability]
    store.set('connections', connections)
    Logger.info('ConnectionConfigManager', `Deleted ${capability} connection`)
  }

  /**
   * 监听连接配置变化
   */
  async onConnectionsChange(callback: (connections: ConnectionMap) => void): Promise<() => void> {
    const store = await this.getStore()
    return store.onDidChange('connections', () => {
      void this.getConnections().then(callback)
    })
  }
}
