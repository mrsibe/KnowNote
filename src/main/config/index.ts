/**
 * 설정관리모듈통합내보내기
 */

export { getStore } from './store'
export { SettingsManager } from './settingsManager'
export { ProviderConfigManager } from './ProviderConfigManager'
// 하위 호환성내보내기(사용 중단됨)
export { ProviderConfigManager as ProvidersManager } from './ProviderConfigManager'
export type { AppSettings, ProviderConfig, StoreSchema } from './types'
export { defaultSettings } from './defaults'

// 내보내기단일예인스턴스
import { getStore } from './store'
import { SettingsManager } from './settingsManager'
import { ProviderConfigManager } from './ProviderConfigManager'

export const settingsManager = new SettingsManager(getStore)
export const providersManager = new ProviderConfigManager(getStore)
export const providerConfigManager = providersManager // 새이름의별도이름
