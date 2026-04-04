import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'

let mainWindow: BrowserWindow | null = null

/**
 * 메인 윈도우 생성
 */
export function createMainWindow(): BrowserWindow {
  // 사용자 테마 설정에 따라 배경색 및 타이틀바 색상 설정
  const theme = settingsManager.getSettingSync('theme')
  const isDark = theme === 'dark'
  const backgroundColor = isDark ? '#282c34' : '#fafafa'
  const symbolColor = isDark ? '#ffffff' : '#333333'

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    ...(process.platform !== 'darwin'
      ? { titleBarOverlay: { color: 'rgba(0,0,0,0)', height: 35, symbolColor } }
      : {}),
    backgroundColor,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 테마 변경 감지, 윈도우 배경색 및 타이틀바 색상 동적 업데이트
  settingsManager.onSettingsChangeSync((newSettings) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const newIsDark = newSettings.theme === 'dark'
      const newBackgroundColor = newIsDark ? '#282c34' : '#fafafa'
      const newSymbolColor = newIsDark ? '#ffffff' : '#333333'
      mainWindow.setBackgroundColor(newBackgroundColor)
      if (process.platform !== 'darwin') {
        mainWindow.setTitleBarOverlay({
          color: 'rgba(0,0,0,0)',
          height: 35,
          symbolColor: newSymbolColor
        })
      }
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

/**
 * 메인 윈도우 인스턴스 조회
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
