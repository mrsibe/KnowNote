import { ReactElement } from 'react'

export interface DragHandleProps {
  onMouseDown: () => void
}

export default function DragHandle({ onMouseDown }: DragHandleProps): ReactElement {
  return (
    <div
      className="w-3 shrink-0 cursor-col-resize transition-colors hover:bg-surface-hover"
      onMouseDown={onMouseDown}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    />
  )
}
