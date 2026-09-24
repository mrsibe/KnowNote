/**
 * 一次性迁移：旧版 Provider 配置 -> Model Connection
 *
 * 纯映射逻辑在 legacyConnectionMapping.ts，这里只负责读写 store、
 * 解密 apiKey，以及记录迁移状态。
 */

import type Store from 'electron-store'
import type { ConnectionMap } from '../../shared/types'
import type {
  ConnectionMigrationState,
  LegacyModelEntry,
  LegacyProviderConfig,
  LegacyProviderConfigData,
  LegacySettingsShape,
  StoreSchema
} from './types'
import { deriveConnections } from './legacyConnectionMapping'
import { decryptObjectFields } from './secureStorage'
import Logger from '../../shared/utils/logger'

const LEGACY_SENSITIVE_FIELDS = ['apiKey', 'apiSecret', 'accessToken']

function decryptLegacyConfig(config: LegacyProviderConfigData): LegacyProviderConfigData {
  return decryptObjectFields({ ...config }, LEGACY_SENSITIVE_FIELDS) as LegacyProviderConfigData
}

/**
 * 执行一次性迁移。幂等：已迁移过（存在 connectionMigration 标记）则直接返回。
 */
export async function migrateProvidersToConnections(store: Store<StoreSchema>): Promise<void> {
  const existingMigration = store.get('connectionMigration') as ConnectionMigrationState | undefined
  if (existingMigration) {
    return
  }

  const providers = (store.get('providers', {}) as Record<string, LegacyProviderConfig>) || {}
  const cachedModels =
    (store.get('models', {}) as Record<string, { models: LegacyModelEntry[] }>) || {}

  if (Object.keys(providers).length === 0) {
    // 全新安装，没有需要迁移的内容
    store.set('connectionMigration', { migratedAt: Date.now(), warnings: [] })
    return
  }

  const settings = store.get('settings') as LegacySettingsShape | undefined
  const existingConnections = (store.get('connections', {}) as ConnectionMap) || {}

  // 已存在的 connection 优先，只补齐缺失的能力
  const { connections: derived, warnings } = deriveConnections({
    providers,
    settings: {
      defaultChatModel: settings?.defaultChatModel,
      defaultEmbeddingModel: settings?.defaultEmbeddingModel
    },
    cachedModels,
    decrypt: decryptLegacyConfig
  })

  const connections: ConnectionMap = { ...existingConnections, ...derived }

  store.set('connections', connections)
  store.set('connectionMigration', { migratedAt: Date.now(), warnings })

  if (connections.chat && connections.embedding) {
    Logger.info('ConnectionMigration', 'Migrated legacy provider configuration to connections')
  } else {
    Logger.error(
      'ConnectionMigration',
      `Migration incomplete; user must reconfigure in Settings. ${warnings.join('; ')}`
    )
  }
}
