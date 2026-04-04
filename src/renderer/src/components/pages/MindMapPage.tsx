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

  // 조회플랫폼정보
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

  // 로드마인드맵
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

  // 전환레이아웃방방향
  const toggleDirection = () => {
    setDirection((prev) => (prev === 'LR' ? 'TB' : 'LR'))
  }

  // 내보내기마인드맵도조각
  const handleExport = async () => {
    if (!mindMapContainerRef.current) return

    try {
      const reactFlowElement = mindMapContainerRef.current.querySelector('.react-flow')
      if (!reactFlowElement) return

      // 임시시숨김숨김아닌필요내보내기의메타요소
      const background = reactFlowElement.querySelector('.react-flow__background')
      const controls = reactFlowElement.querySelector('.react-flow__controls')

      const originalBackgroundDisplay = background ? (background as HTMLElement).style.display : ''
      const originalControlsDisplay = controls ? (controls as HTMLElement).style.display : ''

      if (background) (background as HTMLElement).style.display = 'none'
      if (controls) (controls as HTMLElement).style.display = 'none'

      // 등대기 DOM 업데이트
      await new Promise((resolve) => setTimeout(resolve, 100))

      // 조회 viewport 메타요소（패키지포함모든노드및테두리의실제내용）
      const viewport = reactFlowElement.querySelector('.react-flow__viewport') as HTMLElement
      if (!viewport) return

      // 조회모든노드래계산테두리계
      const nodeElements = viewport.querySelectorAll('.react-flow__node')
      const edgeElements = viewport.querySelectorAll('.react-flow__edge')

      if (nodeElements.length === 0) return

      // 계산모든노드및테두리의테두리계프레임（기반 transform 속성）
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity

      // 처리노드
      nodeElements.forEach((node) => {
        const element = node as HTMLElement
        const transform = element.style.transform
        const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)

        if (match) {
          const x = parseFloat(match[1])
          const y = parseFloat(match[2])
          // 사용 offsetWidth/offsetHeight 조회메타요소의원본크기치수，아닌받축소방그림자영향
          const width = element.offsetWidth
          const height = element.offsetHeight

          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x + width)
          maxY = Math.max(maxY, y + height)
        }
      })

      // 처리테두리（지연확장에노드의외부）
      edgeElements.forEach((edge) => {
        const element = edge as SVGGraphicsElement
        try {
          const bbox = element.getBBox()
          minX = Math.min(minX, bbox.x)
          minY = Math.min(minY, bbox.y)
          maxX = Math.max(maxX, bbox.x + bbox.width)
          maxY = Math.max(maxY, bbox.y + bbox.height)
        } catch {
          // 어떤테두리메타요소없음방법조회 bbox，무시생략
        }
      })

      // 추가테두리거리
      const padding = 40
      minX -= padding
      minY -= padding
      maxX += padding
      maxY += padding

      const width = maxX - minX
      const height = maxY - minY

      // 임시시조정 viewport 의 transform
      const originalTransform = viewport.style.transform
      viewport.style.transform = `translate(${-minX}px, ${-minY}px)`

      // 등대기 transform 생효
      await new Promise((resolve) => setTimeout(resolve, 50))

      // 내보내기도조각
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

      // 복원원본상태
      viewport.style.transform = originalTransform
      if (background) (background as HTMLElement).style.display = originalBackgroundDisplay
      if (controls) (controls as HTMLElement).style.display = originalControlsDisplay

      // 생성다운로드체인접
      const link = document.createElement('a')
      link.download = `mindmap-${Date.now()}.png`
      link.href = dataUrl
      link.click()
    } catch (error) {
      console.error('[MindMapPage] Failed to export image:', error)

      // 보장복원상태
      const reactFlowElement = mindMapContainerRef.current?.querySelector('.react-flow')
      if (reactFlowElement) {
        const background = reactFlowElement.querySelector('.react-flow__background')
        const controls = reactFlowElement.querySelector('.react-flow__controls')
        if (background) (background as HTMLElement).style.display = ''
        if (controls) (controls as HTMLElement).style.display = ''

        const viewport = reactFlowElement.querySelector('.react-flow__viewport') as HTMLElement
        if (viewport && viewport.style.transform !== undefined) {
          // 아닌수정수정 transform， ReactFlow 자체자기관리
        }
      }
    }
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* 상단부분드래그제목바 */}
      <div
        className="absolute top-0 left-0 right-0 h-10 z-10 flex items-center justify-between px-4 bg-background"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* macOS 왼쪽빈공백영역（남겨둠윈도우제어버튼） */}
        {platform === 'darwin' && <div className="w-16"></div>}
        {/* 비 macOS 왼쪽빈공백영역 */}
        {platform !== 'darwin' && <div style={{ width: '100px' }}></div>}

        <span className="text-sm text-muted-foreground font-medium">{t('mindMap')}</span>

        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {currentMindMap && (
            <>
              <button
                onClick={toggleDirection}
                className="p-1.5 rounded hover:bg-accent transition-colors"
                title={direction === 'LR' ? '전환수직직접레이아웃' : '전환가로방향레이아웃'}
              >
                {direction === 'LR' ? (
                  <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ArrowRightLeft className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
              <button
                onClick={handleExport}
                className="p-1.5 rounded hover:bg-accent transition-colors"
                title="내보내기도조각"
              >
                <Download className="w-4 h-4 text-muted-foreground" />
              </button>
            </>
          )}
        </div>

        {/* Windows 오른쪽빈공백영역（남겨둠윈도우제어버튼） */}
        {platform === 'win32' && <div className="w-32"></div>}
      </div>

      {/* 내용영역 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
          paddingTop: '40px'
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
