import { ConnectionManager } from '../models/ConnectionManager'
import { SessionAutoSwitchService } from '../services/SessionAutoSwitchService'
import { KnowledgeService } from '../services/KnowledgeService'
import { UpdateService } from '../services/UpdateService'
import { MindMapService } from '../services/MindMapService'
import { QuizService } from '../services/QuizService'
import { AnkiCardService } from '../services/AnkiCardService'
import { ShortcutManager } from '../services/ShortcutManager'
import type Store from 'electron-store'
import type { StoreSchema } from '../config/types'
import { registerChatHandlers } from './chatHandlers'
import { registerConnectionHandlers } from './connectionHandlers'
import { registerSettingsHandlers } from './settingsHandlers'
import { registerNotebookHandlers } from './notebookHandlers'
import { registerNoteHandlers } from './noteHandlers'
import { registerKnowledgeHandlers } from './knowledgeHandlers'
import { registerMindMapHandlers } from './mindmapHandlers'
import { registerQuizHandlers } from './quizHandlers'
import { registerAnkiHandlers } from './ankiHandlers'
import { registerUpdateHandlers } from './updateHandlers'
import { registerItemHandlers } from './itemHandlers'
import { registerShortcutHandlers } from './shortcutHandlers'
import { registerDialogHandlers } from './dialogHandlers'

/**
 * 注册所有 IPC Handlers
 */
export function registerAllHandlers(
  connectionManager: ConnectionManager,
  sessionAutoSwitchService: SessionAutoSwitchService,
  knowledgeService: KnowledgeService,
  updateService: UpdateService,
  shortcutManager: ShortcutManager,
  store: Store<StoreSchema>
) {
  // 实例化 MindMapService
  const mindMapService = new MindMapService(connectionManager)
  // 实例化 QuizService
  const quizService = new QuizService(connectionManager)
  // 实例化 AnkiCardService
  const ankiCardService = new AnkiCardService(connectionManager)

  registerChatHandlers(connectionManager, sessionAutoSwitchService, knowledgeService)
  registerConnectionHandlers(connectionManager)
  registerSettingsHandlers()
  registerDialogHandlers()
  registerNotebookHandlers()
  registerNoteHandlers(connectionManager)
  registerKnowledgeHandlers(knowledgeService)
  registerMindMapHandlers(mindMapService)
  registerQuizHandlers(quizService)
  registerAnkiHandlers(ankiCardService)
  registerUpdateHandlers(updateService)
  registerItemHandlers()
  registerShortcutHandlers(shortcutManager, store)
  console.log('[IPC] All handlers registered')
}

export {
  registerChatHandlers,
  registerConnectionHandlers,
  registerSettingsHandlers,
  registerNotebookHandlers,
  registerNoteHandlers,
  registerKnowledgeHandlers,
  registerQuizHandlers,
  registerAnkiHandlers
}
