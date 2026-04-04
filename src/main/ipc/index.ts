import { ProviderManager } from '../providers/ProviderManager'
import { SessionAutoSwitchService } from '../services/SessionAutoSwitchService'
import { KnowledgeService } from '../services/KnowledgeService'
import { MindMapService } from '../services/MindMapService'
import { QuizService } from '../services/QuizService'
import { AnkiCardService } from '../services/AnkiCardService'
import { ShortcutManager } from '../services/ShortcutManager'
import type Store from 'electron-store'
import type { StoreSchema } from '../config/types'
import { registerChatHandlers } from './chatHandlers'
import { registerProviderHandlers } from './providerHandlers'
import { registerSettingsHandlers } from './settingsHandlers'
import { registerNotebookHandlers } from './notebookHandlers'
import { registerNoteHandlers } from './noteHandlers'
import { registerKnowledgeHandlers } from './knowledgeHandlers'
import { registerMindMapHandlers } from './mindmapHandlers'
import { registerQuizHandlers } from './quizHandlers'
import { registerAnkiHandlers } from './ankiHandlers'
import { registerItemHandlers } from './itemHandlers'
import { registerShortcutHandlers } from './shortcutHandlers'
import { registerDialogHandlers } from './dialogHandlers'

/**
 * 모든 IPC 핸들러 등록
 */
export function registerAllHandlers(
  providerManager: ProviderManager,
  sessionAutoSwitchService: SessionAutoSwitchService,
  knowledgeService: KnowledgeService,
  shortcutManager: ShortcutManager,
  store: Store<StoreSchema>
) {
  // MindMapService 인스턴스 생성
  const mindMapService = new MindMapService(providerManager)
  // QuizService 인스턴스 생성
  const quizService = new QuizService(providerManager)
  // AnkiCardService 인스턴스 생성
  const ankiCardService = new AnkiCardService(providerManager)

  registerChatHandlers(providerManager, sessionAutoSwitchService, knowledgeService)
  registerProviderHandlers(providerManager)
  registerSettingsHandlers()
  registerDialogHandlers()
  registerNotebookHandlers()
  registerNoteHandlers(providerManager)
  registerKnowledgeHandlers(knowledgeService)
  registerMindMapHandlers(mindMapService)
  registerQuizHandlers(quizService)
  registerAnkiHandlers(ankiCardService)
  registerItemHandlers()
  registerShortcutHandlers(shortcutManager, store)
  console.log('[IPC] All handlers registered')
}

export {
  registerChatHandlers,
  registerProviderHandlers,
  registerSettingsHandlers,
  registerNotebookHandlers,
  registerNoteHandlers,
  registerKnowledgeHandlers,
  registerQuizHandlers,
  registerAnkiHandlers
}
