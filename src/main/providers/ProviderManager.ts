/**
 * Provider Manager
 * 협조 ProviderRegistry 및 ProviderConfigManager,제공통합의제공자방문질문인터페이스
 */

import type { BaseProvider } from './capabilities/BaseProvider'
import type { ChatProvider } from './types'
import type { EmbeddingProvider } from './types'
import type { CustomProviderConfig, ProviderDescriptor } from './registry/ProviderDescriptor'
import { ProviderRegistry } from './registry/ProviderRegistry'
import { BUILTIN_PROVIDERS } from './registry/builtinProviders'
import { AISDKProvider } from './base/AISDKProvider'
import { settingsManager, providerConfigManager } from '../config'
import { getAllBuiltinModels } from '../../shared/config/models'
import Logger from '../../shared/utils/logger'

/**
 * ProviderManager
 * 제공자관리,협조등록테이블및설정관리
 */
export class ProviderManager {
  private registry: ProviderRegistry

  constructor() {
    this.registry = new ProviderRegistry()

    // 등록모든내장제공자
    this.registerBuiltinProviders()

    Logger.info('ProviderManager', 'Provider manager initialized')
  }

  /**
   * 초기화 Provider Manager（비동기）
   * 앱시작동시호출，초기화내장모델목록
   */
  async initialize(): Promise<void> {
    await this.initializeBuiltinModels()
  }

  /**
   * 등록모든내장제공자
   */
  private registerBuiltinProviders(): void {
    this.registry.registerMany(BUILTIN_PROVIDERS)
    Logger.info(
      'ProviderManager',
      `Registered ${BUILTIN_PROVIDERS.length} builtin providers: ${BUILTIN_PROVIDERS.map((p) => p.name).join(', ')}`
    )
  }

  /**
   * 초기화내장모델목록
   * 만약 electron-store 에서없있는모델캐시，자동쓰기내장모델
   */
  private async initializeBuiltinModels(): Promise<void> {
    try {
      const builtinModels = getAllBuiltinModels()

      for (const [providerName, models] of Object.entries(builtinModels)) {
        const cachedModels = await providerConfigManager.getProviderModels(providerName)

        // 만약없있는캐시，쓰기내장모델
        if (!cachedModels || cachedModels.length === 0) {
          Logger.info(
            'ProviderManager',
            `Initializing ${models.length} builtin models for ${providerName}`
          )
          await providerConfigManager.saveProviderModels(providerName, models)
        } else {
          Logger.info(
            'ProviderManager',
            `Provider ${providerName} already has ${cachedModels.length} cached models, skipping initialization`
          )
        }
      }

      Logger.info('ProviderManager', 'Builtin models initialization complete')
    } catch (error) {
      Logger.error('ProviderManager', 'Failed to initialize builtin models:', error)
    }
  }

  /**
   * 조회구성됨의 provider(병합설정)
   * @param name - 제공자이름
   * @returns BaseProvider 또는 null
   */
  async getConfiguredProvider(name: string): Promise<BaseProvider | null> {
    const provider = this.registry.getProvider(name)
    if (!provider) {
      Logger.warn('ProviderManager', `Provider ${name} not found in registry`)
      return null
    }

    // 조회사용자설정
    const config = await providerConfigManager.getProviderConfig(name)
    if (!config || !config.enabled) {
      Logger.warn('ProviderManager', `Provider ${name} is not enabled`)
      return null
    }

    // 설정 provider
    provider.configure(config.config)
    return provider
  }

  /**
   * 조회활점프의대화 provider
   * 만약사용자설정기본대화모델아닌사용 가능，직접반환 null，아닌자동 fallback
   */
  async getActiveChatProvider(): Promise<ChatProvider | null> {
    try {
      const settings = await settingsManager.getAllSettings()
      const defaultChatModel = settings.defaultChatModel

      // 만약사용자설정기본대화모델,파싱그리고사용
      if (defaultChatModel && defaultChatModel.includes(':')) {
        const [providerName, ...modelIdParts] = defaultChatModel.split(':')
        const modelId = modelIdParts.join(':')
        const provider = await this.getConfiguredProvider(providerName)

        if (!provider) {
          Logger.error(
            'ProviderManager',
            `Provider for default chat model "${providerName}" is not available or not enabled`
          )
          return null
        }

        // 확인예아니오지원대화기능
        const compatProvider = provider as AISDKProvider
        if (!compatProvider.hasChatCapability()) {
          Logger.error(
            'ProviderManager',
            `Provider ${providerName} does not support chat capability`
          )
          return null
        }

        // 사용가리키는정의모델설정
        compatProvider.configure({ model: modelId })
        Logger.info('ProviderManager', `Using default chat model: ${providerName} - ${modelId}`)
        return compatProvider as ChatProvider
      }

      // 만약없있는설정기본대화모델，반환 null
      Logger.warn('ProviderManager', 'No default chat model configured')
      return null
    } catch (error) {
      Logger.error('ProviderManager', 'Failed to get active chat provider:', error)
      return null
    }
  }

  /**
   * 조회활점프의임베딩 provider
   * 만약사용자설정기본임베딩모델아닌사용 가능，직접반환 null，아닌자동 fallback
   */
  async getActiveEmbeddingProvider(): Promise<EmbeddingProvider | null> {
    try {
      const settings = await settingsManager.getAllSettings()
      const defaultEmbeddingModel = settings.defaultEmbeddingModel

      // 만약사용자설정기본임베딩모델,파싱그리고사용
      if (defaultEmbeddingModel && defaultEmbeddingModel.includes(':')) {
        const [providerName, ...modelIdParts] = defaultEmbeddingModel.split(':')
        const modelId = modelIdParts.join(':')
        const provider = await this.getConfiguredProvider(providerName)

        if (!provider) {
          Logger.error(
            'ProviderManager',
            `Provider for default embedding model "${providerName}" is not available or not enabled`
          )
          return null
        }

        // 확인예아니오지원임베딩 기능
        const compatProvider = provider as AISDKProvider
        if (!compatProvider.hasEmbeddingCapability()) {
          Logger.error(
            'ProviderManager',
            `Provider ${providerName} does not support embedding capability`
          )
          return null
        }

        // 사용가리키는정의모델설정
        compatProvider.configure({ model: modelId })
        Logger.info(
          'ProviderManager',
          `Using default embedding model: ${providerName} - ${modelId}`
        )
        return compatProvider as EmbeddingProvider
      }

      // 만약없있는설정기본임베딩모델，반환 null
      Logger.warn('ProviderManager', 'No default embedding model configured')
      return null
    } catch (error) {
      Logger.error('ProviderManager', 'Failed to get active embedding provider:', error)
      return null
    }
  }

  /**
   * 등록자체정의제공자
   * @param config - 자체정의제공자설정
   */
  async registerCustomProvider(config: CustomProviderConfig): Promise<void> {
    const descriptor: ProviderDescriptor = {
      name: config.providerName,
      displayName: config.displayName,
      isBuiltin: false,
      defaultBaseUrl: config.baseUrl,
      capabilities: {
        chat: true, // 자체정의제공자기본거짓설지원대화
        embedding: true // 으로통해 fetchModels 후기반으로모델타입업데이트
      },
      createProvider: (descriptor) => new AISDKProvider(descriptor)
    }

    // 등록에 registry
    this.registry.register(descriptor)

    // 저장설정
    await providerConfigManager.saveProviderConfig(
      config.providerName,
      {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey
      },
      true // 기본활성화
    )

    Logger.info('ProviderManager', `Registered custom provider: ${config.providerName}`)
  }

  /**
   * 컬럼모든등록의제공자이름
   */
  listProviders(): string[] {
    return this.registry.listProviderNames()
  }

  /**
   * 조회제공자설명
   */
  getDescriptor(name: string): ProviderDescriptor | undefined {
    return this.registry.getDescriptor(name)
  }

  /**
   * 컬럼모든제공자설명
   */
  listDescriptors(): ProviderDescriptor[] {
    return this.registry.listDescriptors()
  }

  /**
   * 기반으로기능조회제공자
   */
  getProvidersByCapability(
    capability: 'chat' | 'embedding' | 'rerank' | 'imageGeneration'
  ): ProviderDescriptor[] {
    return this.registry.getProvidersByCapability(capability)
  }

  /**
   * 조회 provider(아닌포함하는설정,용도:하위 호환성)
   * @deprecated 사용 getConfiguredProvider 대체대
   */
  getProvider(name: string): BaseProvider | undefined {
    return this.registry.getProvider(name)
  }

  /**
   * 조회활점프 provider(하위 호환성)
   * @deprecated 사용 getActiveChatProvider 대체대
   */
  async getActiveProvider(): Promise<BaseProvider | null> {
    return this.getActiveChatProvider()
  }

  /**
   * 조회 embedding provider(하위 호환성)
   * @deprecated 사용 getActiveEmbeddingProvider 대체대
   */
  async getEmbeddingProvider(): Promise<BaseProvider | null> {
    return this.getActiveEmbeddingProvider()
  }
}
