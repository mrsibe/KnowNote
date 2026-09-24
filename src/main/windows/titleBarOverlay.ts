import type { BrowserWindow } from 'electron'
import type { AppSettings } from '../config'

/**
 * The OS draws the window controls (minimize / maximize / close) on top of our
 * custom title bar. The overlay fill is transparent, so the symbol colour has to
 * match the renderer: a white symbol on the light `#fafafa` title bar is
 * invisible. That is issue #26.
 */
export function titleBarSymbolColor(theme: AppSettings['theme']): 'white' | 'black' {
  return theme === 'dark' ? 'white' : 'black'
}

/** `titleBarOverlay` options for the transparent custom title bar (Windows/Linux). */
export function titleBarOverlayOptions(theme: AppSettings['theme']): {
  color: string
  height: number
  symbolColor: 'white' | 'black'
} {
  return { color: 'rgba(0,0,0,0)', height: 35, symbolColor: titleBarSymbolColor(theme) }
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
