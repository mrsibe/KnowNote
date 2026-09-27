import { readUIMessageStream } from 'ai'
import type { AsyncIterableStream, UIMessage, UIMessageChunk } from 'ai'

/**
 * Readers for the AI SDK's `UIMessage` and its chunk stream.
 *
 * These are the only places besides `ModelClient` that know the SDK's message
 * shape, and they exist so that neither process writes its own merge: Main
 * assembles with the SDK's `readUIMessageStream` and so does the renderer, and the
 * text a KnowNote record stores is read back out of that assembled message rather
 * than re-concatenated from deltas (#141).
 *
 * The epic's seventh invariant says the SDK lives behind the main-process service.
 * The renderer does need an assembler — the alternative is either shipping the
 * whole message on every keystroke or writing a second merge implementation, and
 * both are worse — so it is confined to this module and `ModelClient`. Upgrading
 * the SDK is a change to those two files.
 */

/** An assembled message's text, in the order the model produced it. */
export const messageText = (message: UIMessage | undefined): string =>
  (message?.parts ?? []).flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')

/** An assembled message's reasoning, likewise. */
export const messageReasoning = (message: UIMessage | undefined): string =>
  (message?.parts ?? []).flatMap((part) => (part.type === 'reasoning' ? [part.text] : [])).join('')

/**
 * The text of a chunk stream, consumed to the end.
 *
 * For the one-shot internal generations — a note title, a session summary — which
 * want an answer and have no turn to own.
 */
export const collectMessageText = async (
  stream: AsyncIterableStream<UIMessageChunk>
): Promise<string> => {
  let message: UIMessage | undefined
  for await (const snapshot of readUIMessageStream({ stream })) {
    message = snapshot
  }
  return messageText(message)
}

/**
 * The chunks that end a turn.
 *
 * They are not forwarded to the renderer: the manager decides what a turn was and
 * says so on its own event, after the turn is persisted (#138 invariant 4). The
 * renderer would otherwise learn "finished" from a chunk that arrives before the
 * write, and would have to know that this particular `finish` does not mean what
 * it says.
 */
export const isTerminalChunk = (chunk: UIMessageChunk): boolean =>
  chunk.type === 'finish' || chunk.type === 'error' || chunk.type === 'abort'

/**
 * Whether a received sequence number follows the previous one.
 *
 * A consumer that sees a gap knows it is missing content rather than looking at an
 * answer that is quietly short. Nothing replays yet — that is for the next stage —
 * so this is what turns a silent hole into a reported one.
 */
export const isSequenceContinuing = (previousSeq: number | undefined, seq: number): boolean =>
  previousSeq === undefined || seq === previousSeq + 1
