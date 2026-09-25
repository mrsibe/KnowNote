import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import {
  initDatabase,
  runMigrations,
  initVectorStore,
  closeDatabase,
  executeCheckpoint
} from './db'
import { ConnectionManager } from './models/ConnectionManager'
import { EmbeddingService } from './services/EmbeddingService'
import { SessionAutoSwitchService } from './services/SessionAutoSwitchService'
import { KnowledgeService } from './services/KnowledgeService'
import { UpdateService } from './services/UpdateService'
import { ShortcutManager } from './services/ShortcutManager'
import { createMainWindow } from './windows'
import { registerAllHandlers } from './ipc'
import { broadcastProgress as broadcastEmbeddingProgress } from './ipc/embeddingHandlers'
import { getStore } from './config/store'
import { migrateProvidersToConnections } from './config/connectionMigration'
import { isSmokeTestRequested, runSmokeTest } from './smokeTest'
import { isEvalRequested, runEvalCli } from './eval/run'
import {
  registerDocumentProtocolHandler,
  registerDocumentScheme
} from './protocol/documentProtocol'
import {
  registerPdfjsAssetProtocolHandler,
  registerPdfjsAssetScheme
} from './protocol/pdfjsAssetProtocol'
import Logger from '../shared/utils/logger'

// Scheme privileges must be registered before the app is ready, so this is a
// module-scope call rather than part of the whenReady sequence.
registerDocumentScheme()
registerPdfjsAssetScheme()

let connectionManager: ConnectionManager | null = null
let embeddingService: EmbeddingService | null = null
let sessionAutoSwitchService: SessionAutoSwitchService | null = null
let knowledgeService: KnowledgeService | null = null
let updateService: UpdateService | null = null
let shortcutManager: ShortcutManager | null = null
let isQuitting = false // Flag to indicate if app is quitting

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Packaged-app smoke test (see src/main/smokeTest.ts). Runs before any window
  // is created and exits with the result, so CI can gate on it.
  if (isSmokeTestRequested()) {
    const code = await runSmokeTest()
    // app.exit() does not wait for stdout to drain, and CI reads this output.
    await new Promise<void>((resolve) => process.stdout.write('', () => resolve()))
    app.exit(code)
    return
  }

  // RAG eval harness (#75). Like the smoke test it runs before any window is
  // created and exits with the result.
  if (isEvalRequested()) {
    const code = await runEvalCli()
    await new Promise<void>((resolve) => process.stdout.write('', () => resolve()))
    app.exit(code)
    return
  }

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
  // The resolver is lazy on purpose: `knowledgeService` is constructed further down, and
  // the protocol only ever answers requests from a renderer that loads after startup.
  // Reading it per request keeps the dependency direction protocol → Document layer →
  // database without reordering startup (#60).
  registerDocumentProtocolHandler(
    (documentId) => knowledgeService?.getDocumentLocalFilePath(documentId) ?? null
  )
  // PDF.js 的 CMap / 标准字体 / wasm 资源。它不依赖任何服务初始化顺序，只是把
  // resources/pdfjs 暴露给渲染进程。
  registerPdfjsAssetProtocolHandler()
  Logger.info('Main', 'Database initialized')

  // Initialize electron-store
  Logger.info('Main', 'Initializing electron-store...')
  const store = await getStore()
  Logger.info('Main', 'electron-store initialized')

  // One-time migration: legacy Provider config -> Model Connections
  await migrateProvidersToConnections(store)

  // Initialize Connection Manager
  Logger.info('Main', 'Initializing Connection Manager...')
  connectionManager = new ConnectionManager()
  Logger.info('Main', 'Connection Manager initialized')

  // Initialize Session Auto Switch Service
  Logger.info('Main', 'Initializing Session Auto Switch Service...')
  sessionAutoSwitchService = new SessionAutoSwitchService(connectionManager)
  Logger.info('Main', 'Session Auto Switch Service initialized')

  // Initialize Embedding Service (local model management + remote fallback)
  Logger.info('Main', 'Initializing Embedding Service...')
  embeddingService = new EmbeddingService(connectionManager, {
    cacheDir: join(app.getPath('userData'), 'models'),
    onDownloadProgress: broadcastEmbeddingProgress
  })
  Logger.info('Main', 'Embedding Service initialized')

  // Initialize Knowledge Service
  Logger.info('Main', 'Initializing Knowledge Service...')
  knowledgeService = new KnowledgeService(embeddingService)
  Logger.info('Main', 'Knowledge Service initialized')

  // Initialize Update Service
  Logger.info('Main', 'Initializing Update Service...')
  updateService = new UpdateService()
  Logger.info('Main', 'Update Service initialized')

  // Initialize Shortcut Manager
  Logger.info('Main', 'Initializing Shortcut Manager...')
  shortcutManager = new ShortcutManager(store)
  Logger.info('Main', 'Shortcut Manager initialized')

  // Register all IPC Handlers
  registerAllHandlers(
    connectionManager,
    sessionAutoSwitchService,
    knowledgeService,
    embeddingService,
    updateService,
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

  // Set main window for update service
  updateService.setMainWindow(mainWindow)

  // Set main window for shortcut manager and register shortcuts
  shortcutManager.setMainWindow(mainWindow)
  shortcutManager.registerShortcuts()
  Logger.info('Main', 'Shortcuts registered')

  // Check for updates on startup (after 5 seconds)
  updateService.checkForUpdatesOnStartup()

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
