import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'

let mindMapWindow: BrowserWindow | null = null

/**
 * 마인드맵 윈도우 생성
 * @param notebookId - 노트북 ID (용도: 새 마인드맵 생성)
 * @param mindMapId - 마인드맵 ID (용도: 특정 버전 보기, 선택)
 */
export function createMindMapWindow(notebookId: string, mindMapId?: string): void {
  // 마인드맵 윈도우가 이미 존재하면 포커스 후 반환
  if (mindMapWindow && !mindMapWindow.isDestroyed()) {
    mindMapWindow.focus()
    // 새 라우트 파라미터가 전달되면 URL 업데이트
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

  // 사용자 테마 설정에 따라 배경색 설정
  const theme = settingsManager.getSettingSync('theme')
  const backgroundColor = theme === 'dark' ? '#1a1b1e' : '#fafafa'

  // 마인드맵 윈도우 생성
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

  // 테마 변경 감지
  settingsManager.onSettingsChangeSync((newSettings) => {
    if (mindMapWindow && !mindMapWindow.isDestroyed()) {
      const newBackgroundColor = newSettings.theme === 'dark' ? '#1a1b1e' : '#fafafa'
      mindMapWindow.setBackgroundColor(newBackgroundColor)
    }
  })

  // 마인드맵 페이지 로드
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
 * 마인드맵 윈도우 인스턴스 조회
 */
export function getMindMapWindow(): BrowserWindow | null {
  return mindMapWindow
}

/**
 * 마인드맵 윈도우 파괴
 */
export function destroyMindMapWindow(): void {
  if (mindMapWindow && !mindMapWindow.isDestroyed()) {
    mindMapWindow.destroy()
    mindMapWindow = null
  }
}
