/**
 * 마인드맵 트리 노드 (순수 논리 구조, UI 정보 미포함)
 */
export interface MindMapTreeNode {
  id: string
  label: string // 노드 텍스트, 12자 이하
  children?: MindMapTreeNode[]
  metadata?: {
    level: number // 레벨: 0-3 (루트 노드는 0)
    chunkIds: string[] // 연관된 chunk ID
    keywords?: string[]
  }
}

/**
 * LLM이 생성한 원본 출력 형식
 */
export interface MindMapGenerationResult {
  rootNode: MindMapTreeNode
  chunkMapping: Record<string, string[]> // nodeId -> chunkIds
  metadata: {
    totalNodes: number
    maxDepth: number
  }
}
