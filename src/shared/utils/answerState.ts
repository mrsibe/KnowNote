import type { ChatExecutionStatus, ChatMessage } from '../types/chat'

/**
 * How a turn that ended reads in the transcript (#142).
 *
 * The record already says what happened — `status`, `error` — and this is the only
 * place that turns it into what the reader sees. That matters for a specific
 * property: the live overlay and a message reloaded from the database are the same
 * record, so asking one function about both is what makes "what was on screen" and
 * "what a reload shows" the same statement rather than two implementations that
 * have to agree.
 *
 * Nothing here reads `metadata`. Until this, a truncated answer was explained by a
 * `finishReason` copied into the metadata bag (#137) because the status was not on
 * the wire yet; the status is the record now, and there is one home for it.
 */

/** `pending` is the turn before its first token; both are "still arriving". */
export const isAnswerLive = (status: ChatExecutionStatus | null | undefined): boolean =>
  status === 'pending' || status === 'streaming'

export type AnswerNoticeKey = 'answerTruncated' | 'answerBlocked' | 'answerStopped' | 'answerFailed'

/**
 * The one line an ended answer carries, or `null` when there is nothing to explain.
 *
 * - `truncated` — the output ceiling ended it. A completion, and not styled as a
 *   failure: the answer is real, it is just not the whole of it.
 * - `blocked` — the provider refused, which is not the model's own decision.
 * - `aborted` — the reader stopped it.
 * - `failed` — generation broke; the line carries the reason.
 *
 * `completed` says nothing, and neither does `null`: a row written before the
 * column existed is *unknown*, which is not a claim that the answer is whole.
 */
export const answerNoticeKey = (
  message: Pick<ChatMessage, 'status' | 'error'>
): AnswerNoticeKey | null => {
  switch (message.status) {
    case 'truncated':
      return 'answerTruncated'
    case 'blocked':
      return 'answerBlocked'
    case 'aborted':
      return 'answerStopped'
    case 'failed':
      return 'answerFailed'
    default:
      return null
  }
}

/**
 * Whether a stopped, blocked or failed answer still has text worth showing.
 *
 * Every one of them does: the partial answer is what the reader was left with, and
 * replacing it with an error message — which is what the transcript used to do —
 * throws away the part that arrived.
 */
export const keepsPartialAnswer = (status: ChatExecutionStatus | null | undefined): boolean =>
  status === 'truncated' || status === 'blocked' || status === 'aborted' || status === 'failed'

/**
 * Whether asking again could help.
 *
 * `truncated`, `aborted` and `failed` are all "the answer stopped early": the reader
 * can continue from what arrived or ask the question again (#151). `blocked` is not
 * one of them — the provider refused, and a second identical request would be refused
 * the same way.
 */
export const canRecover = (status: ChatExecutionStatus | null | undefined): boolean =>
  status === 'truncated' || status === 'aborted' || status === 'failed'
