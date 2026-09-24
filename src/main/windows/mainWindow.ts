import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'
import { applyTitleBarTheme, titleBarOverlayOptions } from './titleBarOverlay'

let mainWindow: BrowserWindow | null = null

/**
 * 创建主窗口
 */
export function createMainWindow(): BrowserWindow {
  // 根据用户主题设置背景色，避免窗口调整大小时出现白边
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
    ...(process.platform !== 'darwin' ? { titleBarOverlay: titleBarOverlayOptions(theme) } : {}),
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

  // 监听主题变化，动态更新窗口背景色和窗口按钮颜色
  settingsManager.onSettingsChangeSync((newSettings) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const newBackgroundColor = newSettings.theme === 'dark' ? '#282c34' : '#fafafa'
      mainWindow.setBackgroundColor(newBackgroundColor)
      applyTitleBarTheme(mainWindow, newSettings.theme)
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
 * 获取主窗口实例
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
