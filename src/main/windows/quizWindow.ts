import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'
import { applyTitleBarTheme, titleBarOverlayOptions } from './titleBarOverlay'

let quizWindow: BrowserWindow | null = null

/**
 * 创建答题窗口
 * @param notebookId - 笔记本 ID（用于生成新答题）
 * @param quizId - 答题 ID（用于查看特定版本，可选）
 */
export function createQuizWindow(notebookId: string, quizId?: string): void {
  // 如果答题窗口已经存在，则聚焦并返回
  if (quizWindow && !quizWindow.isDestroyed()) {
    quizWindow.focus()
    // 如果传入了新的路由参数，更新 URL
    const route = quizId ? `/quiz/view/${quizId}` : `/quiz/${notebookId}`
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      quizWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`)
    } else {
      quizWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: route
      })
    }
    return
  }

  // 根据用户主题设置背景色
  const theme = settingsManager.getSettingSync('theme')
  const backgroundColor = theme === 'dark' ? '#1a1b1e' : '#fafafa'

  // 创建答题窗口
  quizWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 800,
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

  quizWindow.on('ready-to-show', () => {
    quizWindow?.show()
  })

  quizWindow.on('closed', () => {
    quizWindow = null
  })

  // 监听主题变化
  settingsManager.onSettingsChangeSync((newSettings) => {
    if (quizWindow && !quizWindow.isDestroyed()) {
      const newBackgroundColor = newSettings.theme === 'dark' ? '#1a1b1e' : '#fafafa'
      quizWindow.setBackgroundColor(newBackgroundColor)
      applyTitleBarTheme(quizWindow, newSettings.theme)
    }
  })

  // 加载答题页面
  const route = quizId ? `/quiz/view/${quizId}` : `/quiz/${notebookId}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    quizWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`)
  } else {
    quizWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: route
    })
  }
}

/**
 * 获取答题窗口实例
 */
export function getQuizWindow(): BrowserWindow | null {
  return quizWindow
}

/**
 * 销毁答题窗口
 */
export function destroyQuizWindow(): void {
  if (quizWindow && !quizWindow.isDestroyed()) {
    quizWindow.destroy()
    quizWindow = null
  }
}
