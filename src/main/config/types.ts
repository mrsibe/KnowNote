import type { AppSettings, ConnectionMap, ShortcutConfig } from '../../shared/types'
import type {
  LegacyModelEntry,
  LegacyProviderConfig,
  LegacyProviderConfigData,
  LegacySettingsShape
} from './legacyConnectionMapping'

export type {
  LegacyModelEntry,
  LegacyProviderConfig,
  LegacyProviderConfigData,
  LegacySettingsShape
}

/**
 * Store Schema 定义
 */
export interface StoreSchema {
  settings: AppSettings
  connections: ConnectionMap
  shortcuts: ShortcutConfig[]
  /**
   * 旧版 Provider 配置，仅用于一次性迁移到 connections。
   * 迁移完成后不再写入。
   */
  providers?: Record<string, LegacyProviderConfig>
  /** 旧版模型缓存，仅用于一次性迁移。 */
  models?: Record<string, { models: LegacyModelEntry[] }>
  /** 迁移状态标记。 */
  connectionMigration?: ConnectionMigrationState
}

/**
 * 一次性迁移状态
 */
export interface ConnectionMigrationState {
  migratedAt: number
  /** 迁移中遇到的无法转换的配置；非空表示需要用户手动重新配置。 */
  warnings: string[]
}

// 重新导出 AppSettings 以保持向后兼容
export type { AppSettings }
