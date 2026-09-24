import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'
import { applyTitleBarTheme, titleBarOverlayOptions } from './titleBarOverlay'

let mindMapWindow: BrowserWindow | null = null

/**
 * 创建思维导图窗口
 * @param notebookId - 笔记本 ID（用于生成新思维导图）
 * @param mindMapId - 思维导图 ID（用于查看特定版本，可选）
 */
export function createMindMapWindow(notebookId: string, mindMapId?: string): void {
  // 如果思维导图窗口已经存在，则聚焦并返回
  if (mindMapWindow && !mindMapWindow.isDestroyed()) {
    mindMapWindow.focus()
    // 如果传入了新的路由参数，更新 URL
    const route = mindMapId ? `/mindmap/view/${mindMapId}` : `/mindmap/${notebookId}`
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      mindMapWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`)
    } else {
      mindMapWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: route
      })
    }
    return
  }

  // 根据用户主题设置背景色
  const theme = settingsManager.getSettingSync('theme')
  const backgroundColor = theme === 'dark' ? '#1a1b1e' : '#fafafa'

  // 创建思维导图窗口
  mindMapWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    // Position macOS traffic lights (window controls)
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    ...(process.platform !== 'darwin' ? { titleBarOverlay: titleBarOverlayOptions(theme) } : {}),
    backgroundColor,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mindMapWindow.on('ready-to-show', () => {
    mindMapWindow?.show()
  })

  mindMapWindow.on('closed', () => {
    mindMapWindow = null
  })

  // 监听主题变化
  settingsManager.onSettingsChangeSync((newSettings) => {
    if (mindMapWindow && !mindMapWindow.isDestroyed()) {
      const newBackgroundColor = newSettings.theme === 'dark' ? '#1a1b1e' : '#fafafa'
      mindMapWindow.setBackgroundColor(newBackgroundColor)
      applyTitleBarTheme(mindMapWindow, newSettings.theme)
    }
  })

  // 加载思维导图页面
  const route = mindMapId ? `/mindmap/view/${mindMapId}` : `/mindmap/${notebookId}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mindMapWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`)
  } else {
    mindMapWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: route
    })
  }
}

/**
 * 获取思维导图窗口实例
 */
export function getMindMapWindow(): BrowserWindow | null {
  return mindMapWindow
}

/**
 * 销毁思维导图窗口
 */
export function destroyMindMapWindow(): void {
  if (mindMapWindow && !mindMapWindow.isDestroyed()) {
    mindMapWindow.destroy()
    mindMapWindow = null
  }
}
