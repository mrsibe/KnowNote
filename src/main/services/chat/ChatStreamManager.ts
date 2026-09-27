import type { APIMessage, ChatMessageMetadata, ChatTokenUsage } from '../../../shared/types/chat'
import type { ChatExecutionOutcome } from '../../../shared/types/chat'
import type { AnswerSource, RetrievalStatus } from '../../../shared/types/chat'
import type { Citation, CitationContext } from '../../../shared/types/citation'
import { classifyTerminal, failedOutcome } from '../../../shared/utils/chatExecution'
import { resolveCitations } from '../../../shared/utils/citationResolution'
import { estimateTokens } from '../../../shared/utils/tokenEstimate'
import Logger from '../../../shared/utils/logger'
import { ChatExecution } from './ChatExecution'
import type { ChatStreamHandlers, ModelClient } from '../../models/ModelClient'
import type { SessionAutoSwitchService } from '../SessionAutoSwitchService'

/**
 * The Main process owns the turn (#140).
 *
 * Before this, the live state of every turn was an `AbortController` in a `Map`
 * inside the `send-message` IPC handler, and everything else about it — the
 * accumulated text, the usage, whether it had ended — was a local variable in that
 * handler's closure. Nothing could be asked about a turn, and the decision about
 * what it *was* was smeared across four callbacks (#138).
 *
 * Now one object per turn lives here, and every ending goes through
 * `settleTurn` → `complete` in this file:
 *
 * - a stop the renderer asked for (`abort`),
 * - a stream that reported an error, ended, or just broke,
 * - a turn that could not start at all (no prompt, no chat model).
 *
 * That is what makes the epic's invariants hold rather than being conventions: the
 * terminal state is persisted before the renderer is told anything (invariant 4),
 * a turn that has ended is removed so a late signal cannot re-label it
 * (invariant 2), and a failed or stopped turn keeps the partial answer it had
 * (invariant 5).
 *
 * Not in this PR, deliberately: the chunk-stream protocol (#141) and the renderer
 * overlay (#142). The events forwarded here are exactly the ones the renderer
 * already receives.
 */

/**
 * What the turn has to tell the outside world. Deliberately not Electron-shaped:
 * the manager says what happened, the IPC layer decides how that is put on the
 * wire.
 */
type ChatStreamEventBody =
  | { type: 'text-delta'; content: string }
  | { type: 'reasoning-start'; reasoningId?: string }
  | { type: 'reasoning-delta'; content: string; reasoningId?: string }
  | { type: 'reasoning-end'; reasoningId?: string }
  | {
      type: 'finish'
      finishReason?: string
      usage?: ChatTokenUsage
      /** The provenance the renderer's in-memory message has not seen yet. */
      messageMetadata: ChatMessageMetadata
    }
  | { type: 'error'; error: string }
  /** Not about the stream, but it is this turn's ending that triggers it. */
  | { type: 'session-auto-switched'; sessionId: string; newSessionId: string }

/** Every event is about exactly one message, which is what the wire needs. */
export type ChatStreamEvent = { messageId: string } & ChatStreamEventBody

/**
 * The persistence a turn needs, as a port rather than a direct `queries` import.
 *
 * The lifecycle is the part worth testing — "chunks in, one persisted record out" —
 * and four methods are what makes that possible without a database or Electron.
 * `queriesTurnStore` below is the real implementation.
 */
export interface ChatTurnStore {
  createTurn(sessionId: string): { id: string }
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
  /** The message the user sent, for the token estimate when no usage is reported. */
  userContent: string
  /** The prompt as it was assembled, retrieval included. Empty means nothing to send. */
  messages: APIMessage[]
  /** Null when no chat model is configured. */
  client: ModelClient | null
  retrieval: RetrievalStatus
  sources: AnswerSource[]
  citations: Citation[]
  /** Bounds for validating the `[n]` markers the answer may use (#70). */
  citationContexts: CitationContext[]
  emit: (event: ChatStreamEvent) => void
}

interface TurnEntry {
  execution: ChatExecution
  request: ChatTurnRequest
  baseMetadata: ChatMessageMetadata
}

export class ChatStreamManager {
  private readonly turns = new Map<string, TurnEntry>()
  private readonly turnIdByMessageId = new Map<string, string>()

  constructor(
    private readonly deps: {
      store: ChatTurnStore
      sessionAutoSwitchService: Pick<SessionAutoSwitchService, 'recordTokenUsageAndCheckSwitch'>
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
    const turn = this.deps.store.createTurn(request.sessionId)

    const baseMetadata: ChatMessageMetadata = {
      retrieval: request.retrieval,
      sources: request.sources,
      citations: request.citations
    }
    // Written before the model is called: what an answer was built from is known
    // then, and a reload mid-turn should not show an answer with no provenance.
    this.deps.store.saveTurnMetadata(turn.id, baseMetadata)

    const execution = new ChatExecution({
      id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      messageId: turn.id,
      sessionId: request.sessionId,
      notebookId: request.notebookId
    })

    const entry: TurnEntry = { execution, request, baseMetadata }
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

    void this.run(entry, request)

    return execution
  }

  /** The running turn for a message, which is the identity the renderer knows. */
  getByMessageId(messageId: string): ChatExecution | undefined {
    const executionId = this.turnIdByMessageId.get(messageId)
    return executionId === undefined ? undefined : this.turns.get(executionId)?.execution
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

    // Recording the outcome before cancelling upstream is the point: the
    // AbortError that comes back must not get to decide what this turn was.
    const settled = entry.execution.abort(reason)
    if (!settled) return false

    this.complete(entry, settled)
    return true
  }

  private entryByMessageId(messageId: string): TurnEntry | undefined {
    const executionId = this.turnIdByMessageId.get(messageId)
    return executionId === undefined ? undefined : this.turns.get(executionId)
  }

  /**
   * Tell the outside world something about a running turn.
   *
   * The message id is attached here rather than by the caller, so a request can
   * emit during `start()` — the turns that cannot begin at all — without the
   * caller needing the execution it is still being constructed from.
   */
  private forward(entry: TurnEntry, event: ChatStreamEventBody): void {
    entry.request.emit({ messageId: entry.execution.messageId, ...event })
  }

  private async run(entry: TurnEntry, request: ChatTurnRequest): Promise<void> {
    const client = request.client
    if (!client) return

    try {
      await client.sendMessageStream(request.messages, this.handlersFor(entry))
    } catch (error) {
      // `sendMessageStream` reports through its handlers; a throw here means the
      // wiring itself failed, and the turn must not be left running.
      this.settleTurn(entry, failedOutcome((error as Error).message, 'error'))
    }
  }

  private handlersFor(entry: TurnEntry): ChatStreamHandlers {
    const { execution } = entry

    return {
      onChunk: (chunk) => {
        const { metadata, content, done } = chunk

        if (metadata?.reasoningStart) {
          this.forward(entry, { type: 'reasoning-start', reasoningId: metadata.reasoningId })
          return
        }
        if (metadata?.isReasoning) {
          execution.appendReasoning(content)
          this.forward(entry, {
            type: 'reasoning-delta',
            content,
            reasoningId: metadata.reasoningId
          })
          return
        }
        if (metadata?.reasoningEnd) {
          this.forward(entry, { type: 'reasoning-end', reasoningId: metadata.reasoningId })
          return
        }
        if (content) {
          execution.appendText(content)
          this.forward(entry, { type: 'text-delta', content })
          return
        }

        if (!done) return

        // The terminal chunk. What it means for the turn is `classifyTerminal`'s
        // decision, and the reason and usage are recorded with it either way.
        this.settleTurn(entry, classifyTerminal(metadata?.finishReason), {
          finishReason: metadata?.finishReason,
          usage: metadata?.usage
        })
      },
      onError: (error, reason) => {
        this.settleTurn(entry, failedOutcome(error.message, reason))
      },
      onAbort: () => {
        // The stream noticed the cancel. Either `abort()` already settled this
        // turn — in which case this is noise — or something else cancelled the
        // signal, which is still a stop.
        this.settleTurn(entry, failedOutcome('The turn was stopped', 'error'))
      }
    }
  }

  /**
   * End the turn, whichever way it ended.
   *
   * This is the only place a turn is persisted and the only place the renderer is
   * told it ended, in that order (#138 invariant 4): a write that fails must not
   * leave the transcript claiming a turn the database does not have.
   */
  private settleTurn(
    entry: TurnEntry,
    outcome: ChatExecutionOutcome,
    facts: { finishReason?: string; usage?: ChatTokenUsage } = {}
  ): void {
    // `null` means the turn had already ended: a signal that arrived after the
    // decision, which must not re-label an answer the reader already has.
    const settled = entry.execution.settle(outcome, facts)
    if (!settled) return

    this.complete(entry, settled)
  }

  private complete(entry: TurnEntry, settled: ChatExecutionOutcome): void {
    const { execution, baseMetadata } = entry

    const metadata = this.finalizeMetadata(entry, baseMetadata, settled)

    this.deps.store.saveTurnContent(
      execution.messageId,
      execution.content,
      execution.reasoningContent
    )
    this.deps.store.saveTurnMetadata(execution.messageId, metadata)
    this.deps.store.saveTurnOutcome(
      execution.messageId,
      settled,
      execution.finishReason,
      execution.usage
    )

    // Removed before the announcement so a late signal from the stream cannot find
    // this turn and cannot start a second life for it.
    this.turns.delete(execution.id)
    this.turnIdByMessageId.delete(execution.messageId)

    this.announce(entry, settled, metadata)
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
   */
  private finalizeMetadata(
    entry: TurnEntry,
    baseMetadata: ChatMessageMetadata,
    settled: ChatExecutionOutcome
  ): ChatMessageMetadata {
    const { execution, request } = entry
    let metadata: ChatMessageMetadata = baseMetadata

    if (execution.finishReason !== undefined) {
      // The copy the live renderer reads to explain a cut-off answer (#137). #142
      // puts the terminal state on the wire and this stops being written twice.
      metadata = { ...metadata, finishReason: execution.finishReason }
    }

    const resolution = resolveCitations(execution.content, request.citationContexts)
    if (resolution.matches.length > 0) {
      const grounded: Citation[] = []
      for (const match of resolution.resolved) {
        if (match.citation) grounded.push(match.citation)
      }
      metadata = { ...metadata, citations: grounded }
    }

    Logger.debug(
      'ChatStreamManager',
      `Turn ${execution.id} ended: ${settled.status}` +
        (execution.finishReason === undefined ? '' : ` (${execution.finishReason})`)
    )

    return metadata
  }

  /**
   * Tell the renderer the turn ended — after it is in the database.
   *
   * `aborted` is not announced: stopping is something the renderer asked for, and
   * it cleared its streaming state when it did. A second state change it did not
   * ask for is how "stopped" used to look like "finished" (#139). The persisted
   * status is what a reload reads (#142).
   */
  private announce(
    entry: TurnEntry,
    settled: ChatExecutionOutcome,
    metadata: ChatMessageMetadata
  ): void {
    const { execution } = entry

    if (settled.status === 'failed') {
      this.forward(entry, { type: 'error', error: settled.error.message })
      return
    }
    if (settled.status === 'aborted') return

    this.forward(entry, {
      type: 'finish',
      finishReason: execution.finishReason,
      usage: execution.usage,
      messageMetadata: metadata
    })
  }

  /**
   * Token accounting, which happens for every ending and never decides one.
   *
   * A half-finished answer really did consume tokens, so a turn with no reported
   * usage falls back to the estimate rather than being skipped.
   */
  private async accountTokens(entry: TurnEntry, settled: ChatExecutionOutcome): Promise<void> {
    const { execution, request } = entry

    try {
      const tokensUsed =
        execution.usage?.totalTokens ??
        estimateTokens(request.userContent) + estimateTokens(execution.content)

      Logger.debug(
        'ChatStreamManager',
        `Tokens used in this conversation: ${tokensUsed} (${settled.status})`
      )

      const newSessionId = await this.deps.sessionAutoSwitchService.recordTokenUsageAndCheckSwitch(
        request.sessionId,
        tokensUsed
      )

      if (newSessionId) {
        this.forward(entry, {
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
