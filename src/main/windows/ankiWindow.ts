import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'

let ankiWindow: BrowserWindow | null = null
let settingsUnsubscribe: (() => void) | null = null

/**
 * 생성Anki카드윈도우
 * @param notebookId - 노트북 ID（용도:생성새카드）
 * @param ankiCardId - Anki카드세트 ID（용도:조회보기특정버전，선택）
 */
export function createAnkiWindow(notebookId: string, ankiCardId?: string): void {
  // 만약Anki윈도우이미존재，집중포커스그리고반환
  if (ankiWindow && !ankiWindow.isDestroyed()) {
    ankiWindow.focus()
    // 만약전달입력새의라우트매개변수，업데이트 URL
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

  // 기반으로사용자테마설정배배경색
  const theme = settingsManager.getSettingSync('theme')
  const backgroundColor = theme === 'dark' ? '#1a1b1e' : '#fafafa'
  const preferDark = nativeTheme.shouldUseDarkColors || theme === 'dark'

  // 생성Anki카드윈도우
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
    // 취소settings감시
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

  // 감시테마변경（사용 async 버전으로편리조회 unsubscribe）
  settingsManager
    .onSettingsChange((newSettings) => {
      if (ankiWindow && !ankiWindow.isDestroyed()) {
        const newBackgroundColor = newSettings.theme === 'dark' ? '#1a1b1e' : '#fafafa'
        ankiWindow.setBackgroundColor(newBackgroundColor)
        // 업데이트 titleBarOverlay 의번호색상
        const newSymbol = newSettings.theme === 'dark' ? 'white' : 'black'
        try {
          ankiWindow.setTitleBarOverlay({ symbolColor: newSymbol })
        } catch {
          // 어떤플랫폼또는이전버전미지원 setTitleBarOverlay
        }
      }
    })
    .then((unsubscribe) => {
      settingsUnsubscribe = unsubscribe
    })

  // 로드Anki카드페이지
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
 * 조회Anki윈도우인스턴스
 */
export function getAnkiWindow(): BrowserWindow | null {
  return ankiWindow
}

/**
 * 소멸Anki윈도우
 */
export function destroyAnkiWindow(): void {
  if (ankiWindow && !ankiWindow.isDestroyed()) {
    ankiWindow.destroy()
    ankiWindow = null
  }
}
