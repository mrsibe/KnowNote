import * as React from 'react'
import { useEffect, useRef, useState, useCallback, useMemo, ReactNode, ReactElement } from 'react'
import DragHandle from './DragHandle'

export interface ResizableLayoutProps {
  leftPanel: ReactNode
  centerPanel: ReactNode
  rightPanel: ReactNode
  defaultLeftWidth?: number
  defaultRightWidth?: number
}

// 황금 비율상수
const GOLDEN_RATIO = 1.618
const MIN_SIDE_WIDTH = 260
const MIN_CENTER_WIDTH = 420
const DRAG_HANDLE_WIDTH = 12 // w-3
const CONTAINER_PADDING_X = 16 // p-2 왼오른총및

const calculateGoldenRatioWidths = (containerWidth: number) => {
  const availableWidth = containerWidth - CONTAINER_PADDING_X - DRAG_HANDLE_WIDTH * 2
  const totalRatio = 2 + GOLDEN_RATIO
  const sideRatio = 1 / totalRatio
  const leftWidth = Math.floor(availableWidth * sideRatio)
  const rightWidth = Math.floor(availableWidth * sideRatio)
  return { leftWidth, rightWidth }
}

export default function ResizableLayout({
  leftPanel,
  centerPanel,
  rightPanel,
  defaultLeftWidth,
  defaultRightWidth
}: ResizableLayoutProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth || 320)
  const [rightWidth, setRightWidth] = useState(defaultRightWidth || 360)
  const [isDraggingLeft, setIsDraggingLeft] = useState(false)
  const [isDraggingRight, setIsDraggingRight] = useState(false)
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false)
  const [isRightCollapsed, setIsRightCollapsed] = useState(false)
  const lastLeftSizeRef = useRef<number | null>(null)
  const lastRightSizeRef = useRef<number | null>(null)
  const [containerWidth, setContainerWidth] = useState<number>(0)

  useEffect(() => {
    const updateWidths = () => {
      if (!containerRef.current || isInitialized) return
      const containerW = containerRef.current.getBoundingClientRect().width
      setContainerWidth(containerW)
      const { leftWidth: goldenLeftWidth, rightWidth: goldenRightWidth } =
        calculateGoldenRatioWidths(containerW)
      setLeftWidth(defaultLeftWidth || goldenLeftWidth)
      setRightWidth(defaultRightWidth || goldenRightWidth)
      setIsInitialized(true)
    }

    if (!containerRef.current) return

    const resizeObserver = new ResizeObserver(() => {
      updateWidths()
    })
    resizeObserver.observe(containerRef.current)

    return () => resizeObserver.disconnect()
  }, [defaultLeftWidth, defaultRightWidth, isInitialized])

  const handleMouseDown = (side: 'left' | 'right') => {
    if (side === 'left') {
      setIsDraggingLeft(true)
    } else {
      setIsDraggingRight(true)
    }
  }

  const handleMouseMove = (event: React.MouseEvent) => {
    if (!containerRef.current) return

    const containerRect = containerRef.current.getBoundingClientRect()
    const containerWidth = containerRect.width - CONTAINER_PADDING_X
    const leftVisible = !isLeftCollapsed
    const rightVisible = !isRightCollapsed
    const handlesWidth =
      (leftVisible ? 1 : 0) * DRAG_HANDLE_WIDTH + (rightVisible ? 1 : 0) * DRAG_HANDLE_WIDTH
    const effectiveLeftWidth = leftVisible ? leftWidth : 0
    const effectiveRightWidth = rightVisible ? rightWidth : 0

    if (isDraggingLeft && leftVisible) {
      const mouseX = event.clientX - containerRect.left - CONTAINER_PADDING_X / 2
      const maxLeftWidth = containerWidth - effectiveRightWidth - MIN_CENTER_WIDTH - handlesWidth
      const newWidth = Math.max(MIN_SIDE_WIDTH, Math.min(maxLeftWidth, mouseX))
      setLeftWidth(newWidth)
    }

    if (isDraggingRight && rightVisible) {
      const mouseX = containerRect.right - event.clientX - CONTAINER_PADDING_X / 2
      const maxRightWidth = containerWidth - effectiveLeftWidth - MIN_CENTER_WIDTH - handlesWidth
      const newWidth = Math.max(MIN_SIDE_WIDTH, Math.min(maxRightWidth, mouseX))
      setRightWidth(newWidth)
    }
  }

  const handleMouseUp = () => {
    setIsDraggingLeft(false)
    setIsDraggingRight(false)
  }

  const toggleLeftPanel = useCallback(() => {
    setIsLeftCollapsed((prev) => {
      if (!prev) {
        // 접기，저장현재너비
        lastLeftSizeRef.current = leftWidth
      }
      return !prev
    })
  }, [leftWidth])

  const toggleRightPanel = useCallback(() => {
    setIsRightCollapsed((prev) => {
      if (!prev) {
        // 접기，저장현재너비
        lastRightSizeRef.current = rightWidth
      }
      return !prev
    })
  }, [rightWidth])

  //  collapse 상태변경시실행행실제 resize，보장형식이미앱
  useEffect(() => {
    if (!containerRef.current) return
    const raf = requestAnimationFrame(() => {
      if (isLeftCollapsed) {
        setLeftWidth(0)
      } else if (lastLeftSizeRef.current) {
        setLeftWidth(lastLeftSizeRef.current)
      }

      if (isRightCollapsed) {
        setRightWidth(0)
      } else if (lastRightSizeRef.current) {
        setRightWidth(lastRightSizeRef.current)
      }
    })

    return () => cancelAnimationFrame(raf)
  }, [isLeftCollapsed, isRightCollapsed])

  // Memoize the center panel props to avoid ref access warnings
  const centerPanelProps = useMemo(
    () => ({
      onToggleLeft: toggleLeftPanel,
      onToggleRight: toggleRightPanel,
      isLeftCollapsed,
      isRightCollapsed
    }),
    [toggleLeftPanel, toggleRightPanel, isLeftCollapsed, isRightCollapsed]
  )

  return (
    <div
      ref={containerRef}
      className="flex flex-1 overflow-hidden p-2"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {!isLeftCollapsed && (
        <div
          className="h-full overflow-hidden"
          style={{
            width: `${leftWidth}px`,
            minWidth: containerWidth
              ? `${(MIN_SIDE_WIDTH / containerWidth) * 100}%`
              : `${MIN_SIDE_WIDTH}px`
          }}
        >
          {leftPanel}
        </div>
      )}

      {!isLeftCollapsed && <DragHandle onMouseDown={() => handleMouseDown('left')} />}

      <div
        className="flex-1 h-full overflow-hidden"
        style={
          MIN_CENTER_WIDTH > 0
            ? {
                minWidth: containerWidth
                  ? `${(MIN_CENTER_WIDTH / containerWidth) * 100}%`
                  : `${MIN_CENTER_WIDTH}px`
              }
            : undefined
        }
      >
        {/* eslint-disable-next-line react-hooks/refs */}
        {React.cloneElement(centerPanel as ReactElement, centerPanelProps as any)}
      </div>

      {!isRightCollapsed && <DragHandle onMouseDown={() => handleMouseDown('right')} />}

      {!isRightCollapsed && (
        <div
          className="h-full overflow-hidden"
          style={{
            width: `${rightWidth}px`,
            minWidth: containerWidth
              ? `${(MIN_SIDE_WIDTH / containerWidth) * 100}%`
              : `${MIN_SIDE_WIDTH}px`
          }}
        >
          {rightPanel}
        </div>
      )}
    </div>
  )
}
