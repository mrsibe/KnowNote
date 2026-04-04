import { create } from 'zustand'
import type { MindMap } from '../../../main/db/schema'

interface ChunkInfo {
  id: string
  content: string
  documentTitle: string
}

interface MindMapStore {
  // 핵심 상태
  currentMindMap: MindMap | null
  isGenerating: boolean
  generationProgress: { stage: string; progress: number } | null

  // Dialog 상태
  isDialogOpen: boolean
  selectedNodeId: string | null
  nodeChunks: ChunkInfo[] | null

  // Actions
  setCurrentMindMap: (mindMap: MindMap | null) => void
  setIsGenerating: (isGenerating: boolean) => void
  setGenerationProgress: (progress: { stage: string; progress: number } | null) => void
  setDialogOpen: (open: boolean) => void
  setSelectedNodeId: (nodeId: string | null) => void
  setNodeChunks: (chunks: ChunkInfo[] | null) => void

  // 비동기 작업
  loadLatestMindMap: (notebookId: string) => Promise<void>
  loadMindMap: (mindMapId: string) => Promise<void>
  generateMindMap: (notebookId: string) => Promise<void>
  loadNodeChunks: (mindMapId: string, nodeId: string) => Promise<void>
  deleteMindMap: (mindMapId: string) => Promise<void>
}

export const useMindMapStore = create<MindMapStore>()((set) => ({
  currentMindMap: null,
  isGenerating: false,
  generationProgress: null,
  isDialogOpen: false,
  selectedNodeId: null,
  nodeChunks: null,

  setCurrentMindMap: (mindMap) => set({ currentMindMap: mindMap }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setGenerationProgress: (progress) => set({ generationProgress: progress }),
  setDialogOpen: (open) => set({ isDialogOpen: open }),
  setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId }),
  setNodeChunks: (chunks) => set({ nodeChunks: chunks }),

  loadLatestMindMap: async (notebookId: string) => {
    try {
      const mindMap = await window.api.mindmap.getLatest(notebookId)
      set({ currentMindMap: mindMap })
    } catch (error) {
      console.error('Failed to load latest mind map:', error)
    }
  },

  loadMindMap: async (mindMapId: string) => {
    try {
      const mindMap = await window.api.mindmap.get(mindMapId)
      set({ currentMindMap: mindMap })
    } catch (error) {
      console.error('Failed to load mind map:', error)
    }
  },

  generateMindMap: async (notebookId: string) => {
    set({ isGenerating: true, generationProgress: { stage: 'starting', progress: 0 } })
    try {
      const result = await window.api.mindmap.generate(notebookId)
      if (result.success && result.mindMapId) {
        const mindMap = await window.api.mindmap.get(result.mindMapId)
        set({ currentMindMap: mindMap, isGenerating: false, generationProgress: null })
      } else {
        throw new Error(result.error || 'Failed to generate mind map')
      }
    } catch (error) {
      console.error('Failed to generate mind map:', error)
      set({ isGenerating: false, generationProgress: null })
      throw error
    }
  },

  loadNodeChunks: async (mindMapId: string, nodeId: string) => {
    try {
      const chunks = await window.api.mindmap.getNodeChunks(mindMapId, nodeId)
      set({ nodeChunks: chunks, selectedNodeId: nodeId })
    } catch (error) {
      console.error('Failed to load node chunks:', error)
    }
  },

  deleteMindMap: async (mindMapId: string) => {
    try {
      await window.api.mindmap.delete(mindMapId)
      set({ currentMindMap: null })
    } catch (error) {
      console.error('Failed to delete mind map:', error)
    }
  }
}))

// 진행률 리스너 설정
export function setupMindMapListeners() {
  return window.api.mindmap.onProgress((data) => {
    useMindMapStore.setState({
      generationProgress: { stage: data.stage, progress: data.progress }
    })
  })
}
