import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'

let ankiWindow: BrowserWindow | null = null
let settingsUnsubscribe: (() => void) | null = null

/**
 * Anki 카드 윈도우 생성
 * @param notebookId - 노트북 ID (용도: 새 카드 생성)
 * @param ankiCardId - Anki 카드 세트 ID (용도: 특정 버전 보기, 선택)
 */
export function createAnkiWindow(notebookId: string, ankiCardId?: string): void {
  // Anki 윈도우가 이미 존재하면 포커스 후 반환
  if (ankiWindow && !ankiWindow.isDestroyed()) {
    ankiWindow.focus()
    // 새 라우트 파라미터가 전달되면 URL 업데이트
    const route = ankiCardId ? `/anki/view/${ankiCardId}` : `/anki/${notebookId}`
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      ankiWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`)
    } else {
      ankiWindow.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: route
      })
    }
    return
  }

  // 사용자 테마 설정에 따라 배경색 설정
  const theme = settingsManager.getSettingSync('theme')
  const backgroundColor = theme === 'dark' ? '#1a1b1e' : '#fafafa'
  const preferDark = nativeTheme.shouldUseDarkColors || theme === 'dark'

  // Anki 카드 윈도우 생성
  ankiWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    // Position macOS traffic lights (window controls)
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    ...(process.platform !== 'darwin'
      ? {
          titleBarOverlay: {
            color: 'rgba(0,0,0,0)',
            height: 35,
            symbolColor: preferDark ? 'white' : 'black'
          }
        }
      : {}),
    backgroundColor,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  ankiWindow.on('ready-to-show', () => {
    ankiWindow?.show()
  })

  ankiWindow.on('closed', () => {
    // settings 감시 해제
    if (settingsUnsubscribe) {
      try {
        settingsUnsubscribe()
      } catch {
        // ignore
      }
      settingsUnsubscribe = null
    }

    ankiWindow = null
  })

  // 테마 변경 감지 (async 버전 사용으로 unsubscribe 편의성)
  settingsManager
    .onSettingsChange((newSettings) => {
      if (ankiWindow && !ankiWindow.isDestroyed()) {
        const newBackgroundColor = newSettings.theme === 'dark' ? '#1a1b1e' : '#fafafa'
        ankiWindow.setBackgroundColor(newBackgroundColor)
        // titleBarOverlay의 기호 색상 업데이트
        const newSymbol = newSettings.theme === 'dark' ? 'white' : 'black'
        try {
          ankiWindow.setTitleBarOverlay({ symbolColor: newSymbol })
        } catch {
          // 일부 플랫폼이나 이전 버전에서는 setTitleBarOverlay를 지원하지 않음
        }
      }
    })
    .then((unsubscribe) => {
      settingsUnsubscribe = unsubscribe
    })

  // Anki 카드 페이지 로드
  const route = ankiCardId ? `/anki/view/${ankiCardId}` : `/anki/${notebookId}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    ankiWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`)
  } else {
    ankiWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: route
    })
  }
}

/**
 * Anki 윈도우 인스턴스 조회
 */
export function getAnkiWindow(): BrowserWindow | null {
  return ankiWindow
}

/**
 * Anki 윈도우 파괴
 */
export function destroyAnkiWindow(): void {
  if (ankiWindow && !ankiWindow.isDestroyed()) {
    ankiWindow.destroy()
    ankiWindow = null
  }
}
