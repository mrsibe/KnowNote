import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'

let mainWindow: BrowserWindow | null = null

/**
 * 생성메인 윈도우
 */
export function createMainWindow(): BrowserWindow {
  // 기반으로사용자테마설정배배경색，회피면윈도우조정크기시현재공백테두리
  const theme = settingsManager.getSettingSync('theme')
  const backgroundColor = theme === 'dark' ? '#282c34' : '#fafafa'

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    // remove the default titlebar
    titleBarStyle: 'hidden',
    // Position macOS traffic lights (window controls)
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    // expose window controls in Windows/Linux
    ...(process.platform !== 'darwin'
      ? { titleBarOverlay: { color: 'rgba(0,0,0,0)', height: 35, symbolColor: 'white' } }
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

  // 감시테마변경，동상태업데이트윈도우배배경색
  settingsManager.onSettingsChangeSync((newSettings) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const newBackgroundColor = newSettings.theme === 'dark' ? '#282c34' : '#fafafa'
      mainWindow.setBackgroundColor(newBackgroundColor)
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
 * 조회메인 윈도우인스턴스
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
