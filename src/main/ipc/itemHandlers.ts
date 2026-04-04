import { ipcMain } from 'electron'
import { itemService } from '../services/ItemService'
import Logger from '../../shared/utils/logger'
import { z } from 'zod'
import { validate } from './validation'

/**
 * Item 관련 검증 Schema
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
 * item 관련 IPC handlers 등록
 */
export function registerItemHandlers() {
  // 노트북의 모든 items 조회
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

  // item 순서 업데이트
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

  // items 순서 일괄 업데이트
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

  // item 삭제 (선택적으로 연관 리소스 삭제)
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
