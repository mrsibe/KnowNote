import type {
  ChatExecutionOutcome,
  ChatExecutionStatus,
  ChatTokenUsage
} from '../../../shared/types/chat'
import { abortedOutcome, settleOutcome } from '../../../shared/utils/chatExecution'

/**
 * One running turn, and the rules about it (#140).
 *
 * This is the object the IPC handler used to keep as local variables: the
 * accumulated answer, the usage the provider reported, and — most importantly —
 * whether the turn has ended and how. It has no database and no Electron in it, so
 * the lifecycle can be driven in a test with a scripted stream.
 *
 * The rules, and why they are here rather than at the call site:
 *
 * - **exactly one terminal outcome.** `settle` accepts the first one and returns
 *   `null` for everything after. A stream can deliver several terminal-looking
 *   events and a stop can arrive after the answer is already finished; the first
 *   is the truth (#138 invariant 2).
 * - **a stop is recorded before it is acted on.** `abort` settles first and only
 *   then cancels upstream, so the `AbortError` that comes back out of the SDK is
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
  private text = ''
  private reasoning = ''
  private providerFinishReason: string | undefined
  private reportedUsage: ChatTokenUsage | undefined
  private readonly controller = new AbortController()

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

  get content(): string {
    return this.text
  }

  get reasoningContent(): string {
    return this.reasoning
  }

  /** The provider's own terminal reason, kept beside the status (#139). */
  get finishReason(): string | undefined {
    return this.providerFinishReason
  }

  get usage(): ChatTokenUsage | undefined {
    return this.reportedUsage
  }

  /** Handed to the SDK so the caller can stop the turn. */
  get signal(): AbortSignal {
    return this.controller.signal
  }

  /** The first chunk, which is what turns "waiting" into "streaming". */
  begin(): void {
    if (this.currentStatus === 'pending') this.currentStatus = 'streaming'
  }

  appendText(delta: string): void {
    this.begin()
    this.text += delta
  }

  appendReasoning(delta: string): void {
    this.begin()
    this.reasoning += delta
  }

  /**
   * End the turn, once.
   *
   * @returns the settled outcome, or `null` when the turn had already ended —
   *   which is how a caller knows the signal it just received must be ignored.
   */
  settle(
    outcome: ChatExecutionOutcome,
    facts: { finishReason?: string; usage?: ChatTokenUsage } = {}
  ): ChatExecutionOutcome | null {
    const settled = settleOutcome(this.settledOutcome, outcome)
    if (settled === this.settledOutcome) return null

    this.settledOutcome = settled
    this.currentStatus = settled.status
    this.providerFinishReason = facts.finishReason
    this.reportedUsage = facts.usage
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

    this.controller.abort()
    return settled
  }
}
