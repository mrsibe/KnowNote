/**
 * Knowledge Store
 * 知识库状态管理
 */

import { create } from 'zustand'
import type {
  KnowledgeDocument,
  KnowledgeSearchResult,
  IndexProgress,
  KnowledgeStats,
  AddDocumentOptions,
  SearchOptions
} from '../../../shared/types/knowledge'

interface KnowledgeStore {
  // 状态
  documents: KnowledgeDocument[]
  searchResults: KnowledgeSearchResult[]
  stats: KnowledgeStats | null
  isLoading: boolean
  isSearching: boolean
  isIndexing: boolean
  indexProgress: IndexProgress | null
  error: string | null
  /**
   * 文档列表是否已经成功读过一次。用来区分「列表为空」和「还没加载」：
   * #72 的失效引用判定只能在加载完成后做，否则冷启动的 deep-link 会在列表回来之前被误清。
   */
  documentsLoaded: boolean

  // Actions
  setDocuments: (docs: KnowledgeDocument[]) => void
  setSearchResults: (results: KnowledgeSearchResult[]) => void
  setStats: (stats: KnowledgeStats | null) => void
  setIsLoading: (value: boolean) => void
  setIsSearching: (value: boolean) => void
  setIsIndexing: (value: boolean) => void
  setIndexProgress: (progress: IndexProgress | null) => void
  setError: (error: string | null) => void
  clearSearchResults: () => void

  // 异步操作
  loadDocuments: (notebookId: string) => Promise<void>
  loadStats: (notebookId: string) => Promise<void>
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
  addNoteToKnowledge: (
    notebookId: string,
    noteId: string
  ) => Promise<{ success: boolean; documentId?: string; error?: string }>
  search: (notebookId: string, query: string, options?: SearchOptions) => Promise<void>
  deleteDocument: (
    notebookId: string,
    documentId: string
  ) => Promise<{ success: boolean; error?: string }>
  selectFiles: () => Promise<string[]>
}

export const useKnowledgeStore = create<KnowledgeStore>()((set, get) => ({
  // 初始状态
  documents: [],
  searchResults: [],
  stats: null,
  isLoading: false,
  isSearching: false,
  isIndexing: false,
  indexProgress: null,
  error: null,
  documentsLoaded: false,

  // Setters
  setDocuments: (documents) => set({ documents }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setStats: (stats) => set({ stats }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setIsSearching: (isSearching) => set({ isSearching }),
  setIsIndexing: (isIndexing) => set({ isIndexing }),
  setIndexProgress: (indexProgress) => set({ indexProgress }),
  setError: (error) => set({ error }),
  clearSearchResults: () => set({ searchResults: [] }),

  // 加载文档列表
  loadDocuments: async (notebookId) => {
    set({ isLoading: true, error: null, documentsLoaded: false })
    try {
      const docs = await window.api.knowledge.getDocuments(notebookId)
      set({ documents: docs, isLoading: false, documentsLoaded: true })
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false, documentsLoaded: false })
    }
  },

  // 加载统计信息
  loadStats: async (notebookId) => {
    try {
      const stats = await window.api.knowledge.getStats(notebookId)
      set({ stats })
    } catch (error) {
      console.error('Failed to load stats:', error)
    }
  },

  // 添加文档
  addDocument: async (notebookId, options) => {
    set({ isIndexing: true, error: null })
    try {
      const result = await window.api.knowledge.addDocument(notebookId, options)
      if (result.success) {
        await get().loadDocuments(notebookId)
        await get().loadStats(notebookId)
      }
      set({ isIndexing: false, indexProgress: null })
      return result
    } catch (error) {
      set({ isIndexing: false, indexProgress: null, error: (error as Error).message })
      return { success: false, error: (error as Error).message }
    }
  },

  // 从文件添加文档
  addDocumentFromFile: async (notebookId, filePath) => {
    set({ isIndexing: true, error: null })
    try {
      const result = await window.api.knowledge.addDocumentFromFile(notebookId, filePath)
      if (result.success) {
        await get().loadDocuments(notebookId)
        await get().loadStats(notebookId)
      }
      set({ isIndexing: false, indexProgress: null })
      return result
    } catch (error) {
      set({ isIndexing: false, indexProgress: null, error: (error as Error).message })
      return { success: false, error: (error as Error).message }
    }
  },

  // 从 URL 添加文档
  addDocumentFromUrl: async (notebookId, url) => {
    set({ isIndexing: true, error: null })
    try {
      const result = await window.api.knowledge.addDocumentFromUrl(notebookId, url)
      if (result.success) {
        await get().loadDocuments(notebookId)
        await get().loadStats(notebookId)
      }
      set({ isIndexing: false, indexProgress: null })
      return result
    } catch (error) {
      set({ isIndexing: false, indexProgress: null, error: (error as Error).message })
      return { success: false, error: (error as Error).message }
    }
  },

  // 将 Note 添加到知识库
  addNoteToKnowledge: async (notebookId, noteId) => {
    set({ isIndexing: true, error: null })
    try {
      const result = await window.api.knowledge.addNote(notebookId, noteId)
      if (result.success) {
        await get().loadDocuments(notebookId)
        await get().loadStats(notebookId)
      }
      set({ isIndexing: false, indexProgress: null })
      return result
    } catch (error) {
      set({ isIndexing: false, indexProgress: null, error: (error as Error).message })
      return { success: false, error: (error as Error).message }
    }
  },

  // 搜索
  search: async (notebookId, query, options) => {
    if (!query.trim()) {
      set({ searchResults: [] })
      return
    }

    set({ isSearching: true, error: null })
    try {
      const result = await window.api.knowledge.search(notebookId, query, options)
      if (result.success) {
        set({ searchResults: result.results, isSearching: false })
      } else {
        set({ searchResults: [], isSearching: false, error: result.error })
      }
    } catch (error) {
      set({ searchResults: [], isSearching: false, error: (error as Error).message })
    }
  },

  // 删除文档
  deleteDocument: async (notebookId, documentId) => {
    try {
      const result = await window.api.knowledge.deleteDocument(documentId)
      if (result.success) {
        set((state) => ({
          documents: state.documents.filter((d) => d.id !== documentId)
        }))
        await get().loadStats(notebookId)
      }
      return result
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  },

  // 选择文件
  selectFiles: async () => {
    try {
      return await window.api.knowledge.selectFiles()
    } catch (error) {
      console.error('Failed to select files:', error)
      return []
    }
  }
}))

/**
 * 设置知识库监听器
 */
export function setupKnowledgeListeners(): () => void {
  const cleanupProgress = window.api.knowledge.onIndexProgress((data: IndexProgress) => {
    useKnowledgeStore.getState().setIndexProgress(data)
  })

  return () => {
    cleanupProgress()
  }
}
