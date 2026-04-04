import { create } from 'zustand'
import type { AnkiCard } from '../../../main/db/schema'
import type { AnkiCardItem } from '../../../shared/types/anki'

interface AnkiStore {
  // 핵심 상태
  currentAnkiCards: AnkiCard | null
  selectedCardIds: Set<string>
  isGenerating: boolean
  generationProgress: { stage: string; progress: number } | null

  // Dialog 상태
  isConfigDialogOpen: boolean
  isExportDialogOpen: boolean

  // 카드 편집 상태
  editingCard: AnkiCardItem | null
  isEditing: boolean

  // Actions
  setCurrentAnkiCards: (cards: AnkiCard | null) => void
  setSelectedCardIds: (ids: Set<string>) => void
  toggleCardSelection: (id: string) => void
  clearSelection: () => void
  setIsGenerating: (isGenerating: boolean) => void
  setGenerationProgress: (progress: { stage: string; progress: number } | null) => void
  setConfigDialogOpen: (open: boolean) => void
  setExportDialogOpen: (open: boolean) => void
  setEditingCard: (card: AnkiCardItem | null) => void
  setIsEditing: (isEditing: boolean) => void

  // 계산 속성
  getTotalCards: () => number
  getSelectedCards: () => AnkiCardItem[]

  // 비동기 작업
  loadLatestAnkiCards: (notebookId: string) => Promise<void>
  loadAnkiCards: (ankiCardId: string) => Promise<void>
  generateAnkiCards: (
    notebookId: string,
    options?: {
      cardCount?: number
      cardTypes?: ('basic' | 'cloze' | 'fill-blank')[]
      difficulty?: 'easy' | 'medium' | 'hard'
      customPrompt?: string
    }
  ) => Promise<void>
  exportCards: (
    format: 'apkg',
    deckName?: string
  ) => Promise<{ success: boolean; filePath?: string; error?: string }>
  updateCard: (cardId: string, updates: Partial<AnkiCardItem>) => void
  deleteCards: (cardIds: string[]) => Promise<void>
  reset: () => void
}

export const useAnkiStore = create<AnkiStore>()((set, get) => ({
  // 초기 상태
  currentAnkiCards: null,
  selectedCardIds: new Set(),
  isGenerating: false,
  generationProgress: null,
  isConfigDialogOpen: false,
  isExportDialogOpen: false,
  editingCard: null,
  isEditing: false,

  // Setters
  setCurrentAnkiCards: (cards) => set({ currentAnkiCards: cards }),
  setSelectedCardIds: (ids) => set({ selectedCardIds: ids }),
  toggleCardSelection: (id) =>
    set((state) => {
      const newIds = new Set(state.selectedCardIds)
      if (newIds.has(id)) {
        newIds.delete(id)
      } else {
        newIds.add(id)
      }
      return { selectedCardIds: newIds }
    }),
  clearSelection: () => set({ selectedCardIds: new Set() }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setGenerationProgress: (progress) => set({ generationProgress: progress }),
  setConfigDialogOpen: (open) => set({ isConfigDialogOpen: open }),
  setExportDialogOpen: (open) => set({ isExportDialogOpen: open }),
  setEditingCard: (card) => set({ editingCard: card }),
  setIsEditing: (isEditing) => set({ isEditing }),

  // 계산 속성
  getTotalCards: () => {
    const { currentAnkiCards } = get()
    if (!currentAnkiCards) return 0
    return (currentAnkiCards.cardsData as AnkiCardItem[]).length
  },

  getSelectedCards: () => {
    const { currentAnkiCards, selectedCardIds } = get()
    if (!currentAnkiCards) return []
    const cards = currentAnkiCards.cardsData as AnkiCardItem[]
    return cards.filter((card) => selectedCardIds.has(card.id))
  },

  // 비동기 작업
  loadLatestAnkiCards: async (notebookId: string) => {
    try {
      const cards = await window.api.anki.getLatest(notebookId)
      set({ currentAnkiCards: cards })
    } catch (error) {
      console.error('Failed to load latest anki cards:', error)
      throw error
    }
  },

  loadAnkiCards: async (ankiCardId: string) => {
    try {
      const cards = await window.api.anki.get(ankiCardId)
      set({ currentAnkiCards: cards })
    } catch (error) {
      console.error('Failed to load anki cards:', error)
      throw error
    }
  },

  generateAnkiCards: async (
    notebookId: string,
    options?: {
      cardCount?: number
      cardTypes?: ('basic' | 'cloze' | 'fill-blank')[]
      difficulty?: 'easy' | 'medium' | 'hard'
      customPrompt?: string
    }
  ) => {
    set({ isGenerating: true, generationProgress: { stage: 'starting', progress: 0 } })
    try {
      const result = await window.api.anki.generate(notebookId, options)
      if (result.success) {
        // 생성 성공, currentAnkiCards 업데이트 안 함
        // 사용자가 현재 카드를 계속 볼 수 있고, 새 카드는 나중에 생성
        set({
          isGenerating: false,
          generationProgress: null
        })
      } else {
        throw new Error(result.error || 'Failed to generate anki cards')
      }
    } catch (error) {
      console.error('Failed to generate anki cards:', error)
      set({ isGenerating: false, generationProgress: null })
      throw error
    }
  },

  exportCards: async (format: 'apkg', deckName?: string) => {
    const { currentAnkiCards } = get()
    if (!currentAnkiCards) {
      throw new Error('No cards to export')
    }

    try {
      const result = await window.api.anki.export(currentAnkiCards.id, format, deckName)
      if (result.success) {
        set({ isExportDialogOpen: false })
        return result
      }
      throw new Error(result.error || 'Export failed')
    } catch (error) {
      console.error('Failed to export cards:', error)
      throw error
    }
  },

  updateCard: (cardId: string, updates: Partial<AnkiCardItem>) => {
    const { currentAnkiCards } = get()
    if (!currentAnkiCards) return

    const cards = currentAnkiCards.cardsData as AnkiCardItem[]
    const updatedCards = cards.map((card) => (card.id === cardId ? { ...card, ...updates } : card))

    set({
      currentAnkiCards: {
        ...currentAnkiCards,
        cardsData: updatedCards
      }
    })
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deleteCards: async (_cardIds: string[]) => {
    // 현재 개별 카드 삭제는 미지원, 전체 카드 세트 삭제만 지원
    throw new Error('deleteCards not implemented: only whole-deck deletion supported')
  },

  reset: () => {
    set({
      selectedCardIds: new Set(),
      isGenerating: false,
      generationProgress: null,
      isConfigDialogOpen: false,
      isExportDialogOpen: false,
      editingCard: null,
      isEditing: false
    })
  }
}))

// 진행률 리스너 설정
export function setupAnkiListeners() {
  return window.api.anki.onProgress((data) => {
    useAnkiStore.setState({
      generationProgress: { stage: data.stage, progress: data.progress }
    })
  })
}
