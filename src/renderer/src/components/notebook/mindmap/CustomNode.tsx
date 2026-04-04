import { memo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'

export interface CustomNodeData extends Record<string, unknown> {
  label: string
  level: number
  direction?: 'TB' | 'LR'
  metadata?: {
    level: number
    chunkIds: string[]
    keywords?: string[]
  }
}

function CustomNode({ data, sourcePosition, targetPosition }: NodeProps) {
  const nodeData = data as CustomNodeData
  const level = nodeData.level || 0

  // 기반으로계층선택다른의형식
  const getNodeStyle = (level: number) => {
    const baseStyle = {
      padding: '12px 20px',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: 500,
      minWidth: '120px',
      textAlign: 'center' as const,
      border: '2px solid',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
      transition: 'all 0.2s ease',
      cursor: 'pointer'
    }

    // 다른계층사용다른의차트색상
    switch (level) {
      case 0: // 루트 노드 - 사용메인색
        return {
          ...baseStyle,
          backgroundColor: 'var(--primary)',
          borderColor: 'var(--primary)',
          color: 'var(--primary-foreground)',
          fontWeight: 600,
          fontSize: '15px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
        }
      case 1: // 첫 번째레이어 - 파랑색
        return {
          ...baseStyle,
          backgroundColor: 'var(--chart-1)',
          borderColor: 'var(--chart-1)',
          color: 'var(--primary-foreground)'
        }
      case 2: // 번째2레이어 - 녹색색
        return {
          ...baseStyle,
          backgroundColor: 'var(--chart-2)',
          borderColor: 'var(--chart-2)',
          color: 'var(--primary-foreground)'
        }
      case 3: // 번째세레이어 - 빨강색
        return {
          ...baseStyle,
          backgroundColor: 'var(--chart-3)',
          borderColor: 'var(--chart-3)',
          color: 'var(--primary-foreground)'
        }
      case 4: // 번째네레이어 - 노란색
        return {
          ...baseStyle,
          backgroundColor: 'var(--chart-4)',
          borderColor: 'var(--chart-4)',
          color: 'var(--primary-foreground)'
        }
      default: // 번째다섯레이어및이상 - 보라색
        return {
          ...baseStyle,
          backgroundColor: 'var(--chart-5)',
          borderColor: 'var(--chart-5)',
          color: 'var(--primary-foreground)',
          fontSize: '13px'
        }
    }
  }

  return (
    <div style={getNodeStyle(level)}>
      <Handle
        type="target"
        position={targetPosition || Position.Left}
        style={{ opacity: 0 }}
        isConnectable={false}
      />
      {nodeData.label}
      <Handle
        type="source"
        position={sourcePosition || Position.Right}
        style={{ opacity: 0 }}
        isConnectable={false}
      />
    </div>
  )
}

export default memo(CustomNode)
