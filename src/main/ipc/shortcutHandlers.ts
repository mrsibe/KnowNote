import { ipcMain } from 'electron'
import type Store from 'electron-store'
import { ShortcutConfig, ShortcutAction } from '../../shared/types'
import { ShortcutManager } from '../services/ShortcutManager'
import type { StoreSchema } from '../config/types'

/**
 * 등록단축키관련의 IPC Handlers
 */
export function registerShortcutHandlers(
  shortcutManager: ShortcutManager,
  store: Store<StoreSchema>
): void {
  // 모든 단축키 조회
  ipcMain.handle('shortcuts:getAll', (): ShortcutConfig[] => {
    return (store.get('shortcuts') as ShortcutConfig[]) || []
  })

  // 단축키 업데이트
  ipcMain.handle(
    'shortcuts:update',
    (_event, action: ShortcutAction, accelerator: string): void => {
      shortcutManager.updateShortcut(action, accelerator)
    }
  )

  // 전환단축키의활성화/비활성화상태
  ipcMain.handle('shortcuts:toggle', (_event, action: ShortcutAction, enabled: boolean): void => {
    shortcutManager.toggleShortcut(action, enabled)
  })

  // 재단일개단축키기본값
  ipcMain.handle('shortcuts:resetSingle', (_event, action: ShortcutAction): void => {
    shortcutManager.resetSingle(action)
  })

  // 재기본설정
  ipcMain.handle('shortcuts:reset', (): void => {
    shortcutManager.resetToDefaults()
  })

  console.log('[IPC] Shortcut handlers registered')
}
