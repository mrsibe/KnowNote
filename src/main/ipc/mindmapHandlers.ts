/**
 * MindMap IPC Handlers
 * 마인드맵관련의 IPC 처리함수
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { MindMapService } from '../services/MindMapService'
import { createMindMapWindow } from '../windows/mindMapWindow'
import Logger from '../../shared/utils/logger'

/**
 * 등록마인드맵관련 IPC Handlers
 */
export function registerMindMapHandlers(mindMapService: MindMapService) {
  // 마인드맵 생성
  ipcMain.handle(
    'mindmap:generate',
    async (event: IpcMainInvokeEvent, args: { notebookId: string }) => {
      try {
        Logger.debug('MindMapHandlers', 'generate:', args)

        const mindMapId = await mindMapService.generateMindMap(
          args.notebookId,
          (stage, progress) => {
            // 전송진행업데이트（확인윈도우예아니오아직존재）
            if (!event.sender.isDestroyed()) {
              event.sender.send('mindmap:progress', {
                notebookId: args.notebookId,
                stage,
                progress
              })
            }
          }
        )

        return { success: true, mindMapId }
      } catch (error) {
        Logger.error('MindMapHandlers', 'Error generating mind map:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  // 조회최신마인드맵
  ipcMain.handle('mindmap:get-latest', async (_, args: { notebookId: string }) => {
    try {
      Logger.debug('MindMapHandlers', 'get-latest:', args)
      const mindMap = mindMapService.getLatestMindMap(args.notebookId)
      return mindMap || null
    } catch (error) {
      Logger.error('MindMapHandlers', 'Error getting latest mind map:', error)
      return null
    }
  })

  // 마인드맵 조회상세
  ipcMain.handle('mindmap:get', async (_, args: { mindMapId: string }) => {
    try {
      Logger.debug('MindMapHandlers', 'get:', args)
      const mindMap = mindMapService.getMindMap(args.mindMapId)
      return mindMap || null
    } catch (error) {
      Logger.error('MindMapHandlers', 'Error getting mind map:', error)
      return null
    }
  })

  // 조회노드연관된chunks
  ipcMain.handle(
    'mindmap:get-node-chunks',
    async (_, args: { mindMapId: string; nodeId: string }) => {
      try {
        Logger.debug('MindMapHandlers', 'get-node-chunks:', args)
        const chunks = await mindMapService.getNodeChunks(args.mindMapId, args.nodeId)
        return chunks
      } catch (error) {
        Logger.error('MindMapHandlers', 'Error getting node chunks:', error)
        return []
      }
    }
  )

  // 업데이트마인드맵
  ipcMain.handle(
    'mindmap:update',
    async (_, args: { mindMapId: string; updates: Partial<{ title: string }> }) => {
      try {
        Logger.debug('MindMapHandlers', 'update:', args)
        mindMapService.updateMindMap(args.mindMapId, args.updates)
        return { success: true }
      } catch (error) {
        Logger.error('MindMapHandlers', 'Error updating mind map:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  // 마인드맵 삭제
  ipcMain.handle('mindmap:delete', async (_, args: { mindMapId: string }) => {
    try {
      Logger.debug('MindMapHandlers', 'delete:', args)
      mindMapService.deleteMindMap(args.mindMapId)
      return { success: true }
    } catch (error) {
      Logger.error('MindMapHandlers', 'Error deleting mind map:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // 열기마인드맵윈도우
  ipcMain.handle(
    'mindmap:open-window',
    async (_, args: { notebookId: string; mindMapId?: string }) => {
      try {
        Logger.debug('MindMapHandlers', 'open-window:', args)
        createMindMapWindow(args.notebookId, args.mindMapId)
        return { success: true }
      } catch (error) {
        Logger.error('MindMapHandlers', 'Error opening mind map window:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  Logger.info('MindMapHandlers', 'Mind map handlers registered')
}
