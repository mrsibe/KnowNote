import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'

let quizWindow: BrowserWindow | null = null

/**
 * 퀴즈 윈도우 생성
 * @param notebookId - 노트북 ID (용도: 새 퀴즈 생성)
 * @param quizId - 퀴즈 ID (용도: 특정 버전 보기, 선택)
 */
export function createQuizWindow(notebookId: string, quizId?: string): void {
  // 퀴즈 윈도우가 이미 존재하면 포커스 후 반환
  if (quizWindow && !quizWindow.isDestroyed()) {
    quizWindow.focus()
    // 새 라우트 파라미터가 전달되면 URL 업데이트
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

  // 사용자 테마 설정에 따라 배경색 설정
  const theme = settingsManager.getSettingSync('theme')
  const backgroundColor = theme === 'dark' ? '#1a1b1e' : '#fafafa'

  // 퀴즈 윈도우 생성
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
    ...(process.platform !== 'darwin'
      ? { titleBarOverlay: { color: 'rgba(0,0,0,0)', height: 35, symbolColor: 'white' } }
      : {}),
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

  // 테마 변경 감지
  settingsManager.onSettingsChangeSync((newSettings) => {
    if (quizWindow && !quizWindow.isDestroyed()) {
      const newBackgroundColor = newSettings.theme === 'dark' ? '#1a1b1e' : '#fafafa'
      quizWindow.setBackgroundColor(newBackgroundColor)
    }
  })

  // 퀴즈 페이지 로드
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
 * 퀴즈 윈도우 인스턴스 조회
 */
export function getQuizWindow(): BrowserWindow | null {
  return quizWindow
}

/**
 * 퀴즈 윈도우 파괴
 */
export function destroyQuizWindow(): void {
  if (quizWindow && !quizWindow.isDestroyed()) {
    quizWindow.destroy()
    quizWindow = null
  }
}
