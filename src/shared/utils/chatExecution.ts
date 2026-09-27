import type { ChatExecutionOutcome } from '../types/chat'

/**
 * The one place that decides what a finished turn *is*.
 *
 * Every layer above a stream has to answer "what happened to this answer", and
 * answering it three times is how `aborted` ended up persisted as `completed`
 * (#138): the model client decided, the IPC handler decided again, and the
 * renderer inferred a third time from whatever reached it. These functions are
 * the decision, and they are pure so the rules can be tested without a provider.
 *
 * Two vocabularies, deliberately kept apart:
 *
 *   finishReason  what the provider said — a fact about the model call
 *   status        what KnowNote says happened — what the transcript renders
 *
 * They are not the same statement. `length` is a *completion* whose answer is
 * incomplete: calling it a failure would throw away an answer the reader can
 * still use, and calling it `completed` would present half an answer as whole.
 * A turn can also end with the provider saying nothing at all, which no
 * `finishReason` can express and which must not read as success.
 */

/**
 * What a provider's terminal `finishReason` means for the turn.
 *
 * `ai` types this as `stop | length | content-filter | tool-calls | error |
 * other | unknown`. Only the first three change the product's statement:
 *
 * - `length` → `truncated`: the output ceiling ended the answer, so it is not
 *   the whole of it. Not a failure — the text is kept and explained (#137).
 * - `content-filter` → `blocked`: the provider refused, which is not the
 *   model's own decision and must not look like an ordinary ending.
 * - `error` → `failed`. In practice an `error` part usually arrives first and
 *   wins; this is the case where the provider only says so in the reason.
 *
 * Everything else — including `unknown` and `other` — completes the turn. A
 * terminal signal is a statement that the provider stopped, even when it
 * declines to say why; only the *absence* of one is a failure. The raw reason is
 * stored next to the status either way, so nothing is lost.
 */
export const classifyFinishReason = (finishReason: string): ChatExecutionOutcome => {
  switch (finishReason) {
    case 'length':
      return { status: 'truncated' }
    case 'content-filter':
      return { status: 'blocked' }
    case 'error':
      return {
        status: 'failed',
        error: { message: 'The model stopped with an error.' },
        reason: 'error'
      }
    default:
      return { status: 'completed' }
  }
}

/** A turn that ended because something went wrong, and where it went wrong. */
/** A turn that ended because something went wrong, and where it went wrong. */
export const failedOutcome = (
  message: string,
  reason: 'error' | 'unexpected_eof'
): ChatExecutionOutcome => ({ status: 'failed', error: { message }, reason })

/**
 * The turn's outcome from the terminal signal, including the case where there
 * isn't one.
 *
 * The AI SDK emits a `finish` part whenever the model stream closes cleanly, and
 * fills in `finishReason: 'unknown'` when the provider never named a reason —
 * pinned by `test/chatStreamOutcome.test.ts` so a change there is noticed rather
 * than absorbed. A *missing* reason therefore means no terminal part arrived at
 * all, which is not a completion under any reading (#138 invariant 1).
 */
export const classifyTerminal = (finishReason: string | undefined): ChatExecutionOutcome =>
  finishReason === undefined
    ? failedOutcome('The model stream ended without reporting a finish reason.', 'unexpected_eof')
    : classifyFinishReason(finishReason)
export const abortedOutcome = (reason: 'user' | 'shutdown'): ChatExecutionOutcome => ({
  status: 'aborted',
  reason
})

/**
 * The first terminal outcome wins, and there is exactly one.
 *
 * A stream can deliver several terminal-looking events: an `error` part followed
 * by a normal `finish` (the SDK keeps delivering after an error part), or a
 * legitimate `finish` followed by a transport cleanup error such as a premature
 * close. The first is the turn's outcome; the rest are noise arriving after the
 * decision, and promoting one of them re-labels an answer the reader already has.
 *
 * @returns the settled outcome — the existing one when the turn has already
 *   ended, which is how the caller knows the new signal must be ignored.
 */
export const settleOutcome = (
  current: ChatExecutionOutcome | undefined,
  next: ChatExecutionOutcome
): ChatExecutionOutcome => current ?? next
