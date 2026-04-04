import { useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Position
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import * as dagre from '@dagrejs/dagre'
import { useMindMapStore } from '../../../store/mindmapStore'
import CustomNode, { CustomNodeData } from './CustomNode'
import type { MindMap } from '../../../../../main/db/schema'
import type { MindMapTreeNode } from '../../../../../shared/types/mindmap'

// 노드크기치수설정
const NODE_WIDTH = 150
const NODE_HEIGHT = 50

// 사용 Dagre 계산방법레이아웃노드
function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'LR'
): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))

  const isHorizontal = direction === 'LR'

  // 설정도의레이아웃방방향
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 100, // 동하나계층노드의간격의간격거리
    ranksep: 250, // 다른계층의간격의간격거리
    marginx: 50,
    marginy: 50
  })

  // 추가노드에 dagre 도
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  })

  // 추가테두리에 dagre 도
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  // 계산레이아웃
  dagre.layout(dagreGraph)

  // 업데이트노드위치및연결점방방향
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    return {
      ...node,
      targetPosition: (isHorizontal ? Position.Left : Position.Top) as Position,
      sourcePosition: (isHorizontal ? Position.Right : Position.Bottom) as Position,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2
      }
    }
  })

  return { nodes: layoutedNodes, edges }
}

// 트리결구조변환 React Flow 의 nodes 및 edges
function treeToFlowElements(
  mindMap: MindMap,
  direction: 'TB' | 'LR' = 'LR'
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  // Drizzle ORM 이미자동처리 JSON 파싱，없음필요수동 JSON.parse
  const treeData = mindMap.treeData as unknown as MindMapTreeNode

  function traverse(node: MindMapTreeNode, level: number, parentId: string | null) {
    nodes.push({
      id: node.id,
      type: 'custom',
      position: { x: 0, y: 0 }, // 초기시작위치，유 dagre 계산
      data: { label: node.label, level, direction, metadata: node.metadata } as CustomNodeData
      // sourcePosition 및 targetPosition  getLayoutedElements 에서설정
    })

    if (parentId) {
      edges.push({
        id: `${parentId}-${node.id}`,
        source: parentId,
        target: node.id,
        type: 'simplebezier',
        animated: false,
        style: {
          stroke: 'var(--muted-foreground)',
          strokeWidth: 2
        },
        markerEnd: {
          type: 'arrowclosed',
          color: 'var(--muted-foreground)'
        }
      })
    }

    if (node.children && node.children.length > 0) {
      node.children.forEach((child) => {
        traverse(child, level + 1, node.id)
      })
    }
  }

  traverse(treeData, 0, null)

  // 사용 Dagre 계산방법계산레이아웃
  return getLayoutedElements(nodes, edges, direction)
}

interface MindMapCanvasProps {
  mindMap: MindMap
  direction?: 'TB' | 'LR'
}

export default function MindMapCanvas({ mindMap, direction = 'LR' }: MindMapCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const { loadNodeChunks } = useMindMapStore()

  // 정의자체정의노드타입
  const nodeTypes = useMemo(() => ({ custom: CustomNode }), [])

  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = treeToFlowElements(mindMap, direction)
    setNodes(newNodes)
    setEdges(newEdges)
  }, [mindMap, direction, setNodes, setEdges])

  const handleNodeClick = async (_: React.MouseEvent, node: Node) => {
    await loadNodeChunks(mindMap.id, node.id)
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden'
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{
          padding: 0.2,
          minZoom: 0.1,
          maxZoom: 1.5
        }}
        minZoom={0.1}
        maxZoom={2}
        preventScrolling={true}
        defaultEdgeOptions={{
          type: 'simplebezier',
          animated: false,
          style: { stroke: 'var(--muted-foreground)', strokeWidth: 2 }
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls
          showInteractive={false}
          position="bottom-left"
          style={{
            bottom: '20px',
            left: '20px'
          }}
        />
      </ReactFlow>
    </div>
  )
}
