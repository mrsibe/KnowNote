import { ElectronAPI } from '@electron-toolkit/preload'
import type { ChatSession, ChatMessage } from '../shared/types/chat'
import type {
  Notebook,
  Note,
  AppSettings,
  ConnectionMap,
  ConnectionTestResult,
  ModelCapability,
  ModelConnection
} from '../shared/types'
import type {
  KnowledgeDocument,
  KnowledgeChunk,
  KnowledgeSearchResult,
  KnowledgeStats,
  AddDocumentOptions,
  SearchOptions,
  IndexProgress
} from '../shared/types/knowledge'
import type { UpdateState, UpdateCheckResult, UpdateOperationResult } from '../shared/types/update'
import type { MindMap, Quiz, QuizSession, AnkiCard } from '../main/db/schema'

// 重新导出共享类型
export type {
  ChatSession,
  ChatMessage,
  Notebook,
  Note,
  AppSettings,
  ConnectionMap,
  ConnectionTestResult,
  ModelCapability,
  ModelConnection,
  MindMap,
  Quiz,
  QuizSession,
  AnkiCard
}
export type {
  KnowledgeDocument,
  KnowledgeChunk,
  KnowledgeSearchResult,
  KnowledgeStats,
  AddDocumentOptions,
  SearchOptions,
  IndexProgress
}
export type { UpdateState, UpdateCheckResult, UpdateOperationResult }

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      // 获取平台信息
      getPlatform: () => Promise<string>

      // 获取应用版本号
      getAppVersion: () => Promise<string>

      // 在默认浏览器中打开外部链接
      openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>

      // 系统对话框相关
      dialog: {
        saveFile: (options: {
          title?: string
          defaultPath?: string
          filters?: { name: string; extensions: string[] }[]
        }) => Promise<string | null>
      }

      // 应用设置相关
      settings: {
        getAll: () => Promise<AppSettings>
        get: <K extends keyof AppSettings>(key: K) => Promise<AppSettings[K]>
        update: (updates: Partial<AppSettings>) => Promise<AppSettings>
        set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<AppSettings[K]>
        reset: () => Promise<AppSettings>
        getDefaultPrompts: () => Promise<AppSettings['prompts']>
        onSettingsChange: (
          callback: (newSettings: AppSettings, oldSettings: AppSettings) => void
        ) => () => void
      }

      // Notebook 相关
      createNotebook: (title: string, description?: string) => Promise<Notebook>
      getAllNotebooks: () => Promise<Notebook[]>
      getNotebook: (id: string) => Promise<Notebook | null>
      updateNotebook: (
        id: string,
        updates: Partial<Pick<Notebook, 'title' | 'description'>>
      ) => Promise<void>
      deleteNotebook: (id: string) => Promise<void>

      // Note 相关
      createNote: (notebookId: string, content: string, customTitle?: string) => Promise<Note>
      getNotes: (notebookId: string) => Promise<Note[]>
      getNote: (id: string) => Promise<Note | null>
      updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content'>>) => Promise<void>
      deleteNote: (id: string) => Promise<void>

      // Items 相关（统一管理笔记、思维导图等）
      items: {
        getAll: (notebookId: string) => Promise<any[]>
        updateOrder: (itemId: string, order: number) => Promise<{ success: boolean }>
        batchUpdateOrder: (updates: Record<string, number>) => Promise<{ success: boolean }>
        delete: (itemId: string, deleteResource?: boolean) => Promise<{ success: boolean }>
      }

      // Mind Map 相关
      mindmap: {
        getLatest: (notebookId: string) => Promise<MindMap | null>
        get: (mindMapId: string) => Promise<MindMap | null>
        generate: (
          notebookId: string
        ) => Promise<{ success: boolean; mindMapId?: string; error?: string }>
        getNodeChunks: (mindMapId: string, nodeId: string) => Promise<any[]>
        update: (
          mindMapId: string,
          updates: Partial<Pick<MindMap, 'title'>>
        ) => Promise<{ success: boolean }>
        delete: (mindMapId: string) => Promise<{ success: boolean }>
        openWindow: (notebookId: string, mindMapId?: string) => Promise<void>
        onProgress: (
          callback: (data: { notebookId: string; stage: string; progress: number }) => void
        ) => () => void
      }

      // Quiz 相关
      quiz: {
        getLatest: (notebookId: string) => Promise<Quiz | null>
        get: (quizId: string) => Promise<Quiz | null>
        generate: (
          notebookId: string,
          options?: {
            questionCount?: number
            difficulty?: 'easy' | 'medium' | 'hard'
            customPrompt?: string
          }
        ) => Promise<{ success: boolean; quizId?: string; error?: string }>
        submitSession: (
          quizId: string,
          answers: Record<string, number>
        ) => Promise<{ success: boolean; sessionId?: string }>
        getSession: (sessionId: string) => Promise<QuizSession | null>
        update: (quizId: string, updates: { title?: string }) => Promise<{ success: boolean }>
        delete: (quizId: string) => Promise<{ success: boolean }>
        openWindow: (notebookId: string, quizId?: string) => Promise<{ success: boolean }>
        onProgress: (
          callback: (data: { notebookId: string; stage: string; progress: number }) => void
        ) => () => void
      }

      // Anki 卡片相关
      anki: {
        getLatest: (notebookId: string) => Promise<AnkiCard | null>
        get: (ankiCardId: string) => Promise<AnkiCard | null>
        generate: (
          notebookId: string,
          options?: {
            cardCount?: number
            cardTypes?: ('basic' | 'cloze' | 'fill-blank')[]
            difficulty?: 'easy' | 'medium' | 'hard'
            customPrompt?: string
          }
        ) => Promise<{ success: boolean; ankiCardId?: string; error?: string }>
        update: (ankiCardId: string, updates: { title?: string }) => Promise<{ success: boolean }>
        delete: (ankiCardId: string) => Promise<{ success: boolean }>
        export: (
          ankiCardId: string,
          format: 'apkg',
          deckName?: string
        ) => Promise<{ success: boolean; filePath?: string; error?: string }>
        exportToPath: (
          ankiCardId: string,
          filePath: string
        ) => Promise<{ success: boolean; filePath?: string; error?: string }>
        openWindow: (notebookId: string, ankiCardId?: string) => Promise<{ success: boolean }>
        onProgress: (
          callback: (data: { notebookId: string; stage: string; progress: number }) => void
        ) => () => void
      }

      // Chat Session 相关
      createChatSession: (notebookId: string, title: string) => Promise<ChatSession>
      getChatSessions: (notebookId: string) => Promise<ChatSession[]>
      getActiveSession: (notebookId: string) => Promise<ChatSession | null>
      updateSessionTitle: (sessionId: string, title: string) => Promise<void>
      deleteSession: (sessionId: string) => Promise<void>

      // Chat Message 相关
      getMessages: (sessionId: string) => Promise<ChatMessage[]>
      sendMessage: (sessionId: string, content: string) => Promise<string>
      abortMessage: (messageId: string) => Promise<{ success: boolean; reason?: string }>

      // 流式消息监听（AI SDK 流式协议格式）
      onMessageChunk: (
        callback: (data: {
          messageId: string
          type: 'reasoning-start' | 'reasoning-delta' | 'reasoning-end' | 'text-delta' | 'finish'
          content?: string
          reasoningId?: string
          metadata?: any
        }) => void
      ) => () => void
      onMessageError: (callback: (data: { messageId: string; error: string }) => void) => () => void

      // Session 自动切换监听
      onSessionAutoSwitched: (
        callback: (data: { oldSessionId: string; newSessionId: string }) => void
      ) => () => void

      // Model Connection 相关
      connections: {
        getAll: () => Promise<ConnectionMap>
        getProtocols: () => Promise<
          { protocol: string; supportsModelListing: boolean; supportsEmbedding: boolean }[]
        >
        save: (capability: ModelCapability, connection: ModelConnection) => Promise<void>
        remove: (capability: ModelCapability) => Promise<void>
        test: (connection: ModelConnection) => Promise<ConnectionTestResult>
        fetchModels: (connection: ModelConnection) => Promise<string[]>
        onChanged: (callback: () => void) => () => void
      }

      // 知识库相关
      knowledge: {
        // 添加文档
        addDocument: (
          notebookId: string,
          options: AddDocumentOptions
        ) => Promise<{ success: boolean; documentId?: string; error?: string }>
        addDocumentFromFile: (
          notebookId: string,
          filePath: string
        ) => Promise<{ success: boolean; documentId?: string; error?: string }>
        addDocumentFromUrl: (
          notebookId: string,
          url: string
        ) => Promise<{ success: boolean; documentId?: string; error?: string }>
        addNote: (
          notebookId: string,
          noteId: string
        ) => Promise<{ success: boolean; documentId?: string; error?: string }>

        // 搜索
        search: (
          notebookId: string,
          query: string,
          options?: SearchOptions
        ) => Promise<{ success: boolean; results: KnowledgeSearchResult[]; error?: string }>

        // 文档管理
        getDocuments: (notebookId: string) => Promise<KnowledgeDocument[]>
        getDocument: (documentId: string) => Promise<KnowledgeDocument | null>
        getDocumentChunks: (documentId: string) => Promise<KnowledgeChunk[]>
        deleteDocument: (documentId: string) => Promise<{ success: boolean; error?: string }>
        reindexDocument: (documentId: string) => Promise<{ success: boolean; error?: string }>

        // 统计
        getStats: (notebookId: string) => Promise<KnowledgeStats>

        // 文件选择对话框
        selectFiles: () => Promise<string[]>

        // 打开源文件
        openSource: (documentId: string) => Promise<{ success: boolean; error?: string }>

        // 索引进度监听
        onIndexProgress: (callback: (progress: IndexProgress) => void) => () => void
      }

      // 应用更新相关
      update: {
        // 检查更新
        check: () => Promise<UpdateCheckResult>
        // 下载更新
        download: () => Promise<UpdateOperationResult>
        // 安装更新（退出并安装）
        install: () => Promise<UpdateOperationResult>
        // 获取当前更新状态
        getState: () => Promise<UpdateCheckResult>
        // 监听更新状态变化
        onStateChanged: (callback: (state: UpdateState) => void) => () => void
      }
    }
  }
}
