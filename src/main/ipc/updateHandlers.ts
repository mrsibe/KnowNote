import { ipcMain } from 'electron'
import { UpdateService } from '../services/UpdateService'
import Logger from '../../shared/utils/logger'

/**
 * 업데이트 관련 IPC Handlers 등록
 */
export function registerUpdateHandlers(updateService: UpdateService): void {
  // 업데이트 확인
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

  // 업데이트 다운로드
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

  // 업데이트 설치 (종료 후 설치)
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

  // 현재 업데이트 상태 조회
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
