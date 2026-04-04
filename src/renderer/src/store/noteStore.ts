import { create } from 'zustand'
import type { Note } from '../../../shared/types'

interface NoteStore {
  // 상태
  notes: Note[]
  currentNote: Note | null
  isEditing: boolean
  isSaving: boolean

  // Actions
  setNotes: (notes: Note[]) => void
  setCurrentNote: (note: Note | null) => void
  setIsEditing: (isEditing: boolean) => void

  // 비동기 작업
  loadNotes: (notebookId: string) => Promise<void>
  createNote: (notebookId: string, content: string, customTitle?: string) => Promise<Note>
  updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content'>>) => Promise<void>
  deleteNote: (id: string) => Promise<void>
}

export const useNoteStore = create<NoteStore>()((set) => ({
  notes: [],
  currentNote: null,
  isEditing: false,
  isSaving: false,

  setNotes: (notes) => set({ notes }),
  setCurrentNote: (note) => set({ currentNote: note, isEditing: !!note }),
  setIsEditing: (isEditing) => set({ isEditing }),

  loadNotes: async (notebookId: string) => {
    console.log('[NoteStore] Loading notes for notebook:', notebookId)
    try {
      const notes = await window.api.getNotes(notebookId)
      console.log(`[NoteStore] Loaded ${notes.length} notes`)
      set({ notes })
    } catch (error) {
      console.error('[NoteStore] Failed to load notes:', error)
      throw error
    }
  },

  createNote: async (notebookId: string, content: string, customTitle?: string) => {
    console.log('[NoteStore] Creating note')
    try {
      set({ isSaving: true })
      const note = await window.api.createNote(notebookId, content, customTitle)
      console.log('[NoteStore] Note created:', note.id)

      set((state) => ({
        notes: [note, ...state.notes],
        currentNote: note,
        isEditing: true,
        isSaving: false
      }))

      return note
    } catch (error) {
      console.error('[NoteStore] Failed to create note:', error)
      set({ isSaving: false })
      throw error
    }
  },

  updateNote: async (id: string, updates: Partial<Pick<Note, 'title' | 'content'>>) => {
    console.log('[NoteStore] Updating note:', id)
    try {
      set({ isSaving: true })
      await window.api.updateNote(id, updates)
      console.log('[NoteStore] Note updated:', id)

      set((state) => {
        const updatedNotes = state.notes.map((note) =>
          note.id === id ? { ...note, ...updates, updatedAt: new Date() } : note
        )
        const updatedCurrentNote =
          state.currentNote?.id === id
            ? { ...state.currentNote, ...updates, updatedAt: new Date() }
            : state.currentNote

        return {
          notes: updatedNotes,
          currentNote: updatedCurrentNote,
          isSaving: false
        }
      })
    } catch (error) {
      console.error('[NoteStore] Failed to update note:', error)
      set({ isSaving: false })
      throw error
    }
  },

  deleteNote: async (id: string) => {
    console.log('[NoteStore] Deleting note:', id)
    try {
      await window.api.deleteNote(id)
      console.log('[NoteStore] Note deleted:', id)

      set((state) => ({
        notes: state.notes.filter((note) => note.id !== id),
        currentNote: state.currentNote?.id === id ? null : state.currentNote,
        isEditing: state.currentNote?.id === id ? false : state.isEditing
      }))
    } catch (error) {
      console.error('[NoteStore] Failed to delete note:', error)
      throw error
    }
  }
}))
