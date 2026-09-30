/**
 * Session titles a notebook's chat list shows (#97).
 *
 * Pure and in `shared/` on purpose: the main process decides the persisted title
 * (first user message, auto-rollover) and the renderer shows the same string
 * optimistically, so both have to agree on how it is derived.
 *
 * Deliberately locale-free. A title is user data that outlives a language switch,
 * so the one place a localized default appears is the UI, in the notebook's own
 * locale, and only until the first message replaces it.
 */

/** How much of the first message becomes a title. Long enough to tell two apart. */
export const SESSION_TITLE_MAX_LENGTH = 60

/**
 * The title for a session whose first user message has just arrived.
 *
 * Whitespace (including newlines from a pasted paragraph) collapses to single
 * spaces so a row in the list stays one line. Truncation prefers a word boundary
 * when one is close enough, because cutting mid-word in a Latin script reads as
 * corruption; CJK has no spaces, so it falls back to a hard cut.
 */
export function deriveSessionTitle(firstMessage: string): string {
  const normalized = firstMessage.replace(/\s+/g, ' ').trim()
  if (normalized.length <= SESSION_TITLE_MAX_LENGTH) return normalized

  const cut = normalized.slice(0, SESSION_TITLE_MAX_LENGTH)
  const lastSpace = cut.lastIndexOf(' ')
  // Only honour the word boundary when it does not throw away most of the title.
  const body = lastSpace > SESSION_TITLE_MAX_LENGTH / 2 ? cut.slice(0, lastSpace) : cut
  return `${body.trimEnd()}…`
}

/**
 * The title for a session the auto-switch opened to continue an archived one.
 *
 * The two sessions must be distinguishable in the list, so the continuation
 * carries the original name plus its position in the notebook. A number rather
 * than a word: it survives a language switch and needs no translation.
 */
export function continuedSessionTitle(baseTitle: string, sequence: number): string {
  const base = baseTitle.trim() || 'Chat'
  const suffix = ` (${sequence})`
  const room = SESSION_TITLE_MAX_LENGTH - suffix.length
  const head = base.length > room ? `${base.slice(0, Math.max(room - 1, 1)).trimEnd()}…` : base
  return `${head}${suffix}`
}
