import { create } from 'zustand'
import type { Notebook } from '../types/notebook'

interface NotebookStore {
  notebooks: Notebook[]
  currentNotebook: Notebook | null
  openedNotebooks: Notebook[]

  loadNotebooks: () => Promise<void>
  addNotebook: (notebook: Omit<Notebook, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>
  deleteNotebook: (id: string) => Promise<void>
  updateNotebook: (id: string, updates: Partial<Notebook>) => Promise<void>
  setCurrentNotebook: (id: string) => void
  addOpenedNotebook: (id: string) => void
  removeOpenedNotebook: (id: string) => void
}

export const useNotebookStore = create<NotebookStore>()((set) => ({
  notebooks: [],
  currentNotebook: null,
  openedNotebooks: [],

  loadNotebooks: async () => {
    console.log('[NotebookStore] Loading notebooks from database...')
    try {
      const notebooks = await window.api.getAllNotebooks()
      console.log(`[NotebookStore] Loaded ${notebooks.length} notebooks from database`)
      set({ notebooks })
    } catch (error) {
      console.error('[NotebookStore] Failed to load notebooks:', error)
      throw error
    }
  },

  addNotebook: async (notebook) => {
    console.log('[NotebookStore] Creating notebook:', notebook.title)
    try {
      const dbNotebook = await window.api.createNotebook(
        notebook.title,
        notebook.description ?? undefined
      )
      console.log('[NotebookStore] Notebook created in database:', dbNotebook.id)

      set((state) => ({
        notebooks: [dbNotebook, ...state.notebooks]
      }))

      // 첫 번째 세션 자동 생성
      try {
        await window.api.createChatSession(dbNotebook.id, '새 대화')
        console.log(`[NotebookStore] Created initial session for notebook ${dbNotebook.id}`)
      } catch (error) {
        console.error('[NotebookStore] Failed to create initial session:', error)
      }

      return dbNotebook.id
    } catch (error) {
      console.error('[NotebookStore] Failed to create notebook:', error)
      throw error
    }
  },

  deleteNotebook: async (id) => {
    console.log('[NotebookStore] Deleting notebook:', id)
    try {
      await window.api.deleteNotebook(id)
      console.log('[NotebookStore] Notebook deleted from database:', id)

      set((state) => ({
        notebooks: state.notebooks.filter((nb) => nb.id !== id),
        openedNotebooks: state.openedNotebooks.filter((nb) => nb.id !== id),
        currentNotebook: state.currentNotebook?.id === id ? null : state.currentNotebook
      }))
    } catch (error) {
      console.error('[NotebookStore] Failed to delete notebook:', error)
      throw error
    }
  },

  updateNotebook: async (id, updates) => {
    console.log('[NotebookStore] Updating notebook:', id, updates)
    try {
      await window.api.updateNotebook(id, {
        title: updates.title,
        description: updates.description
      })
      console.log('[NotebookStore] Notebook updated in database:', id)

      set((state) => {
        const updatedNotebooks = state.notebooks.map((nb) =>
          nb.id === id ? { ...nb, ...updates, updatedAt: new Date() } : nb
        )
        // openedNotebooks 및 currentNotebook도 동시 업데이트
        const updatedOpenedNotebooks = state.openedNotebooks.map((nb) =>
          nb.id === id ? { ...nb, ...updates, updatedAt: new Date() } : nb
        )
        const updatedCurrentNotebook =
          state.currentNotebook?.id === id
            ? { ...state.currentNotebook, ...updates, updatedAt: new Date() }
            : state.currentNotebook

        return {
          notebooks: updatedNotebooks,
          openedNotebooks: updatedOpenedNotebooks,
          currentNotebook: updatedCurrentNotebook
        }
      })
    } catch (error) {
      console.error('[NotebookStore] Failed to update notebook:', error)
      throw error
    }
  },

  setCurrentNotebook: (id) =>
    set((state) => ({
      currentNotebook: state.notebooks.find((nb) => nb.id === id) || null
    })),

  addOpenedNotebook: (id) =>
    set((state) => {
      const notebook = state.notebooks.find((nb) => nb.id === id)
      if (!notebook) return state
      // 이미 열려 있으면 중복 추가하지 않음
      if (state.openedNotebooks.some((nb) => nb.id === id)) return state
      return {
        openedNotebooks: [...state.openedNotebooks, notebook]
      }
    }),

  removeOpenedNotebook: (id) =>
    set((state) => ({
      openedNotebooks: state.openedNotebooks.filter((nb) => nb.id !== id)
    }))
}))
