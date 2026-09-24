import * as React from 'react'
import { cn } from '@/lib/utils'

interface PanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  left?: React.ReactNode
  center?: React.ReactNode
  right?: React.ReactNode
  draggable?: boolean
}

const PanelHeader = React.forwardRef<HTMLDivElement, PanelHeaderProps>(
  ({ left, center, right, draggable, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'h-11 flex items-center justify-between gap-2 px-3 border-b border-border shrink-0',
          className
        )}
        style={draggable ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : undefined}
        {...props}
      >
        {left && <div className="flex items-center gap-2 min-w-0">{left}</div>}
        {center && <div className="flex-1 flex items-center justify-center min-w-0">{center}</div>}
        {right && <div className="flex items-center gap-2 min-w-0">{right}</div>}
      </div>
    )
  }
)
PanelHeader.displayName = 'PanelHeader'

export { PanelHeader }
