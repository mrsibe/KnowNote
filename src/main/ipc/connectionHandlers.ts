import { ipcMain, BrowserWindow } from 'electron'
import { ConnectionManager } from '../models/ConnectionManager'
import { ConnectionSchemas, validate } from './validation'
import Logger from '../../shared/utils/logger'

/**
 * 注册 Model Connection 相关的 IPC Handlers
 */
export function registerConnectionHandlers(connectionManager: ConnectionManager): void {
  const broadcastChanged = (): void => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('connections-changed')
    })
  }

  // 读取全部连接
  ipcMain.handle('get-connections', async () => {
    return await connectionManager.getConnections()
  })

  // 协议元数据
  ipcMain.handle('get-connection-protocols', async () => {
    return connectionManager.listProtocolInfos()
  })

  // 保存连接
  ipcMain.handle(
    'save-connection',
    validate(ConnectionSchemas.saveConnection, async (args) => {
      await connectionManager.saveConnection(args.capability, args.connection)
      broadcastChanged()
    })
  )

  // 删除连接
  ipcMain.handle(
    'delete-connection',
    validate(ConnectionSchemas.deleteConnection, async (args) => {
      await connectionManager.deleteConnection(args.capability)
      broadcastChanged()
    })
  )

  // 测试连接
  ipcMain.handle(
    'test-connection',
    validate(ConnectionSchemas.testConnection, async (args) => {
      return await connectionManager.testConnection(args.connection)
    })
  )

  // 拉取模型列表
  ipcMain.handle(
    'fetch-connection-models',
    validate(ConnectionSchemas.fetchModels, async (args) => {
      return await connectionManager.fetchModels(args.connection)
    })
  )

  Logger.info('ConnectionHandlers', 'Connection handlers registered')
}
