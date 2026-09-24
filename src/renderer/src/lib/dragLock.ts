/**
 * Body-level lock for a pointer drag.
 *
 * A drag gesture that only tracks its own element has two failure modes, and
 * this module exists because KnowNote's panel resizer had both:
 *
 * 1. The page keeps its normal text-selection behaviour, so dragging past a
 *    panel's minimum width (where the panel stops moving but the pointer keeps
 *    moving) selects the text underneath. The browser started a native
 *    selection drag on `pointerdown`; nothing ever cancelled it.
 * 2. The cursor reverts to whatever is under the pointer the moment it leaves
 *    the handle, so the drag reads as "stuck" or "finished" even though it is
 *    still live.
 *
 * The lock is ref-counted so two overlapping locks cannot restore prematurely,
 * and it installs a capture-phase Escape handler so the drag can be abandoned
 * with the key users already expect to abandon things with.
 */

interface SavedBodyStyle {
  cursor: string
  userSelect: string
}

let lockCount = 0
let saved: SavedBodyStyle | null = null

/**
 * Hold the body in drag state until the returned release function runs.
 *
 * @param cursor the cursor to force for the duration of the drag
 * @param onCancel invoked when the user presses Escape; the caller should abort
 *   the gesture and then release the lock
 * @returns an idempotent release function
 */
export function lockDrag(cursor: string, onCancel: () => void): () => void {
  const { style } = document.body

  if (lockCount === 0) {
    saved = { cursor: style.cursor, userSelect: style.userSelect }
  }
  lockCount += 1

  style.cursor = cursor
  style.userSelect = 'none'

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    // Capture phase and stopPropagation: Escape must abandon the drag, not also
    // reach whatever else in the app listens for it.
    event.preventDefault()
    event.stopPropagation()
    onCancel()
  }
  document.addEventListener('keydown', onKeyDown, true)

  let released = false
  return () => {
    if (released) return
    released = true

    document.removeEventListener('keydown', onKeyDown, true)
    lockCount -= 1

    if (lockCount === 0 && saved) {
      style.cursor = saved.cursor
      style.userSelect = saved.userSelect
      saved = null
    }
  }
}
