import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsManager } from '../config'

let quizWindow: BrowserWindow | null = null

/**
 * 생성퀴즈윈도우
 * @param notebookId - 노트북 ID（용도:생성새퀴즈）
 * @param quizId - 퀴즈 ID（용도:조회보기특정버전，선택）
 */
export function createQuizWindow(notebookId: string, quizId?: string): void {
  // 만약퀴즈윈도우이미존재，집중포커스그리고반환
  if (quizWindow && !quizWindow.isDestroyed()) {
    quizWindow.focus()
    // 만약전달입력새의라우트매개변수，업데이트 URL
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

  // 기반으로사용자테마설정배배경색
  const theme = settingsManager.getSettingSync('theme')
  const backgroundColor = theme === 'dark' ? '#1a1b1e' : '#fafafa'

  // 생성퀴즈윈도우
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

  // 감시테마변경
  settingsManager.onSettingsChangeSync((newSettings) => {
    if (quizWindow && !quizWindow.isDestroyed()) {
      const newBackgroundColor = newSettings.theme === 'dark' ? '#1a1b1e' : '#fafafa'
      quizWindow.setBackgroundColor(newBackgroundColor)
    }
  })

  // 로드퀴즈페이지
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
 * 조회퀴즈윈도우인스턴스
 */
export function getQuizWindow(): BrowserWindow | null {
  return quizWindow
}

/**
 * 소멸퀴즈윈도우
 */
export function destroyQuizWindow(): void {
  if (quizWindow && !quizWindow.isDestroyed()) {
    quizWindow.destroy()
    quizWindow = null
  }
}
