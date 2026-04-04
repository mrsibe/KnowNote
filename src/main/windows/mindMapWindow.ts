import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'

let mindMapWindow: BrowserWindow | null = null

/**
 * 생성마인드맵윈도우
 * @param notebookId - 노트북 ID（용도:생성새마인드맵）
 * @param mindMapId - 마인드맵 ID（용도:조회보기특정버전，선택）
 */
export function createMindMapWindow(notebookId: string, mindMapId?: string): void {
  // 만약마인드맵윈도우이미존재，집중포커스그리고반환
  if (mindMapWindow && !mindMapWindow.isDestroyed()) {
    mindMapWindow.focus()
    // 만약전달입력새의라우트매개변수，업데이트 URL
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

  // 기반으로사용자테마설정배배경색
  const theme = settingsManager.getSettingSync('theme')
  const backgroundColor = theme === 'dark' ? '#1a1b1e' : '#fafafa'

  // 생성마인드맵윈도우
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
    ...(process.platform !== 'darwin'
      ? { titleBarOverlay: { color: 'rgba(0,0,0,0)', height: 35, symbolColor: 'white' } }
      : {}),
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

  // 감시테마변경
  settingsManager.onSettingsChangeSync((newSettings) => {
    if (mindMapWindow && !mindMapWindow.isDestroyed()) {
      const newBackgroundColor = newSettings.theme === 'dark' ? '#1a1b1e' : '#fafafa'
      mindMapWindow.setBackgroundColor(newBackgroundColor)
    }
  })

  // 로드마인드맵페이지
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
 * 마인드맵 조회윈도우인스턴스
 */
export function getMindMapWindow(): BrowserWindow | null {
  return mindMapWindow
}

/**
 * 소멸마인드맵윈도우
 */
export function destroyMindMapWindow(): void {
  if (mindMapWindow && !mindMapWindow.isDestroyed()) {
    mindMapWindow.destroy()
    mindMapWindow = null
  }
}
