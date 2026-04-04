import { ipcMain, dialog, BrowserWindow } from 'electron'

/**
 * 시스템 통합 다이얼로그 관련 IPC Handlers 등록
 */
export function registerDialogHandlers() {
  // 파일 저장 다이얼로그
  ipcMain.handle(
    'dialog:saveFile',
    async (
      _,
      options: {
        title?: string
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
      } = {}
    ) => {
      const win = BrowserWindow.getFocusedWindow()

      if (!win) {
        return null
      }

      try {
        const result = await dialog.showSaveDialog(win, {
          title: options.title || 'Save File',
          defaultPath: options.defaultPath,
          filters: options.filters || []
        })

        return result.canceled ? null : result.filePath
      } catch (error) {
        console.error('dialog:saveFile error:', error)
        return null
      }
    }
  )

  console.log('[IPC] Dialog handlers registered')
}
