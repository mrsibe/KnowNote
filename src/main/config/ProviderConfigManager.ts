import type Store from 'electron-store'
import type { ProviderConfig } from './types'
import { enrichModelsWithType } from '../../shared/utils/modelClassifier'
import {
  encryptProviderConfig,
  decryptProviderConfig,
  isEncryptionAvailable
} from './secureStorage'
import Logger from '../../shared/utils/logger'

/**
 * 제공자 설정 관리자
 */
export class ProviderConfigManager {
  private getStore: () => Promise<Store<any>>

  constructor(getStore: () => Promise<Store<any>>) {
    this.getStore = getStore
  }

  /**
   * 제공자 설정 저장 (민감 필드 자동 암호화)
   */
  async saveProviderConfig(
    providerName: string,
    config: Record<string, any>,
    enabled: boolean
  ): Promise<void> {
    const store = await this.getStore()
    const providers = store.get('providers', {})

    // 민감 필드 암호화 (예: apiKey)
    let encryptedConfig = config
    if (isEncryptionAvailable()) {
      encryptedConfig = encryptProviderConfig(config)
      Logger.info('ProviderConfigManager', `Config encrypted for ${providerName}`)
    } else {
      Logger.warn(
        'ProviderConfigManager',
        `Encryption not available, storing config in plain text for ${providerName}`
      )
    }

    providers[providerName] = {
      providerName,
      config: encryptedConfig,
      enabled,
      updatedAt: Date.now()
    }

    store.set('providers', providers)
  }

  /**
   * 제공자 설정 조회 (민감 필드 자동 복호화)
   */
  async getProviderConfig(providerName: string): Promise<ProviderConfig | null> {
    const store = await this.getStore()
    const providers = store.get('providers', {})
    const providerConfig = providers[providerName]

    if (!providerConfig) {
      return null
    }

    // 민감 필드 복호화
    const decryptedConfig = decryptProviderConfig(providerConfig.config)

    return {
      ...providerConfig,
      config: decryptedConfig
    }
  }

  /**
   * 모든 제공자 설정 조회 (민감 필드 자동 복호화)
   */
  async getAllProviderConfigs(): Promise<ProviderConfig[]> {
    const store = await this.getStore()
    const providers = store.get('providers', {})

    // 각 설정 복호화
    return Object.values(providers).map((providerConfig: any) => ({
      ...providerConfig,
      config: decryptProviderConfig(providerConfig.config)
    }))
  }

  /**
   * 제공자 설정 삭제
   */
  async deleteProviderConfig(providerName: string): Promise<void> {
    const store = await this.getStore()
    const providers = store.get('providers', {})
    delete providers[providerName]
    store.set('providers', providers)
  }

  /**
   * 제공자 설정 변경 감시
   */
  async onProvidersChange(
    callback: (
      newProviders: Record<string, ProviderConfig>,
      oldProviders: Record<string, ProviderConfig>
    ) => void
  ): Promise<() => void> {
    const store = await this.getStore()
    return store.onDidChange('providers', (newValue, oldValue) => {
      if (newValue && oldValue) {
        callback(newValue, oldValue)
      }
    })
  }

  /**
   * 제공자 모델 목록 저장
   */
  async saveProviderModels(providerName: string, models: any[]): Promise<void> {
    const store = await this.getStore()
    const modelsData = store.get('models', {})

    modelsData[providerName] = {
      models
    }

    store.set('models', modelsData)
  }

  /**
   * 제공자 모델 목록 조회 (하위 호환성 포함)
   */
  async getProviderModels(providerName: string): Promise<any[]> {
    const store = await this.getStore()
    const modelsData = store.get('models', {})
    const providerModels = modelsData[providerName]

    let models = providerModels?.models || []

    // 하위 호환성: 모델에 type 필드가 없으면 자동 추가
    const hasTypeField = models.length > 0 && models.some((m) => m.type)

    if (!hasTypeField && models.length > 0) {
      console.log(
        `[ProviderConfigManager] Migrating models for ${providerName} - adding type field`
      )
      models = enrichModelsWithType(models)
      // 저장소 업데이트
      await this.saveProviderModels(providerName, models)
    }

    return models
  }
}
