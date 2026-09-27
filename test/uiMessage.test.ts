import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { UIMessage, UIMessageChunk } from 'ai'
import {
  isSequenceContinuing,
  isTerminalChunk,
  messageReasoning,
  messageText
} from '../src/shared/utils/uiMessage.ts'

/**
 * Reading the SDK's assembled message, and telling a delivered stream from a stream
 * with a hole in it (#141).
 *
 * These are the only two things KnowNote does with the SDK's own shapes: it reads
 * the answer text out of the message the SDK assembled (rather than re-joining
 * deltas), and it decides whether an event ends a turn.
 */

const message = (parts: UIMessage['parts']): UIMessage => ({
  id: 'msg_1',
  role: 'assistant',
  parts
})

test('the answer is read out of the assembled parts, in order', () => {
  assert.equal(
    messageText(
      message([
        { type: 'step-start' },
        { type: 'reasoning', text: 'thinking', state: 'done' },
        { type: 'text', text: 'the ', state: 'done' },
        { type: 'text', text: 'answer', state: 'done' }
      ])
    ),
    'the answer'
  )
})

test('reasoning is read separately from the answer', () => {
  assert.equal(
    messageReasoning(
      message([
        { type: 'reasoning', text: 'thinking', state: 'done' },
        { type: 'text', text: 'the answer', state: 'done' }
      ])
    ),
    'thinking'
  )
})

test('a message that does not exist yet reads as empty, not as undefined', () => {
  // A turn that never started, or one whose events have not arrived: both are the
  // empty answer, and neither should put the string "undefined" on screen.
  assert.equal(messageText(undefined), '')
  assert.equal(messageReasoning(undefined), '')
  assert.equal(messageText(message([])), '')
})

test('exactly the chunks that end a turn are terminal', () => {
  for (const type of ['finish', 'error', 'abort'] as const) {
    assert.equal(isTerminalChunk({ type } as UIMessageChunk), true, type)
  }

  // Deliberately not terminal: these carry content or structure the renderer needs,
  // and the manager's own outcome event is what ends the turn.
  for (const type of [
    'start',
    'start-step',
    'finish-step',
    'text-start',
    'text-delta',
    'text-end'
  ] as const) {
    assert.equal(isTerminalChunk({ type } as UIMessageChunk), false, type)
  }
})

test('a sequence is continuing when it follows, and not otherwise', () => {
  assert.equal(isSequenceContinuing(undefined, 1), true, 'the first event cannot be a gap')
  assert.equal(isSequenceContinuing(1, 2), true)
  assert.equal(isSequenceContinuing(7, 8), true)

  assert.equal(isSequenceContinuing(1, 3), false, 'a dropped event is a gap')
  assert.equal(isSequenceContinuing(2, 1), false, 'an event out of order is a gap')
  assert.equal(isSequenceContinuing(2, 2), false, 'a repeated sequence number is a gap')
})
