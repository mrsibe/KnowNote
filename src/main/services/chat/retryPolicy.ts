import type { ChatExecutionOutcome } from '../../../shared/types/chat'

/**
 * Whether a failed turn is worth attempting again (#150).
 *
 * The rule is deliberately narrow. A failure that is retried when it will fail the
 * same way every time costs the reader time, tokens and a second wait for the same
 * answer — so only failures that are recognisably transient are retried, and
 * anything unrecognised is reported as it is.
 *
 * Two conditions beyond the kind of failure, both of which the caller supplies:
 *
 * - **nothing has been shown yet.** Once content has reached the reader, a retry
 *   would either duplicate it or silently replace it.
 * - **the attempts are bounded.** Backoff on top, so a provider that is down is not
 *   hammered.
 */

/** How many attempts one turn may make, the first included. */
export const MAX_ATTEMPTS = 3

/** How long to wait before attempt `next` (1-based). */
export const retryDelayMs = (next: number): number => 500 * 2 ** Math.max(0, next - 2)

/**
 * Failures that mean "try again", by the text the provider or transport gave us.
 *
 * A short list on purpose. Providers do not agree on error shapes and the UI event
 * carries only a message, so this is a best-effort reading of what is transient —
 * and the default is *not* to retry, which is the safe direction to be wrong in.
 */
const TRANSIENT =
  /(rate.?limit|too many requests|\b429\b|\b50[0-9]\b|overloaded|temporarily unavailable|timeout|timed out|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|EPIPE|socket hang up|premature close|fetch failed|network)/i

export const isRetryableFailure = (outcome: ChatExecutionOutcome): boolean => {
  if (outcome.status !== 'failed') return false

  // A stream that went quiet and was cancelled, and a stream that ended without
  // saying anything, are both the connection's fault rather than the request's.
  if (outcome.reason === 'timeout' || outcome.reason === 'unexpected_eof') return true

  return TRANSIENT.test(outcome.error.message)
}

export const shouldRetry = (options: {
  outcome: ChatExecutionOutcome
  /** The attempt that just failed, 1-based. */
  attempt: number
  /** Whether any content has reached the reader. */
  contentSent: boolean
}): boolean =>
  options.attempt < MAX_ATTEMPTS && !options.contentSent && isRetryableFailure(options.outcome)
