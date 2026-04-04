import { ipcMain, BrowserWindow } from 'electron'
import { settingsManager, type AppSettings, defaultSettings } from '../config'
import { SettingsSchemas, validate } from './validation'

/**
 * 모든 윈도우에 설정 변경 브로드캐스트
 */
function broadcastSettingsChange(newSettings: AppSettings, oldSettings: AppSettings): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('settings:changed', newSettings, oldSettings)
    }
  })
}

/**
 * 설정 관련 IPC Handlers 등록
 */
export function registerSettingsHandlers(): void {
  // 모든 설정 조회
  ipcMain.handle('settings:getAll', async () => {
    return await settingsManager.getAllSettings()
  })

  // 단일 설정 조회 (매개변수 검증 포함)
  ipcMain.handle(
    'settings:get',
    validate(SettingsSchemas.get, async (args) => {
      return await settingsManager.getSetting(args.key as keyof AppSettings)
    })
  )

  // 설정 업데이트 (매개변수 검증 포함)
  ipcMain.handle(
    'settings:update',
    validate(SettingsSchemas.update, async (args) => {
      await settingsManager.updateSettings(args.updates)
      return await settingsManager.getAllSettings()
    })
  )

  // 단일 값 설정 (매개변수 검증 포함)
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

  // 기본 프롬프트 조회
  ipcMain.handle('settings:getDefaultPrompts', async () => {
    return defaultSettings.prompts
  })

  // 설정 변경 감지 및 모든 윈도우에 브로드캐스트
  settingsManager.onSettingsChange((newSettings, oldSettings) => {
    console.log('[IPC] Settings changed, broadcasting to all windows')
    broadcastSettingsChange(newSettings, oldSettings)
  })

  console.log('[IPC] Settings handlers registered')
}
