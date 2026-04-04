/**
 * Anki IPC Handlers
 * Anki카드공의 IPC 통��처리
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { AnkiCardService } from '../services/AnkiCardService'
import type { AnkiExportFormat, AnkiGenerationOptions } from '../../shared/types/anki'
import { createAnkiWindow } from '../windows/ankiWindow'
import { ApkgExporter } from '../services/exporters/ApkgExporter'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'

/**
 * 등록anki관련의IPC handlers
 */
export function registerAnkiHandlers(ankiCardService: AnkiCardService) {
  /**
   * 생성카드
   */
  ipcMain.handle(
    'anki:generate',
    async (event, args: { notebookId: string; options?: AnkiGenerationOptions }) => {
      try {
        const ankiCardId = await ankiCardService.generateAnkiCards(
          args.notebookId,
          args.options,
          (stage, progress) => {
            // 전송진행업데이트이벤트
            if (!event.sender.isDestroyed()) {
              event.sender.send('anki:progress', {
                notebookId: args.notebookId,
                stage,
                progress
              })
            }
          }
        )
        return { success: true, ankiCardId }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * 노트북 조회최신카드세트
   */
  ipcMain.handle('anki:get-latest', async (_, args: { notebookId: string }) => {
    try {
      const ankiCard = ankiCardService.getLatestAnkiCards(args.notebookId)
      return ankiCard || null
    } catch (error) {
      console.error('Error getting latest anki cards:', error)
      return null
    }
  })

  /**
   * 조회가리키는정카드세트
   */
  ipcMain.handle('anki:get', async (_, args: { ankiCardId: string }) => {
    try {
      const ankiCard = ankiCardService.getAnkiCards(args.ankiCardId)
      return ankiCard || null
    } catch (error) {
      console.error('Error getting anki cards:', error)
      return null
    }
  })

  /**
   * 업데이트카드세트
   */
  ipcMain.handle(
    'anki:update',
    async (_, args: { ankiCardId: string; updates: { title?: string } }) => {
      try {
        ankiCardService.updateAnkiCards(args.ankiCardId, args.updates)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * 삭제카드세트
   */
  ipcMain.handle('anki:delete', async (_, args: { ankiCardId: string }) => {
    try {
      ankiCardService.deleteAnkiCards(args.ankiCardId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  /**
   * 내보내기카드
   */
  ipcMain.handle(
    'anki:export',
    async (event, args: { ankiCardId: string; format: AnkiExportFormat; deckName?: string }) => {
      try {
        // 조회카드세트
        const ankiCard = ankiCardService.getAnkiCards(args.ankiCardId)
        if (!ankiCard) {
          return { success: false, error: '카드세트존재하지 않음' }
        }

        // 조회윈도우참조으로표시저장다이얼로그
        const mainWindow = BrowserWindow.fromWebContents(event.sender)
        if (!mainWindow) {
          return { success: false, error: '없음방법조회윈도우참조' }
        }

        // 기반으로형식내보내기
        if (args.format === 'apkg') {
          // 사용ApkgExporter내보내기
          const exporter = new ApkgExporter()
          const { buffer, summary } = await exporter.export(
            ankiCard.cardsData as any,
            args.deckName || ankiCard.title
          )

          // 표시저장다이얼로그
          const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Anki 카드 내보내기',
            defaultPath: path.join(
              app.getPath('downloads'),
              `${ankiCard.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_${ankiCard.version}.apkg`
            ),
            filters: [{ name: 'Anki Card Package', extensions: ['apkg'] }]
          })

          if (result.canceled || !result.filePath) {
            return { success: false, error: '사용자취소저장' }
          }

          // 쓰기파일（비동기，회피면차단삽입메인프로세스）
          await fs.promises.writeFile(result.filePath, buffer)
          return { success: true, filePath: result.filePath, summary }
        }

        return { success: false, error: '미지원의내보내기형식' }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * 내보내기카드에가리키는정경로
   */
  ipcMain.handle('anki:exportToPath', async (_, args: { ankiCardId: string; filePath: string }) => {
    try {
      // 조회카드세트
      const ankiCard = ankiCardService.getAnkiCards(args.ankiCardId)
      if (!ankiCard) {
        return { success: false, error: '카드세트존재하지 않음' }
      }

      // 사용ApkgExporter내보내기
      const exporter = new ApkgExporter()
      const { buffer, summary } = await exporter.export(ankiCard.cardsData as any, ankiCard.title)

      // 쓰기파일（비동기）
      await fs.promises.writeFile(args.filePath, buffer)
      return { success: true, filePath: args.filePath, summary }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  /**
   * 열기Anki윈도우
   */
  ipcMain.handle(
    'anki:open-window',
    async (_, args: { notebookId: string; ankiCardId?: string }) => {
      try {
        createAnkiWindow(args.notebookId, args.ankiCardId)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )
}
