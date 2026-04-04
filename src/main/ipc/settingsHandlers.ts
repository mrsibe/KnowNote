import { ipcMain, BrowserWindow } from 'electron'
import { settingsManager, type AppSettings, defaultSettings } from '../config'
import { SettingsSchemas, validate } from './validation'

/**
 * 방향모든윈도우광범위재생설정변경
 */
function broadcastSettingsChange(newSettings: AppSettings, oldSettings: AppSettings): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('settings:changed', newSettings, oldSettings)
    }
  })
}

/**
 * 등록설정관련의 IPC Handlers
 */
export function registerSettingsHandlers(): void {
  // 모든 설정 조회
  ipcMain.handle('settings:getAll', async () => {
    return await settingsManager.getAllSettings()
  })

  // 단일 설정 조회（포함하는매개변수검증）
  ipcMain.handle(
    'settings:get',
    validate(SettingsSchemas.get, async (args) => {
      return await settingsManager.getSetting(args.key as keyof AppSettings)
    })
  )

  // 설정 업데이트（포함하는매개변수검증）
  ipcMain.handle(
    'settings:update',
    validate(SettingsSchemas.update, async (args) => {
      await settingsManager.updateSettings(args.updates)
      return await settingsManager.getAllSettings()
    })
  )

  // 설정단일개값（포함하는매개변수검증）
  ipcMain.handle(
    'settings:set',
    validate(SettingsSchemas.set, async (args) => {
      await settingsManager.setSetting(args.key as keyof AppSettings, args.value)
      return await settingsManager.getSetting(args.key as keyof AppSettings)
    })
  )

  // 재설정
  ipcMain.handle('settings:reset', async () => {
    await settingsManager.resetSettings()
    return await settingsManager.getAllSettings()
  })

  // 조회기본힌트
  ipcMain.handle('settings:getDefaultPrompts', async () => {
    return defaultSettings.prompts
  })

  // 감시설정변경그리고광범위재생에모든윈도우
  settingsManager.onSettingsChange((newSettings, oldSettings) => {
    console.log('[IPC] Settings changed, broadcasting to all windows')
    broadcastSettingsChange(newSettings, oldSettings)
  })

  console.log('[IPC] Settings handlers registered')
}
