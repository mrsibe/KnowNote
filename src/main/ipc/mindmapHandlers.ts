/**
 * MindMap IPC Handlers
 * 마인드맵 관련 IPC 처리 함수
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { MindMapService } from '../services/MindMapService'
import { createMindMapWindow } from '../windows/mindMapWindow'
import Logger from '../../shared/utils/logger'

/**
 * 마인드맵 관련 IPC Handlers 등록
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
            // 진행률 업데이트 전송 (윈도우 존재 여부 확인)
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

  // 최신 마인드맵 조회
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

  // 마인드맵 상세 조회
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

  // 노드 연관 chunks 조회
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

  // 마인드맵 업데이트
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

  // 마인드맵 윈도우 열기
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
