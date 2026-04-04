/**
 * Quiz IPC Handlers
 * 퀴즈공의 IPC 통��처리
 */

import { ipcMain } from 'electron'
import type { QuizService, QuizGenerationOptions } from '../services/QuizService'
import { createQuizWindow } from '../windows/quizWindow'

/**
 * 등록quiz관련의IPC handlers
 */
export function registerQuizHandlers(quizService: QuizService) {
  /**
   * 생성문제
   */
  ipcMain.handle(
    'quiz:generate',
    async (event, args: { notebookId: string; options?: QuizGenerationOptions }) => {
      try {
        const quizId = await quizService.generateQuiz(
          args.notebookId,
          args.options,
          (stage, progress) => {
            // 전송진행업데이트이벤트
            if (!event.sender.isDestroyed()) {
              event.sender.send('quiz:progress', {
                notebookId: args.notebookId,
                stage,
                progress
              })
            }
          }
        )
        return { success: true, quizId }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * 노트북 조회최신문제라이브러리
   */
  ipcMain.handle('quiz:get-latest', async (_, args: { notebookId: string }) => {
    try {
      const quiz = quizService.getLatestQuiz(args.notebookId)
      return quiz || null
    } catch (error) {
      console.error('Error getting latest quiz:', error)
      return null
    }
  })

  /**
   * 조회가리키는정문제라이브러리
   */
  ipcMain.handle('quiz:get', async (_, args: { quizId: string }) => {
    try {
      const quiz = quizService.getQuiz(args.quizId)
      return quiz || null
    } catch (error) {
      console.error('Error getting quiz:', error)
      return null
    }
  })

  /**
   * 제출퀴즈세션
   */
  ipcMain.handle(
    'quiz:submit-session',
    async (_, args: { quizId: string; answers: Record<string, number> }) => {
      try {
        const sessionId = quizService.submitSession(args.quizId, args.answers)
        return { success: true, sessionId }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * 조회퀴즈세션
   */
  ipcMain.handle('quiz:get-session', async (_, args: { sessionId: string }) => {
    try {
      const session = quizService.getSession(args.sessionId)
      return session || null
    } catch (error) {
      console.error('Error getting quiz session:', error)
      return null
    }
  })

  /**
   * 업데이트문제라이브러리
   */
  ipcMain.handle(
    'quiz:update',
    async (_, args: { quizId: string; updates: { title?: string } }) => {
      try {
        quizService.updateQuiz(args.quizId, args.updates)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * 문제은행 삭제
   */
  ipcMain.handle('quiz:delete', async (_, args: { quizId: string }) => {
    try {
      quizService.deleteQuiz(args.quizId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  /**
   * 열기퀴즈윈도우
   */
  ipcMain.handle('quiz:open-window', async (_, args: { notebookId: string; quizId?: string }) => {
    try {
      createQuizWindow(args.notebookId, args.quizId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
