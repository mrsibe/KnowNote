import type Store from 'electron-store'
import type { AppSettings } from './types'
import { defaultSettings } from './defaults'

/**
 * 深度合并设置对象
 * 确保旧的存储数据能够获得新增的默认字段
 */
function mergeSettings(stored: Partial<AppSettings>): AppSettings {
  return {
    theme: stored.theme ?? defaultSettings.theme,
    language: stored.language ?? defaultSettings.language,
    autoLaunch: stored.autoLaunch ?? defaultSettings.autoLaunch,
    hasCompletedOnboarding: stored.hasCompletedOnboarding ?? defaultSettings.hasCompletedOnboarding,
    prompts: {
      mindMap: {
        'zh-CN': stored.prompts?.mindMap?.['zh-CN'] ?? defaultSettings.prompts!.mindMap!['zh-CN'],
        'en-US': stored.prompts?.mindMap?.['en-US'] ?? defaultSettings.prompts!.mindMap!['en-US']
      },
      quiz: {
        'zh-CN': stored.prompts?.quiz?.['zh-CN'] ?? defaultSettings.prompts!.quiz!['zh-CN'],
        'en-US': stored.prompts?.quiz?.['en-US'] ?? defaultSettings.prompts!.quiz!['en-US']
      },
      anki: {
        'zh-CN': stored.prompts?.anki?.['zh-CN'] ?? defaultSettings.prompts!.anki!['zh-CN'],
        'en-US': stored.prompts?.anki?.['en-US'] ?? defaultSettings.prompts!.anki!['en-US']
      }
    }
  }
}

/**
 * 设置管理器
 */
export class SettingsManager {
  private getStore: () => Promise<Store<any>>
  private storeCache: Store<any> | null = null

  constructor(getStore: () => Promise<Store<any>>) {
    this.getStore = getStore
    // 立即初始化 store 缓存
    getStore().then((store) => {
      this.storeCache = store
    })
  }

  /**
   * 同步获取单个设置（仅当 store 已初始化时可用，否则返回默认值）
   */
  getSettingSync<K extends keyof AppSettings>(key: K): AppSettings[K] {
    if (!this.storeCache) {
      return defaultSettings[key]
    }
    const storedSettings = this.storeCache.get('settings', {})
    const mergedSettings = mergeSettings(storedSettings)
    return mergedSettings[key]
  }

  /**
   * 获取所有设置
   */
  async getAllSettings(): Promise<AppSettings> {
    const store = await this.getStore()
    const storedSettings = store.get('settings', {})
    return mergeSettings(storedSettings)
  }

  /**
   * 获取单个设置
   */
  async getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
    const settings = await this.getAllSettings()
    return settings[key]
  }

  /**
   * 更新设置
   */
  async updateSettings(updates: Partial<AppSettings>): Promise<void> {
    const store = await this.getStore()
    const current = await this.getAllSettings()
    const newSettings = { ...current, ...updates }
    store.set('settings', newSettings)
  }

  /**
   * 设置单个值
   */
  async setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
    await this.updateSettings({ [key]: value } as Partial<AppSettings>)
  }

  /**
   * 重置为默认设置
   */
  async resetSettings(): Promise<void> {
    const store = await this.getStore()
    store.set('settings', defaultSettings)
  }

  /**
   * 监听设置变化（同步版本，仅当 store 已初始化时生效）
   */
  onSettingsChangeSync(
    callback: (newSettings: AppSettings, oldSettings: AppSettings) => void
  ): void {
    if (this.storeCache) {
      this.storeCache.onDidChange('settings', (newValue, oldValue) => {
        if (newValue && oldValue) {
          callback(newValue, oldValue)
        }
      })
    } else {
      // Store 未初始化时，延迟注册监听器
      this.getStore().then((store) => {
        store.onDidChange('settings', (newValue, oldValue) => {
          if (newValue && oldValue) {
            callback(newValue, oldValue)
          }
        })
      })
    }
  }

  /**
   * 监听设置变化
   */
  async onSettingsChange(
    callback: (newSettings: AppSettings, oldSettings: AppSettings) => void
  ): Promise<() => void> {
    const store = await this.getStore()
    return store.onDidChange('settings', (newValue, oldValue) => {
      if (newValue && oldValue) {
        callback(newValue, oldValue)
      }
    })
  }
}
