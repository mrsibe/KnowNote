import * as React from 'react'
import { ReactElement, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { isMac } from '../../lib/platform'
import {
  MAC_TRAFFIC_LIGHTS_WIDTH,
  WINDOW_CONTROLS_WIDTH
} from '../../../../shared/utils/windowChrome'

interface WindowTitleBarProps {
  /** Content after the macOS traffic-light reserve. */
  left?: ReactNode
  /** Takes the remaining width. Centred unless the child grows to fill it. */
  center?: ReactNode
  /** Content before the Windows/Linux window-control reserve. */
  right?: ReactNode
  /** Float over the content area instead of taking a row in a flex column. */
  overlay?: boolean
  className?: string
}

/**
 * The draggable title bar every window draws under the OS window controls.
 *
 * All four windows (main, mind map, quiz, Anki) run `titleBarStyle: 'hidden'`
 * with a `titleBarOverlay`, so the OS paints minimize/maximize/close on top of
 * whatever the renderer draws here. That makes the reserved geometry part of
 * the contract, not a styling detail: each window had grown its own copy of it
 * and they had drifted — 100px, 128px and 0 for the same reserve — so on
 * Windows the controls sat over the content and on Linux two windows reserved
 * nothing at all. The reserves now come from windowChrome.ts.
 *
 * The bar is `surface-base`, the same tone as the workspace canvas, in all four
 * windows. It is the OS window frame, not a panel, so it takes no surface step;
 * the optional `border-b` separates it from full-bleed content.
 */
export default function WindowTitleBar({
  left,
  center,
  right,
  overlay = false,
  className
}: WindowTitleBarProps): ReactElement {
  return (
    <div
      className={cn(
        'flex h-11 items-center gap-2 bg-surface-base',
        overlay ? 'absolute inset-x-0 top-0 z-10 px-3' : 'shrink-0 px-2',
        className
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {isMac() && (
        <div className="shrink-0" style={{ width: MAC_TRAFFIC_LIGHTS_WIDTH }} aria-hidden="true" />
      )}

      {left}

      {center && <div className="flex min-w-0 flex-1 items-center justify-center">{center}</div>}

      {right}

      {!isMac() && (
        <div className="shrink-0" style={{ width: WINDOW_CONTROLS_WIDTH }} aria-hidden="true" />
      )}
    </div>
  )
}
