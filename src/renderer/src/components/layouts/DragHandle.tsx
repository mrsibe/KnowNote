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
 * Its width is **layout, not decoration**: the canvas gutter between two panels
 * *is* the handle, which is why `HANDLE_WIDTH` is subtracted from the space the
 * panels may occupy. Painting it, or shrinking it toward a hairline, closes the
 * gutter between the panels — the panels are separate cards floating on
 * `surface-base`, not adjacent surfaces sharing a divider.
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
        'w-3 shrink-0 cursor-col-resize bg-transparent transition-colors',
        'hover:bg-surface-hover data-[dragging]:bg-surface-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
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
