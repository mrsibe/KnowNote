import type { AppSettings, ShortcutConfig } from '../../shared/types'

/**
 * 제공자 설정 인터페이스
 */
export interface ProviderConfig {
  providerName: string
  config: Record<string, any>
  enabled: boolean
  updatedAt: number
}

/**
 * Store 스키마 정의
 */
export interface StoreSchema {
  settings: AppSettings
  providers: Record<string, ProviderConfig>
  shortcuts: ShortcutConfig[]
}

// 하위 호환성을 위해 AppSettings 재내보내기
export type { AppSettings }
