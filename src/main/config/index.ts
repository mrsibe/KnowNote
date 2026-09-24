/**
 * 配置管理模块统一导出
 */

export { getStore } from './store'
export { SettingsManager } from './settingsManager'
export { ConnectionConfigManager } from './ConnectionConfigManager'
export type { AppSettings, StoreSchema } from './types'
export { defaultSettings } from './defaults'

// 导出单例实例
import { getStore } from './store'
import { SettingsManager } from './settingsManager'
import { ConnectionConfigManager } from './ConnectionConfigManager'

export const settingsManager = new SettingsManager(getStore)
export const connectionConfigManager = new ConnectionConfigManager(getStore)
