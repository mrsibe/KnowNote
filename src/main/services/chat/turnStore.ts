import * as queries from '../../db/queries'
import type { ChatTurnStore } from './ChatStreamManager'

/**
 * The ChatStreamManager's persistence port, over Drizzle.
 *
 * Kept in its own module so the manager itself stays free of the database layer:
 * `db/index` reaches for `electron`, and importing it from the manager would make
 * the turn lifecycle impossible to drive in a test without an Electron process.
 * The manager declares what it needs; this is the one place that knows how it is
 * really stored.
 */
export const queriesTurnStore: ChatTurnStore = {
  createTurn: (sessionId, attemptOf) =>
    queries.createMessage(sessionId, 'assistant', '', { status: 'streaming', attemptOf }),
  saveTurnMetadata: (messageId, metadata) => queries.updateMessageMetadata(messageId, metadata),
  saveTurnContent: (messageId, content, reasoningContent) =>
    queries.updateMessageContent(messageId, content, reasoningContent),
  saveTurnOutcome: (messageId, outcome, finishReason, usage) =>
    queries.finishMessageTurn(messageId, outcome, finishReason, usage)
}
