import { ipcMain } from 'electron'
import {
  createNotebook,
  getAllNotebooks,
  getNotebookById,
  updateNotebook,
  deleteNotebook
} from '../db/queries'
import { NotebookSchemas, validate } from './validation'

/**
 * 노트북 관련 IPC handlers 등록
 */
export function registerNotebookHandlers() {
  // 노트북 생성 (매개변수 검증 포함)
  ipcMain.handle(
    'create-notebook',
    validate(NotebookSchemas.createNotebook, async (args) => {
      console.log('[IPC] create-notebook:', args)
      try {
        const notebook = createNotebook(args.title, args.description)
        console.log('[IPC] Notebook created successfully:', notebook.id)
        return notebook
      } catch (error) {
        console.error('[IPC] Error creating notebook:', error)
        throw error
      }
    })
  )

  // 모든 노트북 조회
  ipcMain.handle('get-all-notebooks', async () => {
    console.log('[IPC] get-all-notebooks')
    try {
      const notebooks = getAllNotebooks()
      console.log(`[IPC] Retrieved ${notebooks.length} notebooks`)
      return notebooks
    } catch (error) {
      console.error('[IPC] Error getting notebooks:', error)
      throw error
    }
  })

  // 단일 노트북 조회 (매개변수 검증 포함)
  ipcMain.handle(
    'get-notebook',
    validate(NotebookSchemas.getNotebook, async (args) => {
      console.log('[IPC] get-notebook:', args.id)
      try {
        const notebook = getNotebookById(args.id)
        if (!notebook) {
          console.warn(`[IPC] Notebook not found: ${args.id}`)
        }
        return notebook
      } catch (error) {
        console.error('[IPC] Error getting notebook:', error)
        throw error
      }
    })
  )

  // 노트북 업데이트 (매개변수 검증 포함)
  ipcMain.handle(
    'update-notebook',
    validate(NotebookSchemas.updateNotebook, async (args) => {
      console.log('[IPC] update-notebook:', args)
      try {
        updateNotebook(args.id, args.updates)
        console.log('[IPC] Notebook updated successfully:', args.id)
        return { success: true }
      } catch (error) {
        console.error('[IPC] Error updating notebook:', error)
        throw error
      }
    })
  )

  // 노트북 삭제 (매개변수 검증 포함)
  ipcMain.handle(
    'delete-notebook',
    validate(NotebookSchemas.deleteNotebook, async (args) => {
      console.log('[IPC] delete-notebook:', args.id)
      try {
        await deleteNotebook(args.id)
        console.log('[IPC] Notebook deleted successfully:', args.id)
        return { success: true }
      } catch (error) {
        console.error('[IPC] Error deleting notebook:', error)
        throw error
      }
    })
  )
}
