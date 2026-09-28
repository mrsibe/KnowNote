/**
 * Knowledge IPC Handlers
 * 知识库相关的 IPC 处理函数
 */

import { ipcMain, IpcMainInvokeEvent, dialog, shell } from 'electron'
import { KnowledgeService } from '../services/KnowledgeService'
import Logger from '../../shared/utils/logger'
import { KnowledgeSchemas, validate } from './validation'

/**
 * 注册知识库相关 IPC Handlers
 */
export function registerKnowledgeHandlers(knowledgeService: KnowledgeService) {
  // 添加文档（文本内容）
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
            // 发送进度更新
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

  // 从文件添加文档
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

  // 从 URL 添加文档
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

  // 从 Note 添加到知识库
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

  // 搜索知识库
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

  // 字面搜索（#96）：BM25，与语义搜索分开返回，UI 不融合两者。
  ipcMain.handle(
    'knowledge:search-text',
    validate(KnowledgeSchemas.searchText, async (params) => {
      Logger.debug('KnowledgeHandlers', 'search-text:', params)

      try {
        const results = await knowledgeService.searchText(
          params.notebookId,
          params.query,
          params.options ?? {}
        )
        return { success: true, results }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error searching text:', error)
        return { success: false, error: (error as Error).message, results: [] }
      }
    })
  )

  // 获取文档列表
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

  // 获取单个文档
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

  // 获取文档的 chunks
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

  // 获取文档的结构块（#71）。Reader 需要页码与 bbox 才能把引用落点高亮。
  ipcMain.handle(
    'knowledge:get-document-blocks',
    validate(KnowledgeSchemas.getDocumentBlocks, async (params) => {
      Logger.debug('KnowledgeHandlers', 'get-document-blocks:', params.documentId)

      try {
        return knowledgeService.getDocumentBlocks(params.documentId)
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error getting document blocks:', error)
        return []
      }
    })
  )

  // 删除文档
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

  // 重建索引
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

  // 重试一份失败的 source（#95）：已解析过的从分块重来，解析前的重新解析本地副本。
  ipcMain.handle('knowledge:retry-document', async (event: IpcMainInvokeEvent, args: unknown) => {
    const validated = await validate(KnowledgeSchemas.retryDocument, async (params) => {
      Logger.debug('KnowledgeHandlers', 'retry-document:', params.documentId)

      try {
        await knowledgeService.retryDocument(params.documentId, (stage, progress) => {
          event.sender.send('knowledge:index-progress', {
            documentId: params.documentId,
            stage,
            progress
          })
        })
        return { success: true }
      } catch (error) {
        Logger.error('KnowledgeHandlers', 'Error retrying document:', error)
        return { success: false, error: (error as Error).message }
      }
    })(event, args)

    return validated
  })

  // 获取知识库统计信息
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

  // 打开文件选择对话框
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

  // 打开文件夹选择对话框（#98）
  ipcMain.handle('knowledge:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections']
    })

    return result.canceled ? [] : result.filePaths
  })

  // 文件夹导入：一次快照（#98）
  ipcMain.handle(
    'knowledge:add-folder',
    async (event: IpcMainInvokeEvent, args: unknown) => {
      const validated = await validate(KnowledgeSchemas.addFolder, async (params) => {
        Logger.debug('KnowledgeHandlers', 'add-folder:', params)

        try {
          const result = await knowledgeService.addFolder(
            params.notebookId,
            params.folderPath,
            (stage, progress) => {
              event.sender.send('knowledge:index-progress', {
                notebookId: params.notebookId,
                stage,
                progress
              })
            }
          )
          return { success: true, ...result }
        } catch (error) {
          Logger.error('KnowledgeHandlers', 'Error adding folder:', error)
          return { success: false, added: [], skipped: [], failed: [], error: (error as Error).message }
        }
      })(event, args)

      return validated
    }
  )

  // 批量导入一组文件（#98，拖放/多选共用）
  ipcMain.handle(
    'knowledge:add-files',
    async (event: IpcMainInvokeEvent, args: unknown) => {
      const validated = await validate(KnowledgeSchemas.addFiles, async (params) => {
        Logger.debug('KnowledgeHandlers', 'add-files:', params.paths.length)

        try {
          const result = await knowledgeService.addDocumentsFromPaths(
            params.notebookId,
            params.paths,
            (stage, progress) => {
              event.sender.send('knowledge:index-progress', {
                notebookId: params.notebookId,
                stage,
                progress
              })
            }
          )
          return { success: true, ...result }
        } catch (error) {
          Logger.error('KnowledgeHandlers', 'Error adding files:', error)
          return { success: false, added: [], skipped: [], failed: [], error: (error as Error).message }
        }
      })(event, args)

      return validated
    }
  )

  // 打开文档源文件
  ipcMain.handle(
    'knowledge:open-source',
    validate(KnowledgeSchemas.openSource, async (params) => {
      Logger.debug('KnowledgeHandlers', 'open-source:', params.documentId)

      try {
        const doc = knowledgeService.getDocument(params.documentId)
        if (!doc) {
          return { success: false, error: 'Document not found' }
        }

        // 根据文档类型处理
        if (doc.type === 'url' && doc.sourceUri) {
          // 打开 URL
          await shell.openExternal(doc.sourceUri)
        } else if (doc.type === 'file') {
          // 优先使用本地拷贝的文件，如果不存在则使用源文件
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
