import { ipcMain, dialog, BrowserWindow } from 'electron'

/**
 * 등록시리즈통합다이얼로그관련의 IPC Handlers
 */
export function registerDialogHandlers() {
  // 저장파일다이얼로그
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
