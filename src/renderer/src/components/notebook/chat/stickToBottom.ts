/**
 * The arithmetic behind the transcript's follow-the-answer behaviour.
 *
 * Kept out of the component for the same reason `panelGeometry` is: the numbers
 * decide whether a streaming answer drags the reader along, and the only way to
 * exercise them by hand is to scroll a mouse while a model talks. The rules are
 * pure, so they can be asserted directly.
 */

/** How close to the bottom still counts as "following the answer". */
export const PINNED_THRESHOLD = 48

/**
 * The viewport's distance from the true bottom is `scrollHeight - scrollTop -
 * clientHeight`, but sub-pixel layout and font metrics can make that a small
 * negative number at the end. Clamp it: a negative distance is "at the bottom",
 * never "past it".
 */
export interface ScrollMetrics {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

/** Pixels between the current position and the true bottom; never negative. */
export function distanceToBottom(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight)
}

/**
 * Whether the reader is close enough to the bottom to keep following. Compared
 * against a distance rather than `scrollTop + clientHeight === scrollHeight`:
 * that equality is false under fractional pixels and reflows even when the view
 * is visibly at the end.
 */
export function isPinnedToBottom(metrics: ScrollMetrics, threshold = PINNED_THRESHOLD): boolean {
  return distanceToBottom(metrics) <= threshold
}

/**
 * The composer floats over the transcript, so the transcript reserves this much
 * space below its last message. `ProcessPanel` measures the real composer and
 * writes the value here; the fallbacks apply before the first measurement and
 * anywhere `MessageList` is rendered without one.
 */
export const COMPOSER_RESERVE_VAR = '--composer-reserve'

/** Gap between the last message and the top of the floating composer. */
export const COMPOSER_GAP = 24

/**
 * Reserve used until the composer reports its height.
 *
 * The composer's outer height is the wrapper's `p-4` (32) plus the scope row
 * (28) plus the textarea's `min-h-[56px]` plus the hairline (2). The value is
 * deliberately the one with the scope row: the reserve only has to be large
 * enough, and over-reserving leaves a gap while under-reserving hides the last
 * line of an answer behind the composer.
 */
export const COMPOSER_RESERVE_FALLBACK = 120

/** Gap between the back-to-bottom button's lower edge and the composer's top. */
export const BACK_TO_BOTTOM_GAP = 8

/**
 * Inline `bottom` for the back-to-bottom control. The reserve runs from the
 * viewport bottom to the composer's top plus `COMPOSER_GAP`, so the button sits
 * `BACK_TO_BOTTOM_GAP` above the composer.
 */
export const BACK_TO_BOTTOM_BOTTOM = `calc(var(${COMPOSER_RESERVE_VAR}, ${COMPOSER_RESERVE_FALLBACK}px) - ${COMPOSER_GAP + BACK_TO_BOTTOM_GAP}px)`

/** Inline `padding-bottom` reserving the composer's space in the transcript. */
export const COMPOSER_RESERVE = `var(${COMPOSER_RESERVE_VAR}, ${COMPOSER_RESERVE_FALLBACK}px)`
