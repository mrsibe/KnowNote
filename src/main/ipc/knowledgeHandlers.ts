/**
 * Knowledge IPC Handlers
 * 지식 베이스관련의 IPC 처리함수
 */

import { ipcMain, IpcMainInvokeEvent, dialog, shell } from 'electron'
import { KnowledgeService } from '../services/KnowledgeService'
import Logger from '../../shared/utils/logger'
import { KnowledgeSchemas, validate } from './validation'

/**
 * 등록지식 베이스관련 IPC Handlers
 */
export function registerKnowledgeHandlers(knowledgeService: KnowledgeService) {
  // 문서 추가（텍스트내용）
  ipcMain.handle('knowledge:add-document', async (event: IpcMainInvokeEvent, args: unknown) => {
    const validated = await validate(KnowledgeSchemas.addDocument, async (params) => {
      Logger.debug('KnowledgeHandlers', 'add-document:', {
        notebookId: params.notebookId,
        title: params.options.title
      })

      try {
        const documentId = await knowledgeService.addDocument(
          params.notebookId,
          params.options,
          (stage, progress) => {
            // 전송진행업데이트
            event.sender.send('knowledge:index-progress', {
              notebookId: params.notebookId,
              stage,
              progress
            })
          }
        )
        return { success: true, documentId }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error adding document:', error)
        return { success: false, error: (error as Error).message }
      }
    })(event, args)

    return validated
  })

  // 에서파일문서 추가
  ipcMain.handle(
    'knowledge:add-document-from-file',
    async (event: IpcMainInvokeEvent, args: unknown) => {
      const validated = await validate(KnowledgeSchemas.addDocumentFromFile, async (params) => {
        Logger.debug('KnowledgeHandlers', 'add-document-from-file:', params)

        try {
          const documentId = await knowledgeService.addDocumentFromFile(
            params.notebookId,
            params.filePath,
            (stage, progress) => {
              event.sender.send('knowledge:index-progress', {
                notebookId: params.notebookId,
                stage,
                progress
              })
            }
          )
          return { success: true, documentId }
        } catch (error) {
          Logger.error('KnowledgeHandlers', 'Error adding document from file:', error)
          return { success: false, error: (error as Error).message }
        }
      })(event, args)

      return validated
    }
  )

  // 에서 URL 문서 추가
  ipcMain.handle(
    'knowledge:add-document-from-url',
    async (event: IpcMainInvokeEvent, args: unknown) => {
      const validated = await validate(KnowledgeSchemas.addDocumentFromUrl, async (params) => {
        Logger.debug('KnowledgeHandlers', 'add-document-from-url:', params)

        try {
          const documentId = await knowledgeService.addDocumentFromUrl(
            params.notebookId,
            params.url,
            (stage, progress) => {
              event.sender.send('knowledge:index-progress', {
                notebookId: params.notebookId,
                stage,
                progress
              })
            }
          )
          return { success: true, documentId }
        } catch (error) {
          Logger.error('KnowledgeHandlers', 'Error adding document from URL:', error)
          return { success: false, error: (error as Error).message }
        }
      })(event, args)

      return validated
    }
  )

  // 에서 Note 추가에지식 베이스
  ipcMain.handle('knowledge:add-note', async (event: IpcMainInvokeEvent, args: unknown) => {
    const validated = await validate(KnowledgeSchemas.addNote, async (params) => {
      Logger.debug('KnowledgeHandlers', 'add-note:', params)

      try {
        const documentId = await knowledgeService.addNoteToKnowledge(
          params.notebookId,
          params.noteId,
          (stage, progress) => {
            event.sender.send('knowledge:index-progress', {
              notebookId: params.notebookId,
              stage,
              progress
            })
          }
        )
        return { success: true, documentId }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error adding note:', error)
        return { success: false, error: (error as Error).message }
      }
    })(event, args)

    return validated
  })

  // 지식 베이스 검색
  ipcMain.handle(
    'knowledge:search',
    validate(KnowledgeSchemas.search, async (params) => {
      Logger.debug('KnowledgeHandlers', 'search:', params)

      try {
        const results = await knowledgeService.search(
          params.notebookId,
          params.query,
          params.options
        )
        return { success: true, results }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error searching:', error)
        return { success: false, error: (error as Error).message, results: [] }
      }
    })
  )

  // 문서 조회목록
  ipcMain.handle(
    'knowledge:get-documents',
    validate(KnowledgeSchemas.getDocuments, async (params) => {
      Logger.debug('KnowledgeHandlers', 'get-documents:', params.notebookId)

      try {
        const docs = knowledgeService.getDocuments(params.notebookId)
        return docs
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error getting documents:', error)
        return []
      }
    })
  )

  // 조회단일개문서
  ipcMain.handle(
    'knowledge:get-document',
    validate(KnowledgeSchemas.getDocument, async (params) => {
      Logger.debug('KnowledgeHandlers', 'get-document:', params.documentId)

      try {
        const doc = knowledgeService.getDocument(params.documentId)
        return doc || null
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error getting document:', error)
        return null
      }
    })
  )

  // 문서 조회의 chunks
  ipcMain.handle(
    'knowledge:get-document-chunks',
    validate(KnowledgeSchemas.getDocumentChunks, async (params) => {
      Logger.debug('KnowledgeHandlers', 'get-document-chunks:', params.documentId)

      try {
        const chunks = knowledgeService.getDocumentChunks(params.documentId)
        return chunks
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error getting document chunks:', error)
        return []
      }
    })
  )

  // 문서 삭제
  ipcMain.handle(
    'knowledge:delete-document',
    validate(KnowledgeSchemas.deleteDocument, async (params) => {
      Logger.debug('KnowledgeHandlers', 'delete-document:', params.documentId)

      try {
        await knowledgeService.deleteDocument(params.documentId)
        return { success: true }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error deleting document:', error)
        return { success: false, error: (error as Error).message }
      }
    })
  )

  // 재빌드인덱스
  ipcMain.handle('knowledge:reindex-document', async (event: IpcMainInvokeEvent, args: unknown) => {
    const validated = await validate(KnowledgeSchemas.reindexDocument, async (params) => {
      Logger.debug('KnowledgeHandlers', 'reindex-document:', params.documentId)

      try {
        await knowledgeService.reindexDocument(params.documentId, (stage, progress) => {
          event.sender.send('knowledge:index-progress', {
            documentId: params.documentId,
            stage,
            progress
          })
        })
        return { success: true }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error reindexing document:', error)
        return { success: false, error: (error as Error).message }
      }
    })(event, args)

    return validated
  })

  // 지식 베이스 통계 정보 조회
  ipcMain.handle(
    'knowledge:get-stats',
    validate(KnowledgeSchemas.getStats, async (params) => {
      Logger.debug('KnowledgeHandlers', 'get-stats:', params.notebookId)

      try {
        const stats = knowledgeService.getStats(params.notebookId)
        return stats
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error getting stats:', error)
        return { documentCount: 0, chunkCount: 0, embeddingCount: 0 }
      }
    })
  )

  // 파일 선택 다이얼로그 열기
  ipcMain.handle('knowledge:select-files', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'txt', 'md'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Word', extensions: ['docx', 'doc'] },
        { name: 'Text', extensions: ['txt', 'md'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    return result.canceled ? [] : result.filePaths
  })

  // 열기문서소스파일
  ipcMain.handle(
    'knowledge:open-source',
    validate(KnowledgeSchemas.openSource, async (params) => {
      Logger.debug('KnowledgeHandlers', 'open-source:', params.documentId)

      try {
        const doc = knowledgeService.getDocument(params.documentId)
        if (!doc) {
          return { success: false, error: 'Document not found' }
        }

        // 기반으로문서타입처리
        if (doc.type === 'url' && doc.sourceUri) {
          // 열기 URL
          await shell.openExternal(doc.sourceUri)
        } else if (doc.type === 'file') {
          // 우선사용로컬복사베이스의파일，만약존재하지 않음사용소스파일
          const filePathToOpen = doc.localFilePath || doc.sourceUri
          if (filePathToOpen) {
            await shell.openPath(filePathToOpen)
          } else {
            return { success: false, error: 'No file path available' }
          }
        }

        return { success: true }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error opening source:', error)
        return { success: false, error: (error as Error).message }
      }
    })
  )

  Logger.info('KnowledgeHandlers', 'Knowledge handlers registered')
}
