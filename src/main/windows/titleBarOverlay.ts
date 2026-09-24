import type { BrowserWindow } from 'electron'
import type { AppSettings } from '../config'
import { TITLE_BAR_HEIGHT } from '../../shared/utils/windowChrome'

/**
 * The OS draws the window controls (minimize / maximize / close) on top of our
 * custom title bar. The overlay fill is transparent, so the symbol colour has to
 * match the renderer: a white symbol on the light `#fafafa` title bar is
 * invisible. That is issue #26.
 */
export function titleBarSymbolColor(theme: AppSettings['theme']): 'white' | 'black' {
  return theme === 'dark' ? 'white' : 'black'
}

/**
 * `titleBarOverlay` options for the transparent custom title bar (Windows/Linux).
 *
 * The OS sizes the drawn window controls to this region, so its height has to
 * equal the renderer's title bar — otherwise the controls do not line up with
 * the bar they sit in. That was the bug: 35px of controls under a 44px bar.
 */
export function titleBarOverlayOptions(theme: AppSettings['theme']): {
  color: string
  height: number
  symbolColor: 'white' | 'black'
} {
  return {
    color: 'rgba(0,0,0,0)',
    height: TITLE_BAR_HEIGHT,
    symbolColor: titleBarSymbolColor(theme)
  }
}

/** Re-colour the window controls after a theme change. macOS has no overlay. */
export function applyTitleBarTheme(window: BrowserWindow, theme: AppSettings['theme']): void {
  if (process.platform === 'darwin') return
  try {
    window.setTitleBarOverlay({ symbolColor: titleBarSymbolColor(theme) })
  } catch {
    // Older Electron builds may not implement setTitleBarOverlay.
  }
}
