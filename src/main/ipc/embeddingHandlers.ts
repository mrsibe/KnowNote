/**
 * Embedding IPC Handlers
 *
 * 内置本地 embedding 模型的状态、下载、取消、删除、手动导入与下载源探测。
 * 下载进度通过 `embedding:download-progress` 广播给所有窗口。
 */

import { ipcMain, BrowserWindow, dialog } from 'electron'
import type { EmbeddingService } from '../services/EmbeddingService'
import type {
  EmbeddingDownloadProgress,
  EmbeddingSourceInfo,
  LocalEmbeddingModelInfo
} from '../../shared/types'
import Logger from '../../shared/utils/logger'

export interface EmbeddingStatus {
  activeBackend: 'local' | 'remote'
  remoteConfigured: boolean
  downloading: boolean
  localModel: LocalEmbeddingModelInfo
}

function broadcastProgress(progress: EmbeddingDownloadProgress): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('embedding:download-progress', progress)
    }
  })
}

export function registerEmbeddingHandlers(embeddingService: EmbeddingService): void {
  ipcMain.handle('embedding:get-status', async (): Promise<EmbeddingStatus> => {
    const remoteConfigured = await embeddingService.isRemoteConfigured()
    const localModel = await embeddingService.getLocalModelInfo()
    return {
      activeBackend: remoteConfigured ? 'remote' : 'local',
      remoteConfigured,
      downloading: embeddingService.isDownloading(),
      localModel
    }
  })

  ipcMain.handle('embedding:download', async () => {
    try {
      await embeddingService.downloadLocalModel()
      return { success: true }
    } catch (error) {
      Logger.error('EmbeddingHandlers', 'Download failed:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('embedding:cancel-download', async () => {
    embeddingService.cancelLocalModelDownload()
    return { success: true }
  })

  ipcMain.handle('embedding:delete-local', async () => {
    try {
      await embeddingService.deleteLocalModel()
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('embedding:probe-sources', async (): Promise<EmbeddingSourceInfo[]> => {
    try {
      return await embeddingService.probeSources()
    } catch (error) {
      Logger.error('EmbeddingHandlers', 'Probe failed:', error)
      return []
    }
  })

  ipcMain.handle('embedding:import-local', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select the folder that contains the model files',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    try {
      const problems = await embeddingService.importLocalModel(result.filePaths[0])
      if (problems.length > 0) {
        return { success: false, missingFiles: problems }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // 下载进度广播由 EmbeddingService 的 onDownloadProgress 注入，见 main/index.ts
  Logger.info('EmbeddingHandlers', 'Embedding handlers registered')
}

export { broadcastProgress }
