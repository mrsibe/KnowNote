import { ElectronAPI } from '@electron-toolkit/preload'
import type { ChatSession, ChatMessage } from '../shared/types/chat'
import type { Notebook, Note, ProviderConfig, AppSettings } from '../shared/types'
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

// 공유 타입 재내보내기
export type {
  ChatSession,
  ChatMessage,
  Notebook,
  Note,
  ProviderConfig,
  AppSettings,
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
      // 플랫폼 정보 조회
      getPlatform: () => Promise<string>

      // 앱 버전 번호 조회
      getAppVersion: () => Promise<string>

      // 기본 브라우저에서 외부 링크 열기
      openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>

      // 시스템 다이얼로그 관련
      dialog: {
        saveFile: (options: {
          title?: string
          defaultPath?: string
          filters?: { name: string; extensions: string[] }[]
        }) => Promise<string | null>
      }

      // 앱 설정 관련
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

      // Notebook 관련
      createNotebook: (title: string, description?: string) => Promise<Notebook>
      getAllNotebooks: () => Promise<Notebook[]>
      getNotebook: (id: string) => Promise<Notebook | null>
      updateNotebook: (
        id: string,
        updates: Partial<Pick<Notebook, 'title' | 'description'>>
      ) => Promise<void>
      deleteNotebook: (id: string) => Promise<void>

      // Note 관련
      createNote: (notebookId: string, content: string, customTitle?: string) => Promise<Note>
      getNotes: (notebookId: string) => Promise<Note[]>
      getNote: (id: string) => Promise<Note | null>
      updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content'>>) => Promise<void>
      deleteNote: (id: string) => Promise<void>

      // Items 관련 (노트, 마인드맵 등 통합 관리)
      items: {
        getAll: (notebookId: string) => Promise<any[]>
        updateOrder: (itemId: string, order: number) => Promise<{ success: boolean }>
        batchUpdateOrder: (updates: Record<string, number>) => Promise<{ success: boolean }>
        delete: (itemId: string, deleteResource?: boolean) => Promise<{ success: boolean }>
      }

      // Mind Map 관련
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

      // Quiz 관련
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

      // Anki 카드 관련
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

      // Chat Session 관련
      createChatSession: (notebookId: string, title: string) => Promise<ChatSession>
      getChatSessions: (notebookId: string) => Promise<ChatSession[]>
      getActiveSession: (notebookId: string) => Promise<ChatSession | null>
      updateSessionTitle: (sessionId: string, title: string) => Promise<void>
      deleteSession: (sessionId: string) => Promise<void>

      // Chat Message 관련
      getMessages: (sessionId: string) => Promise<ChatMessage[]>
      sendMessage: (sessionId: string, content: string) => Promise<string>
      abortMessage: (messageId: string) => Promise<{ success: boolean; reason?: string }>

      // 스트리밍 메시지 리스너 (AI SDK 스트리밍 프로토콜 형식)
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

      // Session 자동 전환 리스너
      onSessionAutoSwitched: (
        callback: (data: { oldSessionId: string; newSessionId: string }) => void
      ) => () => void

      // Provider 설정 관련
      saveProviderConfig: (config: ProviderConfig) => Promise<void>
      getProviderConfig: (providerName: string) => Promise<ProviderConfig | null>
      getAllProviderConfigs: () => Promise<ProviderConfig[]>
      deleteProviderConfig: (providerName: string) => Promise<void>
      validateProviderConfig: (providerName: string, config: any) => Promise<boolean>
      fetchModels: (
        providerName: string,
        apiKey: string
      ) => Promise<
        | {
            models: {
              id: string
              object: string
              owned_by?: string
              created?: number
              type?: string
            }[]
            source: 'merged' | 'builtin'
            builtinCount?: number
            remoteCount?: number
            error?: string
          }
        | { id: string; object: string; owned_by?: string; created?: number }[]
      >
      getProviderModels: (
        providerName: string
      ) => Promise<{ id: string; object: string; owned_by?: string; created?: number }[]>
      onProviderConfigChanged: (callback: () => void) => () => void

      // 지식 베이스 관련
      knowledge: {
        // 문서 추가
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

        // 검색
        search: (
          notebookId: string,
          query: string,
          options?: SearchOptions
        ) => Promise<{ success: boolean; results: KnowledgeSearchResult[]; error?: string }>

        // 문서 관리
        getDocuments: (notebookId: string) => Promise<KnowledgeDocument[]>
        getDocument: (documentId: string) => Promise<KnowledgeDocument | null>
        getDocumentChunks: (documentId: string) => Promise<KnowledgeChunk[]>
        deleteDocument: (documentId: string) => Promise<{ success: boolean; error?: string }>
        reindexDocument: (documentId: string) => Promise<{ success: boolean; error?: string }>

        // 통계
        getStats: (notebookId: string) => Promise<KnowledgeStats>

        // 파일 선택 다이얼로그
        selectFiles: () => Promise<string[]>

        // 소스 파일 열기
        openSource: (documentId: string) => Promise<{ success: boolean; error?: string }>

        // 인덱싱 진행률 리스너
        onIndexProgress: (callback: (progress: IndexProgress) => void) => () => void
      }

      // 앱 업데이트 관련
      update: {
        // 업데이트 확인
        check: () => Promise<UpdateCheckResult>
        // 업데이트 다운로드
        download: () => Promise<UpdateOperationResult>
        // 업데이트 설치 (종료 후 설치)
        install: () => Promise<UpdateOperationResult>
        // 현재 업데이트 상태 조회
        getState: () => Promise<UpdateCheckResult>
        // 업데이트 상태 변경 리스너
        onStateChanged: (callback: (state: UpdateState) => void) => () => void
      }
    }
  }
}
