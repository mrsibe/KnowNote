import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, ArrowUpDown, ArrowRightLeft, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toPng } from 'html-to-image'
import { useMindMapStore } from '../../store/mindmapStore'
import MindMapCanvas from '../notebook/mindmap/MindMapCanvas'
import NodeDetailPanel from '../notebook/mindmap/NodeDetailPanel'

export default function MindMapPage() {
  const { notebookId, mindMapId } = useParams<{ notebookId?: string; mindMapId?: string }>()
  const { t } = useTranslation('notebook')
  const { currentMindMap, isGenerating, loadLatestMindMap, loadMindMap } = useMindMapStore()

  const [isLoading, setIsLoading] = useState(true)
  const [direction, setDirection] = useState<'TB' | 'LR'>('LR')
  const [platform, setPlatform] = useState<string>('')
  const mindMapContainerRef = useRef<HTMLDivElement>(null)

  // 获取平台信息
  useEffect(() => {
    const getPlatform = async () => {
      try {
        const platformName = await window.api.getPlatform()
        setPlatform(platformName)
      } catch (error) {
        console.error('Failed to get platform:', error)
      }
    }
    getPlatform()
  }, [])

  // 加载思维导图
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true)
      try {
        if (mindMapId) {
          await loadMindMap(mindMapId)
        } else if (notebookId) {
          await loadLatestMindMap(notebookId)
        }
      } catch (error) {
        console.error('[MindMapPage] Failed to load mind map:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [notebookId, mindMapId, loadLatestMindMap, loadMindMap])

  // 切换布局方向
  const toggleDirection = () => {
    setDirection((prev) => (prev === 'LR' ? 'TB' : 'LR'))
  }

  // 导出思维导图为图片
  const handleExport = async () => {
    if (!mindMapContainerRef.current) return

    try {
      const reactFlowElement = mindMapContainerRef.current.querySelector('.react-flow')
      if (!reactFlowElement) return

      // 临时隐藏不需要导出的元素
      const background = reactFlowElement.querySelector('.react-flow__background')
      const controls = reactFlowElement.querySelector('.react-flow__controls')

      const originalBackgroundDisplay = background ? (background as HTMLElement).style.display : ''
      const originalControlsDisplay = controls ? (controls as HTMLElement).style.display : ''

      if (background) (background as HTMLElement).style.display = 'none'
      if (controls) (controls as HTMLElement).style.display = 'none'

      // 等待 DOM 更新
      await new Promise((resolve) => setTimeout(resolve, 100))

      // 获取 viewport 元素（包含所有节点和边的实际内容）
      const viewport = reactFlowElement.querySelector('.react-flow__viewport') as HTMLElement
      if (!viewport) return

      // 获取所有节点来计算边界
      const nodeElements = viewport.querySelectorAll('.react-flow__node')
      const edgeElements = viewport.querySelectorAll('.react-flow__edge')

      if (nodeElements.length === 0) return

      // 计算所有节点和边的边界框（基于 transform 属性）
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity

      // 处理节点
      nodeElements.forEach((node) => {
        const element = node as HTMLElement
        const transform = element.style.transform
        const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)

        if (match) {
          const x = parseFloat(match[1])
          const y = parseFloat(match[2])
          // 使用 offsetWidth/offsetHeight 获取元素的原始尺寸，不受缩放影响
          const width = element.offsetWidth
          const height = element.offsetHeight

          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x + width)
          maxY = Math.max(maxY, y + height)
        }
      })

      // 处理边（可能延伸到节点之外）
      edgeElements.forEach((edge) => {
        const element = edge as SVGGraphicsElement
        try {
          const bbox = element.getBBox()
          minX = Math.min(minX, bbox.x)
          minY = Math.min(minY, bbox.y)
          maxX = Math.max(maxX, bbox.x + bbox.width)
          maxY = Math.max(maxY, bbox.y + bbox.height)
        } catch {
          // 某些边元素可能无法获取 bbox，忽略即可
        }
      })

      // 添加边距
      const padding = 40
      minX -= padding
      minY -= padding
      maxX += padding
      maxY += padding

      const width = maxX - minX
      const height = maxY - minY

      // 临时调整 viewport 的 transform
      const originalTransform = viewport.style.transform
      viewport.style.transform = `translate(${-minX}px, ${-minY}px)`

      // 等待 transform 生效
      await new Promise((resolve) => setTimeout(resolve, 50))

      // 导出图片
      const dataUrl = await toPng(viewport, {
        cacheBust: true,
        backgroundColor: '#ffffff',
        quality: 1,
        width,
        height,
        style: {
          width: `${width}px`,
          height: `${height}px`
        }
      })

      // 恢复原始状态
      viewport.style.transform = originalTransform
      if (background) (background as HTMLElement).style.display = originalBackgroundDisplay
      if (controls) (controls as HTMLElement).style.display = originalControlsDisplay

      // 创建下载链接
      const link = document.createElement('a')
      link.download = `mindmap-${Date.now()}.png`
      link.href = dataUrl
      link.click()
    } catch (error) {
      console.error('[MindMapPage] Failed to export image:', error)

      // 确保恢复状态
      const reactFlowElement = mindMapContainerRef.current?.querySelector('.react-flow')
      if (reactFlowElement) {
        const background = reactFlowElement.querySelector('.react-flow__background')
        const controls = reactFlowElement.querySelector('.react-flow__controls')
        if (background) (background as HTMLElement).style.display = ''
        if (controls) (controls as HTMLElement).style.display = ''

        const viewport = reactFlowElement.querySelector('.react-flow__viewport') as HTMLElement
        if (viewport && viewport.style.transform !== undefined) {
          // 不修改 transform，让 ReactFlow 自己管理
        }
      }
    }
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-surface-base">
      {/* 顶部可拖拽标题栏 */}
      <div
        className="absolute top-0 left-0 right-0 h-11 z-10 flex items-center justify-between px-3 bg-surface-base border-b border-border"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* macOS 左侧空白区域（留给窗口控制按钮） */}
        {platform === 'darwin' && <div className="w-16"></div>}
        {/* 非 macOS 左侧空白区域 */}
        {platform !== 'darwin' && <div style={{ width: '100px' }}></div>}

        <span className="text-sm font-medium text-foreground">{t('mindMap')}</span>

        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {currentMindMap && (
            <>
              <button
                onClick={toggleDirection}
                className="p-1.5 rounded-md hover:bg-surface-hover transition-colors"
                title={direction === 'LR' ? '切换为垂直布局' : '切换为横向布局'}
              >
                {direction === 'LR' ? (
                  <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ArrowRightLeft className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
              <button
                onClick={handleExport}
                className="p-1.5 rounded-md hover:bg-surface-hover transition-colors"
                title="导出为图片"
              >
                <Download className="w-4 h-4 text-muted-foreground" />
              </button>
            </>
          )}
        </div>

        {/* Windows 右侧空白区域（留给窗口控制按钮） */}
        {platform === 'win32' && <div className="w-32"></div>}
      </div>

      {/* 内容区域 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
          paddingTop: '44px'
        }}
      >
        {isLoading ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            className="text-muted-foreground"
          >
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : currentMindMap ? (
          <>
            <div ref={mindMapContainerRef} style={{ flex: 1, position: 'relative' }}>
              <MindMapCanvas mindMap={currentMindMap} direction={direction} />
            </div>
            <NodeDetailPanel />
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            className="text-muted-foreground"
          >
            {isGenerating ? t('generatingMindMap') : t('noMindMapYet')}
          </div>
        )}
      </div>
    </div>
  )
}
