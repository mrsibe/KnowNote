import { ipcMain } from 'electron'
import { itemService } from '../services/ItemService'
import Logger from '../../shared/utils/logger'
import { z } from 'zod'
import { validate } from './validation'

/**
 * Item 관련검증 Schema
 */
const ItemSchemas = {
  getItems: z.object({
    notebookId: z.string()
  }),
  updateOrder: z.object({
    itemId: z.string(),
    order: z.number()
  }),
  batchUpdateOrder: z.object({
    updates: z.record(z.string(), z.number())
  }),
  deleteItem: z.object({
    itemId: z.string(),
    deleteResource: z.boolean().optional()
  })
}

/**
 * 등록 item 관련 IPC handlers
 */
export function registerItemHandlers() {
  // 노트북 조회아래의모든 items
  ipcMain.handle(
    'items:get',
    validate(ItemSchemas.getItems, async (args) => {
      Logger.debug('ItemHandlers', 'items:get:', args.notebookId)
      try {
        const items = await itemService.getItemsByNotebook(args.notebookId)
        Logger.debug('ItemHandlers', `Retrieved ${items.length} items`)
        return items
      } catch (error) {
        Logger.error('ItemHandlers', 'Error getting items:', error)
        throw error
      }
    })
  )

  // 업데이트 item 순서순서
  ipcMain.handle(
    'items:update-order',
    validate(ItemSchemas.updateOrder, async (args) => {
      Logger.debug('ItemHandlers', 'items:update-order:', args)
      try {
        await itemService.updateItemOrder(args.itemId, args.order)
        return { success: true }
      } catch (error) {
        Logger.error('ItemHandlers', 'Error updating item order:', error)
        throw error
      }
    })
  )

  // 일괄업데이트 items 순서순서
  ipcMain.handle(
    'items:batch-update-order',
    validate(ItemSchemas.batchUpdateOrder, async (args) => {
      Logger.debug('ItemHandlers', 'items:batch-update-order:', {
        count: Object.keys(args.updates).length
      })
      try {
        await itemService.batchUpdateOrder(args.updates)
        return { success: true }
      } catch (error) {
        Logger.error('ItemHandlers', 'Error batch updating order:', error)
        throw error
      }
    })
  )

  // 삭제 item（선택삭제닫기연리소스）
  ipcMain.handle(
    'items:delete',
    validate(ItemSchemas.deleteItem, async (args) => {
      Logger.debug('ItemHandlers', 'items:delete:', args)
      try {
        if (args.deleteResource) {
          await itemService.deleteItemWithResource(args.itemId)
        } else {
          await itemService.deleteItem(args.itemId)
        }
        return { success: true }
      } catch (error) {
        Logger.error('ItemHandlers', 'Error deleting item:', error)
        throw error
      }
    })
  )
}
