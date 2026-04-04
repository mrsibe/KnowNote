import type Store from 'electron-store'
import type { StoreSchema } from './types'
import { defaultSettings, defaultShortcuts } from './defaults'

/**
 * electron-store 인스턴스 생성 (동적 임포트 사용)
 */
let store: Store<StoreSchema> | null = null

export async function getStore(): Promise<Store<StoreSchema>> {
  if (!store) {
    const { default: Store } = await import('electron-store')
    store = new Store<StoreSchema>({
      defaults: {
        settings: defaultSettings,
        providers: {},
        shortcuts: defaultShortcuts
      },
      name: 'knownote-config',
      // 파일 저장 위치: ~/Library/Application Support/knownote/knownote-config.json (macOS)
      encryptionKey: undefined // 암호화가 필요한 경우 키 설정 가능
    })
  }
  return store
}
