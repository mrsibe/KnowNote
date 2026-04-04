import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import {
  initDatabase,
  runMigrations,
  initVectorStore,
  closeDatabase,
  executeCheckpoint
} from './db'
import { ProviderManager } from './providers/ProviderManager'
import { SessionAutoSwitchService } from './services/SessionAutoSwitchService'
import { KnowledgeService } from './services/KnowledgeService'
// import { UpdateService } from './services/UpdateService' // 온프레미스 배포: 자동 업데이트 비활성화
import { ShortcutManager } from './services/ShortcutManager'
import { createMainWindow } from './windows'
import { registerAllHandlers } from './ipc'
import { getStore } from './config/store'
import Logger from '../shared/utils/logger'

let providerManager: ProviderManager | null = null
let sessionAutoSwitchService: SessionAutoSwitchService | null = null
let knowledgeService: KnowledgeService | null = null
// let updateService: UpdateService | null = null // 온프레미스 배포: 자동 업데이트 비활성화
let shortcutManager: ShortcutManager | null = null
let isQuitting = false // Flag to indicate if app is quitting

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.knownote.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize database
  Logger.info('Main', 'Initializing database...')
  initDatabase()
  runMigrations()
  initVectorStore()
  Logger.info('Main', 'Database initialized')

  // Initialize Provider Manager
  Logger.info('Main', 'Initializing Provider Manager...')
  providerManager = new ProviderManager()
  await providerManager.initialize()
  Logger.info('Main', 'Provider Manager initialized')

  // Initialize Session Auto Switch Service
  Logger.info('Main', 'Initializing Session Auto Switch Service...')
  sessionAutoSwitchService = new SessionAutoSwitchService(providerManager)
  Logger.info('Main', 'Session Auto Switch Service initialized')

  // Initialize Knowledge Service
  Logger.info('Main', 'Initializing Knowledge Service...')
  knowledgeService = new KnowledgeService(providerManager)
  Logger.info('Main', 'Knowledge Service initialized')

  // 온프레미스 배포: 자동 업데이트 서비스 비활성화
  // Logger.info('Main', 'Initializing Update Service...')
  // updateService = new UpdateService()
  // Logger.info('Main', 'Update Service initialized')

  // Initialize electron-store
  Logger.info('Main', 'Initializing electron-store...')
  const store = await getStore()
  Logger.info('Main', 'electron-store initialized')

  // Initialize Shortcut Manager
  Logger.info('Main', 'Initializing Shortcut Manager...')
  shortcutManager = new ShortcutManager(store)
  Logger.info('Main', 'Shortcut Manager initialized')

  // 모든 IPC 핸들러 등록
  registerAllHandlers(
    providerManager,
    sessionAutoSwitchService,
    knowledgeService,
    shortcutManager,
    store
  )

  // IPC test (development only)
  if (process.env.NODE_ENV === 'development') {
    ipcMain.on('ping', () => console.log('pong'))
  }

  // Handle get platform request
  ipcMain.handle('get-platform', () => {
    return process.platform
  })

  // Handle get app version request
  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })

  // Handle open external URL request
  ipcMain.handle('open-external-url', async (_event, url: string) => {
    try {
      await shell.openExternal(url)
      return { success: true }
    } catch (error: any) {
      Logger.error('Main', 'Failed to open external URL:', error)
      return { success: false, error: error.message }
    }
  })

  // Create main window
  const mainWindow = createMainWindow()

  // 온프레미스 배포: 업데이트 서비스 메인 윈도우 설정 비활성화
  // updateService.setMainWindow(mainWindow)

  // 단축키 매니저에 메인 윈도우 설정 및 단축키 등록
  shortcutManager.setMainWindow(mainWindow)
  shortcutManager.registerShortcuts()
  Logger.info('Main', 'Shortcuts registered')

  // 온프레미스 배포: 시작 시 업데이트 확인 비활성화
  // updateService.checkForUpdatesOnStartup()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      const mainWindow = createMainWindow()
      // Re-register shortcuts for the new window
      if (shortcutManager) {
        shortcutManager.setMainWindow(mainWindow)
        shortcutManager.registerShortcuts()
        Logger.info('Main', 'Shortcuts re-registered after window re-creation')
      }
    }
  })
})

// Handle window all closed event
app.on('window-all-closed', () => {
  Logger.info('Main', 'All windows closed')

  if (process.platform === 'darwin') {
    // macOS specific: Execute checkpoint when window closes but app stays running
    Logger.debug('Main', 'macOS: Executing checkpoint on window close...')
    executeCheckpoint('PASSIVE')

    // Optional: Uncomment to also quit app when window closes on macOS
    // app.quit()
  } else {
    // Other platforms: Quit app when window closes
    app.quit()
  }
})

// First line of defense: before-quit event (user initiated quit)
app.on('before-quit', () => {
  if (isQuitting) return

  Logger.info('Main', 'before-quit event triggered')

  isQuitting = true

  // Unregister shortcuts
  if (shortcutManager) {
    shortcutManager.unregisterShortcuts()
    Logger.info('Main', 'Shortcuts unregistered')
  }

  Logger.info('Main', 'Closing database connection...')
  closeDatabase()
})

// Second line of defense: will-quit event (backup)
app.on('will-quit', () => {
  if (!isQuitting) {
    Logger.warn('Main', 'will-quit event triggered (backup)')
    closeDatabase()
  }
})

// Third line of defense: Process signal handling (forced quit, system shutdown)
const handleShutdown = (signal: string) => {
  Logger.warn('Main', `Received ${signal}, shutting down gracefully...`)

  if (!isQuitting) {
    isQuitting = true
    closeDatabase()
  }

  // Give database 2 seconds to finish closing
  setTimeout(() => {
    process.exit(0)
  }, 2000)
}

process.on('SIGINT', () => handleShutdown('SIGINT'))
process.on('SIGTERM', () => handleShutdown('SIGTERM'))
process.on('SIGHUP', () => handleShutdown('SIGHUP'))

// Uncaught exception handling
process.on('uncaughtException', (error) => {
  Logger.error('Main', 'Uncaught exception:', error)
  closeDatabase()
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  Logger.error('Main', 'Unhandled rejection:', reason)
})
