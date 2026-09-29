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
  SearchOptions,
  BatchImportOutcome
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
  /**
   * 最近一次加载文档的 notebook。后台索引（#176）完成后只有进度事件可听，
   * 靠它把刚转成 `indexed` 的那一行重新读回来。
   */
  activeNotebookId: string | null

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
  /** 重试一份失败的来源（#95）。解析前失败的会重新解析本地副本。 */
  retryDocument: (
    notebookId: string,
    documentId: string
  ) => Promise<{ success: boolean; error?: string }>
  /** 重建一份来源的派生索引（#95）。 */
  reindexDocument: (
    notebookId: string,
    documentId: string
  ) => Promise<{ success: boolean; error?: string }>
  addDocumentFromUrl: (
    notebookId: string,
    url: string
  ) => Promise<{ success: boolean; documentId?: string; error?: string }>
  addNoteToKnowledge: (
    notebookId: string,
    noteId: string
  ) => Promise<{ success: boolean; documentId?: string; error?: string }>
  /** 文件夹导入：一次快照；`watch` 为 true 时同时改为监听来源（#158）。 */
  addFolder: (
    notebookId: string,
    folderPath: string,
    watch?: boolean
  ) => Promise<BatchImportOutcome>
  /** 批量导入一组文件（#98）：拖放与多选共用同一路径。 */
  addFiles: (notebookId: string, paths: string[]) => Promise<BatchImportOutcome>
  selectFolder: () => Promise<string[]>
  search: (notebookId: string, query: string, options?: SearchOptions) => Promise<void>
  deleteDocument: (
    notebookId: string,
    documentId: string
  ) => Promise<{ success: boolean; error?: string }>
  selectFiles: () => Promise<string[]>
}

/**
 * 一次导入尝试结束之后（成功或失败）收尾。
 *
 * 无论成败都要重新读列表：失败时这一行可能已经以 `status: 'failed'` 落库了，而只刷新成功
 * 的路径会让这次失败在界面上**完全不存在** —— 面板保持空状态，用户以为上传成功了（#146）。
 * 失败同时记进 `error`：抛异常和返回 `{success:false}` 都是失败，没道理只记前者。
 */
async function refreshAfterImport(
  notebookId: string,
  result: { success: boolean; error?: string },
  set: (partial: Partial<KnowledgeStore>) => void,
  get: () => KnowledgeStore
): Promise<void> {
  await get().loadDocuments(notebookId)
  await get().loadStats(notebookId)

  set({
    isIndexing: false,
    indexProgress: null,
    error: result.success ? null : (result.error ?? null)
  })
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
  activeNotebookId: null,

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
    set({ isLoading: true, error: null, documentsLoaded: false, activeNotebookId: notebookId })
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
      await refreshAfterImport(notebookId, result, set, get)
      return result
    } catch (error) {
      const message = (error as Error).message
      await refreshAfterImport(notebookId, { success: false, error: message }, set, get)
      return { success: false, error: message }
    }
  },

  // 从文件添加文档
  addDocumentFromFile: async (notebookId, filePath) => {
    set({ isIndexing: true, error: null })
    try {
      const result = await window.api.knowledge.addDocumentFromFile(notebookId, filePath)
      await refreshAfterImport(notebookId, result, set, get)
      return result
    } catch (error) {
      const message = (error as Error).message
      await refreshAfterImport(notebookId, { success: false, error: message }, set, get)
      return { success: false, error: message }
    }
  },

  // 从 URL 添加文档
  addDocumentFromUrl: async (notebookId, url) => {
    set({ isIndexing: true, error: null })
    try {
      const result = await window.api.knowledge.addDocumentFromUrl(notebookId, url)
      await refreshAfterImport(notebookId, result, set, get)
      return result
    } catch (error) {
      const message = (error as Error).message
      await refreshAfterImport(notebookId, { success: false, error: message }, set, get)
      return { success: false, error: message }
    }
  },

  // 将 Note 添加到知识库
  addNoteToKnowledge: async (notebookId, noteId) => {
    set({ isIndexing: true, error: null })
    try {
      const result = await window.api.knowledge.addNote(notebookId, noteId)
      await refreshAfterImport(notebookId, result, set, get)
      return result
    } catch (error) {
      const message = (error as Error).message
      await refreshAfterImport(notebookId, { success: false, error: message }, set, get)
      return { success: false, error: message }
    }
  },

  // 文件夹 / 批量导入（#98）
  addFolder: async (notebookId, folderPath, watch = false) => {
    set({ isIndexing: true, error: null })
    const result = await window.api.knowledge.addFolder(notebookId, folderPath, watch)
    await refreshAfterImport(notebookId, result, set, get)
    return result
  },

  addFiles: async (notebookId, paths) => {
    set({ isIndexing: true, error: null })
    const result = await window.api.knowledge.addFiles(notebookId, paths)
    await refreshAfterImport(notebookId, result, set, get)
    return result
  },

  selectFolder: async () => {
    try {
      return await window.api.knowledge.selectFolder()
    } catch (error) {
      console.error('Failed to select folder:', error)
      return []
    }
  },

  // 重新索引 / 重试（#95）
  retryDocument: async (notebookId, documentId) => {
    set({ isIndexing: true, error: null })
    try {
      const result = await window.api.knowledge.retryDocument(documentId)
      await refreshAfterImport(notebookId, result, set, get)
      return result
    } catch (error) {
      const message = (error as Error).message
      await refreshAfterImport(notebookId, { success: false, error: message }, set, get)
      return { success: false, error: message }
    }
  },

  reindexDocument: async (notebookId, documentId) => {
    set({ isIndexing: true, error: null })
    try {
      const result = await window.api.knowledge.reindexDocument(documentId)
      await refreshAfterImport(notebookId, result, set, get)
      return result
    } catch (error) {
      const message = (error as Error).message
      await refreshAfterImport(notebookId, { success: false, error: message }, set, get)
      return { success: false, error: message }
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

    // 后台导入的最后一步（#176）：这一行刚从 pending/processing 变成 indexed 或 failed。
    // 进度事件是唯一信号，所以在这里重读一次列表与统计。
    if (data.stage === 'completed' || data.stage === 'failed') {
      const { activeNotebookId, loadDocuments, loadStats } = useKnowledgeStore.getState()
      if (activeNotebookId) {
        void loadDocuments(activeNotebookId)
        void loadStats(activeNotebookId)
      }
    }
  })

  return () => {
    cleanupProgress()
  }
}
