/**
 * Anki IPC Handlers
 * Anki 카드 관련 IPC 처리
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
 * anki 관련 IPC handlers 등록
 */
export function registerAnkiHandlers(ankiCardService: AnkiCardService) {
  /**
   * 카드 생성
   */
  ipcMain.handle(
    'anki:generate',
    async (event, args: { notebookId: string; options?: AnkiGenerationOptions }) => {
      try {
        const ankiCardId = await ankiCardService.generateAnkiCards(
          args.notebookId,
          args.options,
          (stage, progress) => {
            // 진행률 업데이트 이벤트 전송
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
   * 노트북의 최신 카드 세트 조회
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
   * 지정된 카드 세트 조회
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
   * 카드 세트 업데이트
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
   * 카드 세트 삭제
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
   * 카드 내보내기
   */
  ipcMain.handle(
    'anki:export',
    async (event, args: { ankiCardId: string; format: AnkiExportFormat; deckName?: string }) => {
      try {
        // 카드 세트 조회
        const ankiCard = ankiCardService.getAnkiCards(args.ankiCardId)
        if (!ankiCard) {
          return { success: false, error: '카드 세트가 존재하지 않습니다' }
        }

        // 저장 다이얼로그 표시를 위한 윈도우 참조 조회
        const mainWindow = BrowserWindow.fromWebContents(event.sender)
        if (!mainWindow) {
          return { success: false, error: '윈도우 참조를 가져올 수 없습니다' }
        }

        // 형식에 따라 내보내기
        if (args.format === 'apkg') {
          // ApkgExporter를 사용하여 내보내기
          const exporter = new ApkgExporter()
          const { buffer, summary } = await exporter.export(
            ankiCard.cardsData as any,
            args.deckName || ankiCard.title
          )

          // 저장 다이얼로그 표시
          const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Anki 카드 내보내기',
            defaultPath: path.join(
              app.getPath('downloads'),
              `${ankiCard.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_${ankiCard.version}.apkg`
            ),
            filters: [{ name: 'Anki Card Package', extensions: ['apkg'] }]
          })

          if (result.canceled || !result.filePath) {
            return { success: false, error: '사용자가 저장을 취소했습니다' }
          }

          // 파일 쓰기 (비동기, 메인 프로세스 차단 방지)
          await fs.promises.writeFile(result.filePath, buffer)
          return { success: true, filePath: result.filePath, summary }
        }

        return { success: false, error: '지원하지 않는 내보내기 형식입니다' }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * 지정된 경로로 카드 내보내기
   */
  ipcMain.handle('anki:exportToPath', async (_, args: { ankiCardId: string; filePath: string }) => {
    try {
      // 카드 세트 조회
      const ankiCard = ankiCardService.getAnkiCards(args.ankiCardId)
      if (!ankiCard) {
        return { success: false, error: '카드 세트가 존재하지 않습니다' }
      }

      // ApkgExporter를 사용하여 내보내기
      const exporter = new ApkgExporter()
      const { buffer, summary } = await exporter.export(ankiCard.cardsData as any, ankiCard.title)

      // 파일 쓰기 (비동기)
      await fs.promises.writeFile(args.filePath, buffer)
      return { success: true, filePath: args.filePath, summary }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  /**
   * Anki 윈도우 열기
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
