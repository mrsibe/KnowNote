/**
 * Provider Registry
 * 제공자등록테이블,관리모든등록의제공자설명및인스턴스
 */

import type { BaseProvider } from '../capabilities/BaseProvider'
import type { ProviderDescriptor } from './ProviderDescriptor'
import Logger from '../../../shared/utils/logger'

/**
 * ProviderRegistry
 * 관리제공자설명및인스턴스의등록테이블
 */
export class ProviderRegistry {
  // 제공자설명매핑 (name -> descriptor)
  private descriptors: Map<string, ProviderDescriptor> = new Map()

  // 제공자인스턴스캐시 (name -> instance)
  private instances: Map<string, BaseProvider> = new Map()

  constructor() {
    Logger.info('ProviderRegistry', 'Provider registry initialized')
  }

  /**
   * 등록제공자설명
   * @param descriptor - 제공자설명
   */
  register(descriptor: ProviderDescriptor): void {
    if (this.descriptors.has(descriptor.name)) {
      Logger.warn(
        'ProviderRegistry',
        `Provider ${descriptor.name} already registered, will be overwritten`
      )
    }

    this.descriptors.set(descriptor.name, descriptor)
    // 정리제외이전의인스턴스캐시(만약있는)
    this.instances.delete(descriptor.name)

    Logger.info('ProviderRegistry', `Registered provider: ${descriptor.name}`)
  }

  /**
   * 일괄등록제공자설명
   * @param descriptors - 제공자설명배열
   */
  registerMany(descriptors: ProviderDescriptor[]): void {
    descriptors.forEach((descriptor) => this.register(descriptor))
  }

  /**
   * 조회제공자인스턴스(지연로드생성)
   * @param name - 제공자이름
   * @returns Provider 인스턴스또는 undefined
   */
  getProvider(name: string): BaseProvider | undefined {
    // 먼저확인캐시
    if (this.instances.has(name)) {
      return this.instances.get(name)
    }

    // 없있는캐시,에서설명생성
    const descriptor = this.descriptors.get(name)
    if (!descriptor) {
      Logger.warn('ProviderRegistry', `Provider ${name} not registered`)
      return undefined
    }

    try {
      const instance = descriptor.createProvider(descriptor)
      this.instances.set(name, instance)
      Logger.info('ProviderRegistry', `Created instance for provider: ${name}`)
      return instance
    } catch (error) {
      Logger.error('ProviderRegistry', `Failed to create provider ${name}:`, error)
      return undefined
    }
  }

  /**
   * 조회제공자설명
   * @param name - 제공자이름
   * @returns ProviderDescriptor 또는 undefined
   */
  getDescriptor(name: string): ProviderDescriptor | undefined {
    return this.descriptors.get(name)
  }

  /**
   * 컬럼모든등록의제공자설명
   * @returns ProviderDescriptor 배열
   */
  listDescriptors(): ProviderDescriptor[] {
    return Array.from(this.descriptors.values())
  }

  /**
   * 컬럼모든등록의제공자이름
   * @returns 제공자이름배열
   */
  listProviderNames(): string[] {
    return Array.from(this.descriptors.keys())
  }

  /**
   * 기반으로기능쿼리제공자
   * @param capability - 기능이름 ('chat' | 'embedding' | 'rerank' | 'imageGeneration')
   * @returns 지원기능의제공자설명배열
   */
  getProvidersByCapability(
    capability: 'chat' | 'embedding' | 'rerank' | 'imageGeneration'
  ): ProviderDescriptor[] {
    return Array.from(this.descriptors.values()).filter((descriptor) => {
      return descriptor.capabilities[capability] === true
    })
  }

  /**
   * 조회내장제공자목록
   * @returns 내장제공자설명배열
   */
  getBuiltinProviders(): ProviderDescriptor[] {
    return Array.from(this.descriptors.values()).filter((descriptor) => descriptor.isBuiltin)
  }

  /**
   * 조회자체정의제공자목록
   * @returns 자체정의제공자설명배열
   */
  getCustomProviders(): ProviderDescriptor[] {
    return Array.from(this.descriptors.values()).filter((descriptor) => !descriptor.isBuiltin)
  }

  /**
   * 확인제공자예아니오등록
   * @param name - 제공자이름
   * @returns 예아니오등록
   */
  has(name: string): boolean {
    return this.descriptors.has(name)
  }

  /**
   * ���동제외제공자
   * @param name - 제공자이름
   */
  unregister(name: string): void {
    this.descriptors.delete(name)
    this.instances.delete(name)
    Logger.info('ProviderRegistry', `Unregistered provider: ${name}`)
  }

  /**
   * 정리제외모든인스턴스캐시
   * 용도:강제재새생성모든인스턴스
   */
  clearInstanceCache(): void {
    this.instances.clear()
    Logger.info('ProviderRegistry', 'Cleared all provider instances')
  }
}
