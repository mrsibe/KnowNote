import type { AnswerSource, ChatMessageMetadata, RetrievalStatus } from '../types/chat'

/**
 * Readers for `chat_messages.metadata`.
 *
 * The metadata column is an open JSON bag written by whichever version of the app
 * produced the message, so a reader can never assume the shape. These parsers are
 * the only place that decides what is usable, so the UI can render a message from
 * a year ago without a guard in every component.
 *
 * Malformed entries are **dropped individually**, not treated as a reason to
 * discard the whole set: an answer with two usable sources out of three should
 * still show the two.
 */

const RETRIEVAL_STATUSES: readonly RetrievalStatus[] = ['used', 'none', 'failed']

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

const toFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const parseSource = (value: unknown): AnswerSource | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>

  // The four fields a source cannot be rendered without. `chunkIndex`, `score`
  // and `documentType` stay optional so an older writer is still readable.
  if (!isNonEmptyString(candidate.documentId)) return null
  if (!isNonEmptyString(candidate.documentTitle)) return null
  if (!isNonEmptyString(candidate.chunkId)) return null
  if (!isNonEmptyString(candidate.content)) return null

  const index = toFiniteNumber(candidate.index)

  return {
    index: index ?? 0,
    documentId: candidate.documentId,
    documentTitle: candidate.documentTitle,
    documentType: isNonEmptyString(candidate.documentType) ? candidate.documentType : undefined,
    chunkId: candidate.chunkId,
    chunkIndex: toFiniteNumber(candidate.chunkIndex),
    content: candidate.content,
    score: toFiniteNumber(candidate.score)
  }
}

/** Every usable source on a message, in the order the prompt presented them. */
export const parseAnswerSources = (metadata: unknown): AnswerSource[] => {
  if (!metadata || typeof metadata !== 'object') return []
  const raw = (metadata as ChatMessageMetadata).sources
  if (!Array.isArray(raw)) return []

  return raw
    .map(parseSource)
    .filter((source): source is AnswerSource => source !== null)
    .sort((a, b) => a.index - b.index)
}

/**
 * How retrieval went for this answer, or `null` when the message predates the
 * field. `null` is not `'none'`: "we did not record it" is a different statement
 * from "nothing was retrieved", and only the second one is about the answer.
 */
export const parseRetrievalStatus = (metadata: unknown): RetrievalStatus | null => {
  if (!metadata || typeof metadata !== 'object') return null
  const raw = (metadata as ChatMessageMetadata).retrieval
  return RETRIEVAL_STATUSES.includes(raw as RetrievalStatus) ? (raw as RetrievalStatus) : null
}

/**
 * The passages to show for an answer.
 *
 * A `failed` search is reported as no sources rather than as a partial set, so the
 * UI cannot present a half-complete evidence list as if it were the whole story.
 */
export const sourcesForDisplay = (metadata: unknown): AnswerSource[] => {
  const status = parseRetrievalStatus(metadata)
  if (status === 'failed') return []
  return parseAnswerSources(metadata)
}
