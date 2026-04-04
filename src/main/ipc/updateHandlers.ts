import { ipcMain } from 'electron'
import { UpdateService } from '../services/UpdateService'
import Logger from '../../shared/utils/logger'

/**
 * 등록업데이트관련의 IPC Handlers
 */
export function registerUpdateHandlers(updateService: UpdateService): void {
  // 확인업데이트
  ipcMain.handle('update:check', async () => {
    try {
      Logger.info('UpdateHandlers', 'Checking for updates...')
      const state = await updateService.checkForUpdates()
      return { success: true, state }
    } catch (error: any) {
      Logger.error('UpdateHandlers', 'Failed to check for updates:', error)
      return { success: false, error: error.message }
    }
  })

  // 다운로드업데이트
  ipcMain.handle('update:download', async () => {
    try {
      Logger.info('UpdateHandlers', 'Downloading update...')
      await updateService.downloadUpdate()
      return { success: true }
    } catch (error: any) {
      Logger.error('UpdateHandlers', 'Failed to download update:', error)
      return { success: false, error: error.message }
    }
  })

  // 안장업데이트（뒤로그리고안장）
  ipcMain.handle('update:install', async () => {
    try {
      Logger.info('UpdateHandlers', 'Installing update...')
      updateService.quitAndInstall()
      return { success: true }
    } catch (error: any) {
      Logger.error('UpdateHandlers', 'Failed to install update:', error)
      return { success: false, error: error.message }
    }
  })

  // 현재 조회업데이트상태
  ipcMain.handle('update:get-state', async () => {
    try {
      const state = updateService.getState()
      return { success: true, state }
    } catch (error: any) {
      Logger.error('UpdateHandlers', 'Failed to get update state:', error)
      return { success: false, error: error.message }
    }
  })

  Logger.info('UpdateHandlers', 'Update handlers registered')
}
