import type { ChatExecutionOutcome, ChatExecutionStatus } from '../../../shared/types/chat'
import { abortedOutcome, settleOutcome } from '../../../shared/utils/chatExecution'

/**
 * One running turn, and the rules about it (#140).
 *
 * This is what the IPC handler used to keep as local variables: whether the turn
 * has ended, how, and the signal that stops it. It has no database and no Electron
 * in it, so the lifecycle can be driven in a test with a scripted provider.
 *
 * The answer itself is *not* here. It is assembled by the SDK
 * (`readUIMessageStream`) into a `UIMessage`, which the manager holds — see
 * `ChatStreamManager`, where the partial answer a failed or stopped turn keeps
 * lives. One accumulator, one message, no second implementation (#141).
 *
 * The rules, and why they are here rather than at the call site:
 *
 * - **exactly one terminal outcome.** `settle` accepts the first one and returns
 *   `null` for everything after. A stream can deliver several terminal-looking
 *   events and a stop can arrive after the answer is already finished; the first
 *   is the truth (#138 invariant 2).
 * - **a stop is recorded before it is acted on.** `abort` settles first and only
 *   then cancels the signal, so the `AbortError` that comes back out of the SDK is
 *   noise after a decision instead of a second opinion about it.
 * - **`pending` is not `streaming`.** The turn exists before the provider has said
 *   anything; that gap is what "waiting for the first token" means, and it is the
 *   state a timeout in #143 will have to measure.
 */
export class ChatExecution {
  readonly id: string
  readonly messageId: string
  readonly sessionId: string
  readonly notebookId: string | undefined
  /** Milliseconds since the epoch, for the timings #143 will act on. */
  readonly startedAt: number

  private currentStatus: ChatExecutionStatus = 'pending'
  private settledOutcome: ChatExecutionOutcome | undefined
  /**
   * The attempt in flight.
   *
   * Replaced by `beginAttempt`, because a retry must not inherit a signal that a
   * timeout or a cancel has already aborted (#150).
   */
  private attemptController = new AbortController()

  constructor(init: { id: string; messageId: string; sessionId: string; notebookId?: string }) {
    this.id = init.id
    this.messageId = init.messageId
    this.sessionId = init.sessionId
    this.notebookId = init.notebookId
    this.startedAt = Date.now()
  }

  get status(): ChatExecutionStatus {
    return this.currentStatus
  }

  /** The terminal statement, once there is one. */
  get outcome(): ChatExecutionOutcome | undefined {
    return this.settledOutcome
  }

  /** Whether this turn has ended. */
  get isSettled(): boolean {
    return this.settledOutcome !== undefined
  }

  /** The signal of the attempt in flight. */
  get signal(): AbortSignal {
    return this.attemptController.signal
  }

  /**
   * Open a fresh attempt, and hand back the signal that cancels it.
   *
   * Called before every provider call, including a retry: the previous attempt's
   * signal is spent.
   */
  beginAttempt(): AbortSignal {
    this.attemptController = new AbortController()
    return this.attemptController.signal
  }

  /**
   * Cancel the attempt in flight without deciding anything about the turn.
   *
   * The idle deadline uses this: stopping a request that has gone quiet is not a
   * statement about what the turn was, and the attempt that was cancelled reports
   * back as a failure the retry policy can look at (#150).
   */
  cancel(): void {
    this.attemptController.abort()
  }

  /** The first chunk, which is what turns "waiting" into "streaming". */
  begin(): void {
    if (this.currentStatus === 'pending') this.currentStatus = 'streaming'
  }

  /**
   * End the turn, once.
   *
   * @returns the settled outcome, or `null` when the turn had already ended —
   *   which is how a caller knows the signal it just received must be ignored.
   */
  settle(outcome: ChatExecutionOutcome): ChatExecutionOutcome | null {
    const settled = settleOutcome(this.settledOutcome, outcome)
    if (settled === this.settledOutcome) return null

    this.settledOutcome = settled
    this.currentStatus = settled.status
    return settled
  }

  /**
   * Stop the turn, recording it before anything is cancelled.
   *
   * @returns the outcome, or `null` when the turn had already ended — a stop that
   *   arrives after the answer is complete must not re-label it.
   */
  abort(reason: 'user' | 'shutdown'): ChatExecutionOutcome | null {
    const settled = this.settle(abortedOutcome(reason))
    if (!settled) return null

    this.attemptController.abort()
    return settled
  }
}
