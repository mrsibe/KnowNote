import { ipcMain } from 'electron'
import {
  createNotebook,
  getAllNotebooks,
  getNotebookById,
  getWorkspaceOverview,
  updateNotebook,
  deleteNotebook
} from '../db/queries'
import { NotebookSchemas, validate } from './validation'

/**
 * 注册笔记本相关的 IPC handlers
 */
export function registerNotebookHandlers() {
  // 创建笔记本（带参数验证）
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

  // 获取所有笔记本
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

  // 首页概览：笔记本 + 来源数、最近来源、最近会话，一次读完（#65）
  ipcMain.handle('get-workspace-overview', async () => {
    try {
      return getWorkspaceOverview()
    } catch (error) {
      console.error('[IPC] Error getting workspace overview:', error)
      throw error
    }
  })

  // 获取单个笔记本（带参数验证）
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

  // 更新笔记本（带参数验证）
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

  // 删除笔记本（带参数验证）
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
