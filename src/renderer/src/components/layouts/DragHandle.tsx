import * as React from 'react'
import { ReactElement } from 'react'
import { cn } from '@/lib/utils'

export type DragHandleSide = 'left' | 'right'

export interface DragHandleProps {
  /** Which panel this handle resizes. */
  side: DragHandleSide
  /** Current width of that panel, in CSS pixels. */
  value: number
  min: number
  max: number
  /** True while this handle owns the active drag. */
  dragging: boolean
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  /** Screen-reader label, e.g. "Resize the knowledge base panel". */
  label: string
}

/**
 * The seam between two workspace panels.
 *
 * It draws a 1px hairline and carries a 12px invisible hit area, rather than
 * being a 12px invisible strip: the seam is chrome (DESIGN.md keeps panel
 * separation to a hairline) while the target stays comfortable. `z-10` puts the
 * hit area above the neighbouring panel so the target is not clipped on the
 * side the panel is painted over.
 *
 * It is a real `separator`: focusable, arrow-resizable, and it reports its
 * value, so the layout is not mouse-only.
 */
export default function DragHandle({
  side,
  value,
  min,
  max,
  dragging,
  onPointerDown,
  onKeyDown,
  label
}: DragHandleProps): ReactElement {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-handle={side}
      data-dragging={dragging || undefined}
      className={cn(
        'group relative z-10 w-px shrink-0 cursor-col-resize bg-border transition-colors',
        // 12px hit area centred on the 1px seam
        'after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 after:content-[""]',
        'hover:bg-ring focus-visible:bg-ring focus-visible:outline-none',
        'data-[dragging]:bg-ring'
      )}
      style={
        {
          WebkitAppRegion: 'no-drag',
          // Stop the browser claiming the gesture for scroll/pan on touch and pen.
          touchAction: 'none'
        } as React.CSSProperties
      }
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )
}
