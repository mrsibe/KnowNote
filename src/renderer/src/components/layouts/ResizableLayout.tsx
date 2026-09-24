import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, ReactNode, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import DragHandle, { type DragHandleSide } from './DragHandle'
import { lockDrag } from '../../lib/dragLock'

export interface ResizableLayoutProps {
  leftPanel: ReactNode
  centerPanel: ReactNode
  rightPanel: ReactNode
  defaultLeftWidth?: number
  defaultRightWidth?: number
}

/** Minimum width of a side panel, in CSS pixels. */
const MIN_SIDE_WIDTH = 260
/** Minimum width of the centre panel, in CSS pixels. */
const MIN_CENTER_WIDTH = 420
/** The seam is `w-3`. The canvas gutter between two panels is the handle, so it costs layout. */
const HANDLE_WIDTH = 12
/** `p-2` on the container, both sides. */
const CONTAINER_PADDING_X = 16
const DEFAULT_LEFT_WIDTH = 320
const DEFAULT_RIGHT_WIDTH = 360
const KEYBOARD_STEP = 10
const KEYBOARD_STEP_FAST = 50
const STORAGE_KEY = 'knownote:panel-widths'

/** The sides start at the golden ratio of the free space. Documented in DESIGN.md. */
const GOLDEN_RATIO = 1.618

interface PanelWidths {
  left: number
  right: number
}

const readStoredWidths = (): PanelWidths | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PanelWidths>
    if (
      typeof parsed.left !== 'number' ||
      typeof parsed.right !== 'number' ||
      !Number.isFinite(parsed.left) ||
      !Number.isFinite(parsed.right)
    ) {
      return null
    }
    return { left: parsed.left, right: parsed.right }
  } catch {
    return null
  }
}

const writeStoredWidths = (widths: PanelWidths): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
  } catch {
    // Persistence is a convenience; losing it must never break the layout.
  }
}

/** Space the panels and seams leave free inside a container of this width. */
const availableFrom = (containerWidth: number): number =>
  Math.max(0, containerWidth - CONTAINER_PADDING_X - HANDLE_WIDTH * 2)

/**
 * The widest a side panel may become: everything except the other side panel and
 * the centre's minimum. The floor is `MIN_SIDE_WIDTH`, so a window too narrow for
 * both minimums degrades by letting the centre shrink rather than by clamping a
 * side panel to something unusable.
 */
const maxSideWidth = (other: number, containerWidth: number): number =>
  Math.max(MIN_SIDE_WIDTH, availableFrom(containerWidth) - other - MIN_CENTER_WIDTH)

const calculateGoldenRatioWidths = (containerWidth: number): PanelWidths => {
  const width = Math.floor(availableFrom(containerWidth) * (1 / (2 + GOLDEN_RATIO)))
  return { left: width, right: width }
}

interface DragSession {
  detach: (cancelled?: boolean) => void
}

export default function ResizableLayout({
  leftPanel,
  centerPanel,
  rightPanel,
  defaultLeftWidth,
  defaultRightWidth
}: ResizableLayoutProps): ReactElement {
  const { t } = useTranslation('ui')
  const containerRef = useRef<HTMLDivElement>(null)

  const [storedWidths] = useState<PanelWidths | null>(readStoredWidths)
  const [leftWidth, setLeftWidth] = useState(
    () => defaultLeftWidth ?? storedWidths?.left ?? DEFAULT_LEFT_WIDTH
  )
  const [rightWidth, setRightWidth] = useState(
    () => defaultRightWidth ?? storedWidths?.right ?? DEFAULT_RIGHT_WIDTH
  )
  const [containerWidth, setContainerWidth] = useState(0)
  const [draggingSide, setDraggingSide] = useState<DragHandleSide | null>(null)
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false)
  const [isRightCollapsed, setIsRightCollapsed] = useState(false)

  // Mirrors so the gesture and the keyboard handler never depend on a render.
  const leftWidthRef = useRef(leftWidth)
  const rightWidthRef = useRef(rightWidth)
  const containerWidthRef = useRef(0)
  const dragRef = useRef<DragSession | null>(null)
  const lastSizeRef = useRef<PanelWidths>({
    left: leftWidth || DEFAULT_LEFT_WIDTH,
    right: rightWidth || DEFAULT_RIGHT_WIDTH
  })
  const hasAppliedInitial = useRef(false)

  /** The single writer for panel widths: state and both mirrors move together. */
  const setPanelWidth = useCallback((side: DragHandleSide, value: number): void => {
    if (side === 'left') {
      leftWidthRef.current = value
      setLeftWidth(value)
    } else {
      rightWidthRef.current = value
      setRightWidth(value)
    }
  }, [])

  // Measure the container for as long as it exists. The previous version ran this
  // body only once (an `isInitialized` short-circuit), so the recorded width went
  // stale on the first window resize and everything derived from it was wrong.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      const width = entry?.borderBoxSize?.[0]?.inlineSize ?? container.getBoundingClientRect().width
      containerWidthRef.current = width
      setContainerWidth(width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Apply the starting split once the width is actually known.
  useEffect(() => {
    if (hasAppliedInitial.current || containerWidth <= 0) return
    hasAppliedInitial.current = true

    const golden = calculateGoldenRatioWidths(containerWidth)
    const initial: PanelWidths = {
      left: defaultLeftWidth ?? storedWidths?.left ?? golden.left,
      right: defaultRightWidth ?? storedWidths?.right ?? golden.right
    }
    lastSizeRef.current = initial
    setPanelWidth('left', Math.min(initial.left, maxSideWidth(initial.right, containerWidth)))
    setPanelWidth('right', Math.min(initial.right, maxSideWidth(initial.left, containerWidth)))
  }, [containerWidth, defaultLeftWidth, defaultRightWidth, storedWidths, setPanelWidth])

  // Keep the constraints true when the window resizes under a settled layout.
  useEffect(() => {
    if (containerWidth <= 0) return
    const left = leftWidthRef.current
    const right = rightWidthRef.current
    if (left <= 0 || right <= 0) return

    if (left > maxSideWidth(right, containerWidth)) {
      setPanelWidth('left', maxSideWidth(right, containerWidth))
    }
    if (right > maxSideWidth(left, containerWidth)) {
      setPanelWidth('right', maxSideWidth(left, containerWidth))
    }
  }, [containerWidth, setPanelWidth])

  /**
   * Own the whole gesture for its lifetime.
   *
   * Two things the previous implementation got wrong and this shape prevents: the
   * listeners live on `window`, so the drag always ends even when the button is
   * released over another window, and the constraints are snapshotted here, so no
   * layout is read while the pointer is moving.
   */
  const beginDrag = useCallback(
    (side: DragHandleSide, event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return
      const container = containerRef.current
      if (!container) return

      // Without this the browser starts a native selection drag, and dragging past
      // the panel's limit then selects the text underneath.
      event.preventDefault()

      dragRef.current?.detach()

      const rect = container.getBoundingClientRect()
      containerWidthRef.current = rect.width

      const startWidth = side === 'left' ? leftWidthRef.current : rightWidthRef.current
      const other = side === 'left' ? rightWidthRef.current : leftWidthRef.current
      const min = MIN_SIDE_WIDTH
      const max = maxSideWidth(other, rect.width)
      const startX = event.clientX

      let frame = 0
      let pending: number | null = null
      let finished = false

      const flush = (): void => {
        frame = 0
        if (pending === null) return
        setPanelWidth(side, pending)
        pending = null
      }

      const detach = (cancelled = false): void => {
        if (finished) return
        finished = true
        if (frame) window.cancelAnimationFrame(frame)
        frame = 0
        pending = null

        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        window.removeEventListener('blur', onUp)
        document.removeEventListener('visibilitychange', onVisibilityChange)

        release()
        dragRef.current = null
        setDraggingSide(null)

        if (cancelled) {
          setPanelWidth(side, startWidth)
        } else {
          lastSizeRef.current = { left: leftWidthRef.current, right: rightWidthRef.current }
          writeStoredWidths(lastSizeRef.current)
        }
      }

      function onMove(moveEvent: PointerEvent): void {
        if (finished) return
        // The button can be released while another window holds focus: no
        // `pointerup` arrives and no `pointerleave` fires either, because the
        // pointer never left this element. Without this check the panel keeps
        // following the pointer with no button held.
        if (moveEvent.buttons === 0) {
          detach()
          return
        }

        const delta = moveEvent.clientX - startX
        const raw = side === 'left' ? startWidth + delta : startWidth - delta
        pending = Math.max(min, Math.min(max, raw))

        // Coalesce a burst of pointer events into one render per frame.
        if (!frame) frame = window.requestAnimationFrame(flush)
      }

      function onUp(): void {
        if (finished) return
        if (frame) window.cancelAnimationFrame(frame)
        flush()
        detach()
      }

      function onVisibilityChange(): void {
        if (document.hidden) onUp()
      }

      const release = lockDrag('col-resize', () => {
        if (frame) window.cancelAnimationFrame(frame)
        detach(true)
      })

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      window.addEventListener('blur', onUp)
      document.addEventListener('visibilitychange', onVisibilityChange)

      dragRef.current = { detach }
      setDraggingSide(side)
    },
    [setPanelWidth]
  )

  useEffect(() => {
    return () => {
      dragRef.current?.detach(true)
    }
  }, [])

  const handleKeyDown = useCallback(
    (side: DragHandleSide, event: React.KeyboardEvent<HTMLDivElement>): void => {
      const step = event.shiftKey ? KEYBOARD_STEP_FAST : KEYBOARD_STEP
      const current = side === 'left' ? leftWidthRef.current : rightWidthRef.current
      const other = side === 'left' ? rightWidthRef.current : leftWidthRef.current
      const max = maxSideWidth(other, containerWidthRef.current)
      // The seam moves in the direction of the arrow, so the panel it resizes moves
      // the other way: ArrowLeft shrinks the panel on the left of the seam and
      // grows the panel on the right of it. Getting this backwards made the two
      // separators report opposite value changes for the same key.
      const growsWithArrowRight = side === 'left'

      let next: number | null = null
      if (event.key === 'ArrowLeft') next = current + (growsWithArrowRight ? -step : step)
      else if (event.key === 'ArrowRight') next = current + (growsWithArrowRight ? step : -step)
      else if (event.key === 'Home') next = MIN_SIDE_WIDTH
      else if (event.key === 'End') next = max

      if (next === null) return
      event.preventDefault()

      setPanelWidth(side, Math.max(MIN_SIDE_WIDTH, Math.min(max, next)))
      lastSizeRef.current = { left: leftWidthRef.current, right: rightWidthRef.current }
      writeStoredWidths(lastSizeRef.current)
    },
    [setPanelWidth]
  )

  /**
   * Double-click restores this panel to its default share. Persistence without a
   * way back is a trap: one bad drag kept a 260px reading pane forever.
   */
  const resetPanel = useCallback(
    (side: DragHandleSide): void => {
      const golden = calculateGoldenRatioWidths(containerWidthRef.current)
      const other = side === 'left' ? rightWidthRef.current : leftWidthRef.current
      const target = side === 'left' ? golden.left : golden.right
      setPanelWidth(
        side,
        Math.max(MIN_SIDE_WIDTH, Math.min(maxSideWidth(other, containerWidthRef.current), target))
      )
      lastSizeRef.current = { left: leftWidthRef.current, right: rightWidthRef.current }
      writeStoredWidths(lastSizeRef.current)
    },
    [setPanelWidth]
  )

  const toggleLeftPanel = useCallback((): void => {
    setIsLeftCollapsed((collapsed) => {
      if (!collapsed) {
        lastSizeRef.current = { ...lastSizeRef.current, left: leftWidthRef.current }
        setPanelWidth('left', 0)
      } else {
        setPanelWidth('left', lastSizeRef.current.left || DEFAULT_LEFT_WIDTH)
      }
      return !collapsed
    })
  }, [setPanelWidth])

  const toggleRightPanel = useCallback((): void => {
    setIsRightCollapsed((collapsed) => {
      if (!collapsed) {
        lastSizeRef.current = { ...lastSizeRef.current, right: rightWidthRef.current }
        setPanelWidth('right', 0)
      } else {
        setPanelWidth('right', lastSizeRef.current.right || DEFAULT_RIGHT_WIDTH)
      }
      return !collapsed
    })
  }, [setPanelWidth])

  // Stable, so a drag frame does not hand the centre panel a new element.
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
    <div ref={containerRef} className="flex flex-1 overflow-hidden p-2">
      {!isLeftCollapsed && (
        <div className="h-full min-w-0 shrink-0 overflow-hidden" style={{ width: leftWidth }}>
          {leftPanel}
        </div>
      )}

      {!isLeftCollapsed && (
        <DragHandle
          side="left"
          value={leftWidth}
          min={MIN_SIDE_WIDTH}
          max={maxSideWidth(rightWidth, containerWidth)}
          dragging={draggingSide === 'left'}
          onPointerDown={(event) => beginDrag('left', event)}
          onKeyDown={(event) => handleKeyDown('left', event)}
          onDoubleClick={() => resetPanel('left')}
          label={t('resizeKnowledgeBase')}
        />
      )}

      <div className="h-full min-w-0 flex-1 overflow-hidden">
        {React.cloneElement(centerPanel as ReactElement, centerPanelProps)}
      </div>

      {!isRightCollapsed && (
        <DragHandle
          side="right"
          value={rightWidth}
          min={MIN_SIDE_WIDTH}
          max={maxSideWidth(leftWidth, containerWidth)}
          dragging={draggingSide === 'right'}
          onPointerDown={(event) => beginDrag('right', event)}
          onKeyDown={(event) => handleKeyDown('right', event)}
          onDoubleClick={() => resetPanel('right')}
          label={t('resizeCreativeSpace')}
        />
      )}

      {!isRightCollapsed && (
        <div className="h-full min-w-0 shrink-0 overflow-hidden" style={{ width: rightWidth }}>
          {rightPanel}
        </div>
      )}
    </div>
  )
}
