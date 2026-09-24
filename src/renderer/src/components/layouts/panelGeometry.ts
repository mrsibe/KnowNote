/**
 * Panel geometry and resize intent for the three-zone workspace.
 *
 * These were inline in `ResizableLayout`, where the interesting arithmetic could
 * only be exercised by dragging a mouse. The arrow-key mapping in particular was
 * wrong in a way nothing could catch: `ArrowLeft` grew the left panel and shrank
 * the right one, so the two seams told a screen-reader user the opposite of what
 * they had pressed. It is pure arithmetic, so it lives here and is tested.
 */

/** Minimum width of a side panel, in CSS pixels. */
export const MIN_SIDE_WIDTH = 260
/** Minimum width of the centre panel, in CSS pixels. */
export const MIN_CENTER_WIDTH = 420
/** The seam is `w-3`. The canvas gutter between two panels is the handle, so it costs layout. */
export const HANDLE_WIDTH = 12
/** `p-2` on the container, both sides. */
export const CONTAINER_PADDING_X = 16
export const DEFAULT_LEFT_WIDTH = 320
export const DEFAULT_RIGHT_WIDTH = 360
export const KEYBOARD_STEP = 10
export const KEYBOARD_STEP_FAST = 50
export const STORAGE_KEY = 'knownote:panel-widths'

/** The sides start at the golden ratio of the free space. Documented in DESIGN.md. */
export const GOLDEN_RATIO = 1.618

export interface PanelWidths {
  left: number
  right: number
}

export type PanelSide = 'left' | 'right'

/** Space the panels and seams leave free inside a container of this width. */
export const availableFrom = (containerWidth: number): number =>
  Math.max(0, containerWidth - CONTAINER_PADDING_X - HANDLE_WIDTH * 2)

/**
 * The widest a side panel may become: everything except the other side panel and
 * the centre's minimum. The floor is `MIN_SIDE_WIDTH`, so a window too narrow for
 * both minimums degrades by letting the centre shrink rather than by clamping a
 * side panel to something unusable.
 */
export const maxSideWidth = (other: number, containerWidth: number): number =>
  Math.max(MIN_SIDE_WIDTH, availableFrom(containerWidth) - other - MIN_CENTER_WIDTH)

export const calculateGoldenRatioWidths = (containerWidth: number): PanelWidths => {
  const width = Math.floor(availableFrom(containerWidth) * (1 / (2 + GOLDEN_RATIO)))
  return { left: width, right: width }
}

/**
 * Validate a stored layout. Anything that is not two finite numbers is treated as
 * absent, so a corrupt or hand-edited entry degrades to the default split instead
 * of rendering a `NaN`-wide panel.
 */
export const parseStoredWidths = (raw: string | null): PanelWidths | null => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PanelWidths> | null
    if (!parsed || typeof parsed !== 'object') return null
    const { left, right } = parsed
    if (
      typeof left !== 'number' ||
      typeof right !== 'number' ||
      !Number.isFinite(left) ||
      !Number.isFinite(right)
    ) {
      return null
    }
    return { left, right }
  } catch {
    return null
  }
}

export const readStoredWidths = (): PanelWidths | null => {
  try {
    return parseStoredWidths(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

export const writeStoredWidths = (widths: PanelWidths): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
  } catch {
    // Persistence is a convenience; losing it must never break the layout.
  }
}

export type ResizeKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

const RESIZE_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'Home', 'End']

export const isResizeKey = (key: string): key is ResizeKey => RESIZE_KEYS.includes(key)

/**
 * The width a resize key produces.
 *
 * Arrow keys move the **seam**, not the panel: `ArrowLeft` shrinks the panel on
 * the left of the seam and grows the panel on the right of it. The same key
 * therefore has opposite effects on the two seams, and the panel a seam controls
 * is the one it reports. `Home` / `End` go to the minimum and maximum of that
 * value, on both seams.
 *
 * Returns `null` for a key that is not a resize key, and always returns a value
 * inside `[MIN_SIDE_WIDTH, max]`.
 */
export const nextPanelWidth = (
  key: ResizeKey,
  side: PanelSide,
  current: number,
  max: number,
  fast: boolean
): number => {
  const step = fast ? KEYBOARD_STEP_FAST : KEYBOARD_STEP
  const growsWithArrowRight = side === 'left'

  let next: number
  switch (key) {
    case 'ArrowLeft':
      next = current + (growsWithArrowRight ? -step : step)
      break
    case 'ArrowRight':
      next = current + (growsWithArrowRight ? step : -step)
      break
    case 'Home':
      next = MIN_SIDE_WIDTH
      break
    case 'End':
      next = max
      break
  }

  return Math.max(MIN_SIDE_WIDTH, Math.min(max, next))
}
