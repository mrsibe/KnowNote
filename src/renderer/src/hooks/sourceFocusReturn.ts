/**
 * Where focus returns when the reader closes (#65, B1).
 *
 * Opening a citation moves focus out of the transcript and into the reader. If
 * closing the reader dropped focus on `<body>`, a keyboard user would lose their
 * place in a long answer and have to Tab back from the top of the document.
 *
 * So the element that opened the reader is remembered here, and the reader's back
 * action puts focus back on it. This is deliberately **not** "Escape always
 * focuses the composer": returning to the exact origin is what makes the path
 * accessible, and the composer is only the fallback for readers opened without
 * an origin (a deep link, a restored session, a reload).
 *
 * The state is module-level, not a store: it is a one-shot handoff between the
 * click and the close, it must not survive a re-render as UI state, and it must
 * not be observable by anything else. `appendExcerptCommand` uses the same
 * pattern for the same reason.
 */

/**
 * The part of an element this module needs. Kept structural rather than
 * `HTMLElement` so the handoff can be tested without a DOM; a real element
 * satisfies it.
 */
export interface FocusableOrigin {
  readonly isConnected: boolean
  focus: () => void
}

let origin: FocusableOrigin | null = null

/**
 * Record what opened the reader. `null` clears the memory, so a later close does
 * not restore focus to a stale element from a previous visit.
 */
export function rememberSourceOrigin(next: FocusableOrigin | null | undefined): void {
  origin = next ?? null
}

/**
 * Focus the remembered origin and clear it. Returns `false` when there is nothing
 * to focus or the element has since been unmounted (for example, opening a source
 * from the reader replaced the list the origin lived in). The caller decides the
 * fallback; it is not this module's job to know that the chat composer exists.
 */
export function restoreSourceOriginFocus(): boolean {
  const target = origin
  origin = null

  if (!target || !target.isConnected) return false

  target.focus()
  return true
}
