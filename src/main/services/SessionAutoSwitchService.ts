import * as queries from '../db/queries'
import { ConnectionManager } from '../models/ConnectionManager'
import Logger from '../../shared/utils/logger'

/**
 * Session Auto Switch Service
 * Manages session token counting and automatic switching logic
 */
export class SessionAutoSwitchService {
  // Token threshold: 80% of GPT-4 context window (128k tokens)
  private static readonly TOKEN_THRESHOLD = 100000

  private connectionManager: ConnectionManager

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager
  }

  /**
   * Record token usage and check if session switch is needed
   * @returns If session was switched, returns new session ID; otherwise returns null
   */
  async recordTokenUsageAndCheckSwitch(
    sessionId: string,
    tokensUsed: number
  ): Promise<string | null> {
    // Update token count
    const newTotal = queries.updateSessionTokens(sessionId, tokensUsed)

    Logger.debug('SessionAutoSwitch', `Session ${sessionId} current tokens: ${newTotal}`)

    // Check if switch is needed
    if (newTotal && newTotal >= SessionAutoSwitchService.TOKEN_THRESHOLD) {
      Logger.info(
        'SessionAutoSwitch',
        `Token count reached threshold (${newTotal}/${SessionAutoSwitchService.TOKEN_THRESHOLD}), starting session switch...`
      )
      return await this.switchSession(sessionId)
    }

    return null
  }

  /**
   * Switch session: generate summary, archive old session, create new session
   */
  private async switchSession(oldSessionId: string): Promise<string> {
    // 1. Get old session info
    const oldSession = queries.getSessionById(oldSessionId)
    if (!oldSession) {
      throw new Error(`Session ${oldSessionId} not found`)
    }

    // 2. Generate summary
    Logger.info('SessionAutoSwitch', 'Generating session summary...')
    const summary = await this.generateSummary(oldSessionId)

    // 3. Archive old session
    queries.updateSessionSummary(oldSessionId, summary, 'archived')
    Logger.info('SessionAutoSwitch', 'Old session archived')

    // 4. Create new session, set parent session ID
    const newSession = queries.createSession(
      oldSession.notebookId,
      oldSession.title, // Keep same title
      oldSessionId // Set parent session ID to form chain
    )

    // 5. Add lightweight system message in new session (optional)
    // Users shouldn't notice session switch, so simplify prompt
    queries.createMessage(
      newSession.id,
      'system',
      `💡 Context optimized, conversation continues...`
    )

    Logger.info('SessionAutoSwitch', `Created new session: ${newSession.id}`)

    return newSession.id
  }

  /**
   * Generate session summary
   */
  private async generateSummary(sessionId: string): Promise<string> {
    const messages = queries.getMessagesBySession(sessionId)

    // Build summary prompt
    const conversationText = messages
      .filter((m) => m.role !== 'system') // Filter system messages
      .map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
      .join('\n\n')

    const summaryPrompt = `Please concisely summarize the core content of the following conversation, preserving key information, important decisions, and technical details. The summary should be within 300 words.

Conversation content:
${conversationText}

Please provide summary:`

    // Call AI to generate summary
    const client = await this.connectionManager.getChatClient()
    if (!client) {
      // If no model connection configured, return a basic summary
      return `This conversation contains ${messages.length} messages.`
    }

    return new Promise<string>((resolve) => {
      let summaryContent = ''

      client.sendMessageStream(
        [
          {
            role: 'user',
            content: summaryPrompt
          }
        ],
        {
          onChunk: (chunk) => {
            summaryContent += chunk.content
          },
          onError: (error) => {
            Logger.error('SessionAutoSwitch', 'Failed to generate summary:', error)
            // Fallback: return simple summary
            resolve(`This conversation contains ${messages.length} messages.`)
          },
          // Never aborted here: this call owns a fresh controller and nothing
          // cancels it. Resolving keeps the switch from hanging if it ever were.
          onAbort: () => {
            Logger.warn('SessionAutoSwitch', 'Summary generation was aborted')
            resolve(`This conversation contains ${messages.length} messages.`)
          },
          onComplete: () => {
            resolve(summaryContent.trim())
          }
        }
      )
    })
  }
}
