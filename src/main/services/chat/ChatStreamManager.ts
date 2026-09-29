import { readUIMessageStream } from 'ai'
import type { UIMessage, UIMessageChunk } from 'ai'
import type {
  APIMessage,
  AnswerSource,
  ChatExecutionOutcome,
  ChatMessageMetadata,
  ChatTokenUsage,
  ChatTurnEvent,
  RetrievalSnapshot,
  RetrievalStatus
} from '../../../shared/types/chat'
import type { Citation, CitationContext } from '../../../shared/types/citation'
import { classifyTerminal, failedOutcome } from '../../../shared/utils/chatExecution'
import { resolveCitations } from '../../../shared/utils/citationResolution'
import {
  carriesContent,
  isTerminalChunk,
  messageReasoning,
  messageText
} from '../../../shared/utils/uiMessage'
import { retryDelayMs, shouldRetry } from './retryPolicy'
import { estimateTokens } from '../../../shared/utils/tokenEstimate'
import Logger from '../../../shared/utils/logger'
import { ChatExecution } from './ChatExecution'
import type { ModelClient } from '../../models/ModelClient'
import type { SessionAutoSwitchService } from '../SessionAutoSwitchService'

/**
 * The Main process owns the turn (#140), and the wire carries the SDK's own events
 * (#141).
 *
 * #140 gave a turn one owner: one entry per running turn, one place where it is
 * settled, persisted and announced. This is the other half — what actually crosses
 * the process boundary. Before, KnowNote flattened the SDK's event stream into a
 * reduced protocol of its own (`text-delta | reasoning-delta | finish`) and the
 * renderer re-assembled text and reasoning from it. That reduction is what made an
 * `error` part silently disappear (#137) and it would have made every future SDK
 * event type another silent drop.
 *
 * Now the events are forwarded verbatim, and both sides assemble them with the
 * SDK's own `readUIMessageStream`:
 *
 * ```text
 * ModelClient.streamChat()          the SDK's UI event stream
 *        │
 *      tee()
 *   ┌────┴──────────────────┐
 *   ↓                       ↓
 * forward + seq          readUIMessageStream
 *   ↓                       ↓
 * renderer               the persisted message
 * ```
 *
 * Three consequences worth stating, because each one is a decision:
 *
 * - **The answer is assembled once, here, by the SDK.** Nothing re-derives it from
 *   deltas, which is the epic's sixth invariant.
 * - **The terminal chunks (`finish`, `error`, `abort`) are not forwarded.** The
 *   manager owns the terminal statement, and it emits `outcome` *after* the turn is
 *   persisted (#138 invariant 4). Everything those chunks carried — the reason, the
 *   error message — is on that event, so the reader loses nothing.
 * - **A stop cancels the request.** The execution's signal is what `streamChat` is
 *   given, so `abort` now stops the provider call rather than only recording that it
 *   was stopped.
 */

/**
 * How long a turn may produce nothing before its request is cancelled.
 *
 * Generous on purpose: this is for a stream that has died, not for a model that is
 * slow to start. Every event resets it, so a reasoning model is never cut off
 * mid-thought (#150).
 */
const IDLE_TIMEOUT_MS = 60_000

/** Waits before the next attempt. */
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * What an automatic continuation is asked for (#179).
 *
 * English like the manual continuation's instruction: it is a directive to the
 * model, not copy the reader sees. One constant, because automatic and manual
 * continuations must ask for exactly the same thing.
 */
export const CONTINUE_INSTRUCTION =
  'Continue the answer from where it stopped. Do not repeat what has already been written, and do not restart it.'

/** What the turn's persistence needs, as a port: see `turnStore.ts`. */
export interface ChatTurnStore {
  createTurn(sessionId: string, attemptOf?: string): { id: string }
  saveTurnMetadata(messageId: string, metadata: ChatMessageMetadata): void
  saveTurnContent(messageId: string, content: string, reasoningContent: string): void
  saveTurnOutcome(
    messageId: string,
    outcome: ChatExecutionOutcome,
    finishReason: string | undefined,
    usage: ChatTokenUsage | undefined
  ): void
}

export interface ChatTurnRequest {
  sessionId: string
  notebookId?: string
  /** The first attempt at this question, when this turn is another one (#151). */
  attemptOf?: string
  /**
   * Continue into an answer that already exists instead of opening a new message.
   *
   * The text that arrived seeds the accumulator, so what gets persisted is the whole
   * of what the reader has seen — the part before, plus the continuation — rather
   * than the continuation alone.
   */
  resume?: { messageId: string; text: string; reasoning: string }
  /** The message the user sent, for the token estimate when no usage is reported. */
  userContent: string
  /**
   * Automatic continuation after the output ceiling ends an answer (#179).
   *
   * Present only when the setting is on. `limit` is the total number of
   * continuations this answer may spend, automatic and manual together.
   */
  autoContinue?: { limit: number }
  /**
   * Continuations already spent on this answer, read from the persisted metadata
   * (#179). A manual chain is bounded by the same counter.
   */
  continuations?: number
  /** The prompt as it was assembled, retrieval included. Empty means nothing to send. */
  messages: APIMessage[]
  /** Null when no chat model is configured. */
  client: ModelClient | null
  retrieval: RetrievalStatus
  sources: AnswerSource[]
  citations: Citation[]
  /** 本次检索的参数快照（#157）；未检索或旧调用方时为 undefined。 */
  retrievalSnapshot?: RetrievalSnapshot
  /** Bounds for validating the `[n]` markers the answer may use (#70). */
  citationContexts: CitationContext[]
  emit: (event: ChatTurnEvent) => void
}

interface TurnEntry {
  execution: ChatExecution
  request: ChatTurnRequest
  baseMetadata: ChatMessageMetadata
  /** The answer, as the SDK assembled it. The only place it accumulates. */
  message?: UIMessage
  /** The provider's terminal reason, when it named one. */
  finishReason?: string
  /** What the provider reported on the terminal chunk. */
  usage?: ChatTokenUsage
  /** The message of an `error` chunk, when the provider reported one mid-stream. */
  streamError?: string
  /**
   * Whether anything the reader would see has been forwarded.
   *
   * Sticky across attempts on purpose: once content has been sent, no later attempt
   * may be started, whatever the failure (#150).
   */
  contentSent?: boolean
  /** Set when the idle deadline cancelled the attempt, so its failure reads as one. */
  timedOut?: boolean
  /** The attempt in flight, 1-based; logged, and what the retry bound counts. */
  attempts?: number
  /** How many continuations this answer has spent (#179). */
  continuations: number
  /** The watchdog for the attempt in flight. */
  idle?: { reset: () => void; stop: () => void }
  /** Monotonic per execution, so a consumer can detect a gap. */
  seq: number
}

/**
 * What the accumulator starts from.
 *
 * Nothing for a new answer; for a continuation, the answer as it was when the reader
 * asked for more — so the message that gets written is the whole of it, and the
 * renderer, which seeds its own assembler the same way, shows the same text.
 */
const seedMessage = (entry: TurnEntry): UIMessage | undefined => {
  const resume = entry.request.resume
  if (!resume) return undefined

  return {
    id: resume.messageId,
    role: 'assistant',
    parts: [
      ...(resume.reasoning
        ? [{ type: 'reasoning' as const, text: resume.reasoning, state: 'done' as const }]
        : []),
      ...(resume.text ? [{ type: 'text' as const, text: resume.text, state: 'done' as const }] : [])
    ]
  }
}

export class ChatStreamManager {
  private readonly turns = new Map<string, TurnEntry>()
  private readonly turnIdByMessageId = new Map<string, string>()

  constructor(
    private readonly deps: {
      store: ChatTurnStore
      sessionAutoSwitchService: Pick<SessionAutoSwitchService, 'recordTokenUsageAndCheckSwitch'>
      /** Overridable so a test does not have to wait a minute to see the deadline. */
      idleTimeoutMs?: number
    }
  ) {}

  /** How many turns are in flight. */
  get runningCount(): number {
    return this.turns.size
  }

  /**
   * Open a turn and start streaming it.
   *
   * Returns immediately with the execution, so the caller can hand the message id
   * to the renderer; the stream reports back through the request's `emit` and
   * through the terminal bookkeeping in this class.
   */
  start(request: ChatTurnRequest): ChatExecution {
    // A continuation writes into the answer it is continuing; only a new answer — or a
    // sibling attempt at the same question — opens a row (#151).
    const turn = request.resume
      ? { id: request.resume.messageId }
      : this.deps.store.createTurn(request.sessionId, request.attemptOf)

    const baseMetadata: ChatMessageMetadata = {
      retrieval: request.retrieval,
      sources: request.sources,
      citations: request.citations
    }
    // How much of this answer's continuation budget is already spent (#179). Written
    // with the provenance so a manual continue after a reload is still bounded.
    if (request.continuations !== undefined) baseMetadata.continuations = request.continuations
    // The retrieval parameters are part of what an answer was built from, so they
    // are written with the sources, before the model is called (#157).
    if (request.retrievalSnapshot) baseMetadata.retrievalSnapshot = request.retrievalSnapshot
    // Written before the model is called: what an answer was built from is known
    // then, and a reload mid-turn should not show an answer with no provenance.
    this.deps.store.saveTurnMetadata(turn.id, baseMetadata)

    const execution = new ChatExecution({
      id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      messageId: turn.id,
      sessionId: request.sessionId,
      notebookId: request.notebookId
    })

    const entry: TurnEntry = {
      execution,
      request,
      baseMetadata,
      seq: 0,
      continuations: request.continuations ?? 0
    }
    this.turns.set(execution.id, entry)
    this.turnIdByMessageId.set(execution.messageId, execution.id)

    // A turn that cannot start is still a turn with an outcome: the renderer is
    // waiting on a message id, and the row exists to say what happened.
    if (request.messages.length === 0) {
      this.settleTurn(entry, failedOutcome('No valid conversation history', 'error'))
      return execution
    }
    if (!request.client) {
      this.settleTurn(
        entry,
        failedOutcome('Chat model not configured, please configure in settings', 'error')
      )
      return execution
    }

    void this.run(entry)

    return execution
  }

  /** The running turn for a message, which is the identity the renderer knows. */
  getByMessageId(messageId: string): ChatExecution | undefined {
    return this.entryByMessageId(messageId)?.execution
  }

  /**
   * Stop a running turn.
   *
   * @returns false when there is nothing to stop, which is what the renderer's
   *   stop button understands as "already over".
   */
  abort(messageId: string, reason: 'user' | 'shutdown' = 'user'): boolean {
    const entry = this.entryByMessageId(messageId)
    if (!entry) return false

    // Recording the outcome before cancelling is the point: the AbortError that
    // comes back must not get to decide what this turn was. Cancelling the signal
    // the provider call was given is what makes the stop real (#141).
    const settled = entry.execution.abort(reason)
    if (!settled) return false

    this.complete(entry, settled)
    return true
  }

  private entryByMessageId(messageId: string): TurnEntry | undefined {
    const executionId = this.turnIdByMessageId.get(messageId)
    return executionId === undefined ? undefined : this.turns.get(executionId)
  }

  private async run(entry: TurnEntry): Promise<void> {
    for (;;) {
      const outcome = await this.runAttempts(entry)

      // A stop the reader asked for has already settled the turn.
      if (entry.execution.isSettled) return

      // The output ceiling ended it and the answer may ask for more (#179):
      // continue in place rather than settling a half answer.
      if (outcome.status === 'truncated' && this.mayAutoContinue(entry)) {
        this.beginContinuation(entry)
        continue
      }

      this.settleTurn(entry, outcome)
      return
    }
  }

  /**
   * Attempt the turn, retrying while the retry policy says so (#150).
   *
   * Each attempt is a fresh provider call with its own signal. A retry is only
   * reachable while nothing has reached the reader, so the answer on screen is never
   * duplicated or silently replaced by a second attempt. Returns the outcome the
   * policy settled on; the caller decides whether that is the turn's end.
   */
  private async runAttempts(entry: TurnEntry): Promise<ChatExecutionOutcome> {
    for (let attempt = 1; ; attempt += 1) {
      entry.attempts = attempt
      const outcome = await this.attempt(entry)

      // A stop the reader asked for has already settled the turn.
      if (entry.execution.isSettled) return outcome

      if (shouldRetry({ outcome, attempt, contentSent: entry.contentSent === true })) {
        const delay = retryDelayMs(attempt + 1)
        Logger.warn(
          'ChatStreamManager',
          `Turn ${entry.execution.id} attempt ${attempt} failed (${outcome.status}${
            outcome.status === 'failed' ? `: ${outcome.error.message}` : ''
          }); retrying in ${delay}ms`
        )
        await wait(delay)
        if (entry.execution.isSettled) return outcome
        continue
      }

      return outcome
    }
  }

  /** Whether a truncated answer may be continued automatically (#179). */
  private mayAutoContinue(entry: TurnEntry): boolean {
    const limit = entry.request.autoContinue?.limit ?? 0
    if (limit <= 0 || entry.continuations >= limit) return false
    // Nothing to append to is not a continuation, and a turn that never reached the
    // reader must not be continued silently.
    return entry.contentSent === true && messageText(entry.message).length > 0
  }

  /**
   * Seed the next provider call from what has arrived, plus the instruction to
   * carry on (#179).
   *
   * The persisted answer keeps growing in the same message: the accumulated text is
   * both the assembler's seed and the assistant turn handed back to the model, so a
   * continuation cannot restart or duplicate the answer.
   */
  private beginContinuation(entry: TurnEntry): void {
    entry.continuations += 1
    const text = messageText(entry.message)
    const reasoning = messageReasoning(entry.message)

    entry.request.resume = { messageId: entry.execution.messageId, text, reasoning }
    entry.request.messages = [
      ...entry.request.messages,
      { role: 'assistant', content: text },
      { role: 'user', content: CONTINUE_INSTRUCTION }
    ]
    entry.baseMetadata.continuations = entry.continuations
    // The new call starts from nothing on the wire; only the seed it is given has
    // content. Resetting lets the retry policy cover a continuation that fails
    // before producing anything, which is the whole point of retrying it.
    entry.contentSent = false

    Logger.info(
      'ChatStreamManager',
      `Turn ${entry.execution.id} hit the output ceiling; continuing (${entry.continuations}/${entry.request.autoContinue?.limit ?? 0})`
    )
  }

  /**
   * One provider call, from opening the attempt to its outcome.
   *
   * Nothing is settled here: a failure is a value the retry policy looks at, and the
   * turn ends only once that policy has had its say.
   */
  private async attempt(entry: TurnEntry): Promise<ChatExecutionOutcome> {
    const { execution, request } = entry
    const client = request.client
    if (!client) {
      return failedOutcome('Chat model not configured, please configure in settings', 'error')
    }

    // Per-attempt facts, cleared so a retry cannot inherit the previous attempt's —
    // except the seed, which a continuation starts from again.
    entry.message = seedMessage(entry)
    entry.finishReason = undefined
    entry.usage = undefined
    entry.streamError = undefined
    entry.timedOut = false

    const signal = execution.beginAttempt()
    entry.idle = this.watchIdle(entry)

    let outcome: ChatExecutionOutcome
    try {
      const { events } = client.streamChat(request.messages, { signal })
      const [toRenderer, toAssemble] = events.tee()
      await Promise.all([this.forward(entry, toRenderer), this.assemble(entry, toAssemble)])
      // The stream ended without being stopped. What that means is
      // `classifyTerminal`'s decision: a `finish` chunk's reason, or — when no
      // terminal chunk arrived at all — an EOF, which is not success (#138
      // invariant 1).
      outcome = this.outcomeFor(entry)
    } catch (error) {
      // A transport error arrives as a rejection: the partial answer is kept, and the
      // failure is reported as the connection's.
      outcome = failedOutcome((error as Error).message, 'error')
    } finally {
      entry.idle?.stop()
      entry.idle = undefined
    }

    // However the cancellation surfaced — a rejected read, or the SDK turning it into
    // an `abort` chunk — the reason this attempt failed is the deadline that cancelled
    // it (#150).
    return entry.timedOut ? failedOutcome('The model stopped responding.', 'timeout') : outcome
  }

  /**
   * The SDK assembles; nothing here re-derives the message from deltas.
   *
   * Kept on the entry as each snapshot arrives rather than assigned once at the end:
   * a turn can be stopped or fail while this is still running, and the part of the
   * answer that had arrived is what gets persisted (#138 invariant 5).
   */
  private async assemble(entry: TurnEntry, stream: ReadableStream<UIMessageChunk>): Promise<void> {
    // `message` seeds the assembler: nothing for a fresh answer, the part that had
    // already arrived for a continuation (#151), so what is persisted is the whole of
    // what the reader has seen.
    const seed = seedMessage(entry)

    for await (const snapshot of readUIMessageStream({ stream, ...(seed && { message: seed }) })) {
      entry.message = snapshot
    }
  }

  /**
   * The deadline for a stream that has gone quiet.
   *
   * Reset by every event — reasoning deltas included, so a model that thinks for a
   * long time is not killed mid-thought. It *cancels* rather than settling: whether a
   * silent provider is worth trying again is the retry policy's decision, not the
   * watchdog's.
   */
  private watchIdle(entry: TurnEntry): { reset: () => void; stop: () => void } {
    let timer: NodeJS.Timeout

    const onIdle = (): void => {
      if (entry.execution.isSettled) return
      Logger.warn(
        'ChatStreamManager',
        `Turn ${entry.execution.id} produced nothing for ${this.deps.idleTimeoutMs ?? IDLE_TIMEOUT_MS}ms; cancelling the request`
      )
      entry.timedOut = true
      entry.execution.cancel()
    }

    const arm = (): void => {
      timer = setTimeout(onIdle, this.deps.idleTimeoutMs ?? IDLE_TIMEOUT_MS)
    }

    arm()

    return {
      reset: () => {
        clearTimeout(timer)
        arm()
      },
      stop: () => clearTimeout(timer)
    }
  }

  /**
   * Forward the events, and record the ones that end the turn.
   *
   * The forwarded sequence is the renderer's only view of the stream, so it stops
   * the moment the turn is settled: after a stop, nothing else belongs on the wire.
   */
  private async forward(entry: TurnEntry, stream: ReadableStream<UIMessageChunk>): Promise<void> {
    const reader = stream.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue

        if (entry.execution.isSettled) break

        if (isTerminalChunk(value)) {
          this.recordTerminalChunk(entry, value)
          continue
        }

        entry.execution.begin()
        entry.idle?.reset()
        if (carriesContent(value)) entry.contentSent = true

        entry.seq += 1
        entry.request.emit({
          type: 'chunk',
          executionId: entry.execution.id,
          messageId: entry.execution.messageId,
          seq: entry.seq,
          event: value
        })
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Keep what a terminal chunk carried, without forwarding it.
   *
   * The renderer hears about the end from the manager's `outcome` event, after the
   * write, so a `finish` chunk reaching it first would be a claim the database has
   * not made yet.
   */
  private recordTerminalChunk(entry: TurnEntry, chunk: UIMessageChunk): void {
    if (chunk.type === 'finish') {
      entry.finishReason = chunk.finishReason
      // Usage rides on the terminal chunk's metadata: the UI protocol has no chunk
      // of its own for it (see `ModelClient.streamChat`).
      const usage = (chunk.messageMetadata as { usage?: ChatTokenUsage } | undefined)?.usage
      if (usage) entry.usage = usage
      return
    }

    if (chunk.type === 'error') {
      entry.streamError = chunk.errorText
      return
    }

    // `abort`. A stop the reader asked for has already settled this turn, so the
    // outcome was decided; reaching here means the transport aborted on its own.
    entry.streamError = 'The stream was aborted before the answer was complete.'
  }

  private outcomeFor(entry: TurnEntry): ChatExecutionOutcome {
    if (entry.streamError !== undefined) {
      return failedOutcome(entry.streamError, 'error')
    }
    return classifyTerminal(entry.finishReason)
  }

  /**
   * End the turn, whichever way it ended.
   *
   * This is the only place a turn is persisted and the only place the renderer is
   * told it ended, in that order (#138 invariant 4): a write that fails must not
   * leave the transcript claiming a turn the database does not have.
   */
  private settleTurn(entry: TurnEntry, outcome: ChatExecutionOutcome): void {
    // `null` means the turn had already ended: a signal that arrived after the
    // decision, which must not re-label an answer the reader already has.
    const settled = entry.execution.settle(outcome)
    if (!settled) return

    this.complete(entry, settled)
  }

  private complete(entry: TurnEntry, settled: ChatExecutionOutcome): void {
    const { execution, request, baseMetadata } = entry

    const metadata = this.finalizeMetadata(entry, baseMetadata)

    this.deps.store.saveTurnContent(
      execution.messageId,
      messageText(entry.message),
      messageReasoning(entry.message)
    )
    this.deps.store.saveTurnMetadata(execution.messageId, metadata)
    this.deps.store.saveTurnOutcome(execution.messageId, settled, entry.finishReason, entry.usage)

    // Removed before the announcement so a late event from the stream cannot find
    // this turn and cannot start a second life for it.
    this.turns.delete(execution.id)
    this.turnIdByMessageId.delete(execution.messageId)

    // The one thing the renderer is told about the ending, whatever the status:
    // it is also what closes the consumer it assembled the answer with. A stop is
    // included — #139 chose not to announce one because the renderer had already
    // cleared its state, but a pushed stream needs an end, and `aborted` is not a
    // claim that the answer finished.
    entry.seq += 1
    request.emit({
      type: 'outcome',
      executionId: execution.id,
      messageId: execution.messageId,
      seq: entry.seq,
      outcome: settled,
      finishReason: entry.finishReason,
      usage: entry.usage,
      messageMetadata: metadata
    })

    void this.accountTokens(entry, settled)
  }

  /**
   * The provenance an answer ends up with.
   *
   * An answer that marked sources gets only the grounded ones: a fabricated `[9]`
   * or a quote that is not in its span must not survive as a clickable source
   * (#70). With no markers at all the full evidence set stands — the model simply
   * did not use the marker convention. A partial answer is resolved the same way:
   * the markers it did emit still point at the passages it quoted.
   *
   * The provider's finish reason is **not** copied in here any more. It was a bridge
   * from #137 to #142: the transcript had no status to render from, so the reason
   * rode in the metadata bag. The record has a `finish_reason` column now, and one
   * fact belongs in one place.
   */
  private finalizeMetadata(
    entry: TurnEntry,
    baseMetadata: ChatMessageMetadata
  ): ChatMessageMetadata {
    const { execution, request } = entry
    let metadata: ChatMessageMetadata = baseMetadata

    const resolution = resolveCitations(messageText(entry.message), request.citationContexts)
    if (resolution.matches.length > 0) {
      const grounded: Citation[] = []
      for (const match of resolution.resolved) {
        if (match.citation) grounded.push(match.citation)
      }
      metadata = { ...metadata, citations: grounded }
    }

    Logger.debug(
      'ChatStreamManager',
      `Turn ${execution.id} ended: ${execution.outcome?.status}` +
        (entry.finishReason === undefined ? '' : ` (${entry.finishReason})`)
    )

    return metadata
  }

  /**
   * Token accounting, which happens for every ending and never decides one.
   *
   * A half-finished answer really did consume tokens, so a turn with no reported
   * usage falls back to the estimate rather than being skipped.
   */
  private async accountTokens(entry: TurnEntry, settled: ChatExecutionOutcome): Promise<void> {
    const { request } = entry

    try {
      const tokensUsed =
        entry.usage?.totalTokens ??
        estimateTokens(request.userContent) + estimateTokens(messageText(entry.message))

      Logger.debug(
        'ChatStreamManager',
        `Tokens used in this conversation: ${tokensUsed} (${settled.status})`
      )

      const newSessionId = await this.deps.sessionAutoSwitchService.recordTokenUsageAndCheckSwitch(
        request.sessionId,
        tokensUsed
      )

      if (newSessionId) {
        request.emit({
          type: 'session-auto-switched',
          sessionId: request.sessionId,
          newSessionId
        })
      }
    } catch (error) {
      Logger.error('ChatStreamManager', 'Error while recording turn tokens:', error)
    }
  }
}
