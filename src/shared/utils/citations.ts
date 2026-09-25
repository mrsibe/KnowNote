import type { Citation } from '../types/citation'
import type { ChatMessageMetadata } from '../types/chat'

/**
 * Readers for `chat_messages.metadata.citations`.
 *
 * The metadata column is an open JSON bag written by whichever version of the app
 * produced the message, so a reader can never assume the shape. `parseCitations`
 * is the only place that decides what is usable, so a component can render a
 * message from a year ago without a guard of its own.
 *
 * Malformed entries are **dropped individually**: one unreadable citation from an
 * older writer is not a reason to hide the citations that did survive.
 *
 * Dropping is not the same as deleting. A citation whose document no longer
 * exists is still a valid, parseable record — the source was real when the answer
 * was written. The UI disables the jump; the parser does not pretend it never
 * happened.
 */

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

const toFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const parseCitation = (value: unknown): Citation | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>

  // The four fields a citation cannot be rendered or resolved without.
  if (!isNonEmptyString(candidate.documentId)) return null
  if (!isNonEmptyString(candidate.documentTitle)) return null
  if (!isNonEmptyString(candidate.chunkId)) return null
  if (!isNonEmptyString(candidate.quote)) return null

  const citation: Citation = {
    index: toFiniteNumber(candidate.index) ?? 0,
    documentId: candidate.documentId,
    documentTitle: candidate.documentTitle,
    chunkId: candidate.chunkId,
    quote: candidate.quote,
    // An unrecorded score is not "irrelevant"; it is unknown. 0 keeps the field a
    // number without claiming anything a reader relies on.
    score: toFiniteNumber(candidate.score) ?? 0
  }

  if (isNonEmptyString(candidate.documentType)) citation.documentType = candidate.documentType
  if (isNonEmptyString(candidate.blockId)) citation.blockId = candidate.blockId

  const page = toFiniteNumber(candidate.page)
  if (page !== undefined) citation.page = page
  const pageEnd = toFiniteNumber(candidate.pageEnd)
  if (pageEnd !== undefined) citation.pageEnd = pageEnd
  const startOffset = toFiniteNumber(candidate.startOffset)
  if (startOffset !== undefined) citation.startOffset = startOffset
  const endOffset = toFiniteNumber(candidate.endOffset)
  if (endOffset !== undefined) citation.endOffset = endOffset

  return citation
}

/** Every usable citation on a message, ordered by the marker the prompt used. */
export const parseCitations = (metadata: unknown): Citation[] => {
  if (!metadata || typeof metadata !== 'object') return []
  const raw = (metadata as ChatMessageMetadata).citations
  if (!Array.isArray(raw)) return []

  return raw
    .map(parseCitation)
    .filter((citation): citation is Citation => citation !== null)
    .sort((a, b) => a.index - b.index)
}
