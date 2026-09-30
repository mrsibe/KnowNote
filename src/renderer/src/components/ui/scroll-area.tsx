'use client'

import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'

import { cn } from '@/lib/utils'

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    /**
     * The scrolling element itself. Radix owns the viewport, so pass a ref here
     * when you need to read or set scroll position instead of querying for it.
     */
    viewportRef?: React.Ref<React.ElementRef<typeof ScrollAreaPrimitive.Viewport>>
  }
>(({ className, children, viewportRef, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn('relative overflow-hidden', className)}
    {...props}
  >
    {/*
     * Radix wraps `children` in an inner `min-width: 100%; display: table` box.
     * A table shrink-wraps to its content's min-content width, so a `truncate`
     * row with a fixed-width control beside it makes that box wider than the
     * viewport at the panel's minimum width: the row then overflows over the
     * list's own right padding (and under the scrollbar). Force the box back to
     * a normal block so children are constrained to the viewport instead. The
     * `!` is required because Radix writes both properties inline.
     */}
    <ScrollAreaPrimitive.Viewport
      ref={viewportRef}
      className="h-full w-full [&>div]:!block [&>div]:!min-w-0"
    >
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      'flex touch-none select-none transition-colors',
      // 8px track and a 4px painted pill, the same geometry `.themed-scrollbar`
      // draws with `border: 2px solid transparent; background-clip: content-box`.
      // The two scroll surfaces must not drift: a Radix `ScrollArea` and an
      // `overflow-y-auto themed-scrollbar` are the same control to the reader.
      orientation === 'vertical' && 'h-full w-2',
      orientation === 'horizontal' && 'h-2 flex-col',
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full border-2 border-transparent bg-clip-content bg-muted-foreground hover:bg-foreground" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
