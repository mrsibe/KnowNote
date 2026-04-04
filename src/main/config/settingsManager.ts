import type Store from 'electron-store'
import type { AppSettings } from './types'
import { defaultSettings } from './defaults'

/**
 * 깊이병합설정객체
 * 보장이전의저장데이터충분획득얻다새로 추가된의기본필드
 */
function mergeSettings(stored: Partial<AppSettings>): AppSettings {
  return {
    theme: stored.theme ?? defaultSettings.theme,
    language: stored.language ?? defaultSettings.language,
    autoLaunch: stored.autoLaunch ?? defaultSettings.autoLaunch,
    hasCompletedOnboarding: stored.hasCompletedOnboarding ?? defaultSettings.hasCompletedOnboarding,
    defaultChatModel: stored.defaultChatModel ?? defaultSettings.defaultChatModel,
    defaultEmbeddingModel: stored.defaultEmbeddingModel ?? defaultSettings.defaultEmbeddingModel,
    prompts: {
      mindMap: {
        'ko-KR': stored.prompts?.mindMap?.['ko-KR'] ?? defaultSettings.prompts!.mindMap!['ko-KR'],
        'en-US': stored.prompts?.mindMap?.['en-US'] ?? defaultSettings.prompts!.mindMap!['en-US']
      },
      quiz: {
        'ko-KR': stored.prompts?.quiz?.['ko-KR'] ?? defaultSettings.prompts!.quiz!['ko-KR'],
        'en-US': stored.prompts?.quiz?.['en-US'] ?? defaultSettings.prompts!.quiz!['en-US']
      },
      anki: {
        'ko-KR': stored.prompts?.anki?.['ko-KR'] ?? defaultSettings.prompts!.anki!['ko-KR'],
        'en-US': stored.prompts?.anki?.['en-US'] ?? defaultSettings.prompts!.anki!['en-US']
      }
    }
  }
}

/**
 * 설정관리
 */
export class SettingsManager {
  private getStore: () => Promise<Store<any>>
  private storeCache: Store<any> | null = null

  constructor(getStore: () => Promise<Store<any>>) {
    this.getStore = getStore
    // 즉시초기화 store 캐시
    getStore().then((store) => {
      this.storeCache = store
    })
  }

  /**
   * 동기단일 설정 조회（만때 store 초기화시사용 가능，아니오반환기본값）
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
   * 모든 설정 조회
   */
  async getAllSettings(): Promise<AppSettings> {
    const store = await this.getStore()
    const storedSettings = store.get('settings', {})
    return mergeSettings(storedSettings)
  }

  /**
   * 단일 설정 조회
   */
  async getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
    const settings = await this.getAllSettings()
    return settings[key]
  }

  /**
   * 설정 업데이트
   */
  async updateSettings(updates: Partial<AppSettings>): Promise<void> {
    const store = await this.getStore()
    const current = await this.getAllSettings()
    const newSettings = { ...current, ...updates }
    store.set('settings', newSettings)
  }

  /**
   * 설정단일개값
   */
  async setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
    await this.updateSettings({ [key]: value } as Partial<AppSettings>)
  }

  /**
   * 기본 설정으로 초기화
   */
  async resetSettings(): Promise<void> {
    const store = await this.getStore()
    store.set('settings', defaultSettings)
  }

  /**
   * 감시설정변경（동기버전，만때 store 초기화시생효）
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
      // Store 미초기화시，지연지연등록감시
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
   * 감시설정변경
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
