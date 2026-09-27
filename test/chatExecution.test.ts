import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  abortedOutcome,
  classifyFinishReason,
  classifyTerminal,
  failedOutcome,
  settleOutcome
} from '../src/shared/utils/chatExecution.ts'
import type { ChatExecutionOutcome } from '../src/shared/types/chat.ts'

/**
 * What a turn is allowed to become (#138).
 *
 * These are the rules the whole chat path rests on, and they are pure functions
 * so they can be pinned without a provider, a database or an Electron process:
 *
 *   1. a provider reason maps to a product status, and the two are not the same
 *      vocabulary (`length` is a completion with a known defect)
 *   2. a missing terminal signal is a failure, never a completion
 *   3. a turn settles exactly once, and the first terminal signal wins
 */

test('a provider reason maps to the status the transcript renders', () => {
  assert.deepEqual(classifyFinishReason('stop'), { status: 'completed' })
  assert.deepEqual(classifyFinishReason('tool-calls'), { status: 'completed' })

  // Truncation is not a failure: the answer exists and the reader keeps it. It is
  // also not a completion, because it is not the whole answer (#137).
  assert.deepEqual(classifyFinishReason('length'), { status: 'truncated' })

  // The provider refused. Not the model's own decision, and it must not look like
  // an ordinary ending.
  assert.deepEqual(classifyFinishReason('content-filter'), { status: 'blocked' })
})

test('an error reason fails the turn, and an unnamed one still completes it', () => {
  const failed = classifyFinishReason('error')
  assert.equal(failed.status, 'failed')
  assert.equal(failed.status === 'failed' && failed.reason, 'error')

  // A terminal signal is a statement that the provider stopped, even when it
  // declines to say why. Only the absence of one is a failure.
  for (const reason of ['unknown', 'other']) {
    assert.deepEqual(classifyFinishReason(reason), { status: 'completed' }, reason)
  }
})

test('no terminal signal at all is a failure, not a completion', () => {
  // The assumption this file exists to remove: `for await` finishing is not a
  // success signal, and the old code could not express the difference.
  const outcome = classifyTerminal(undefined)

  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.status === 'failed' && outcome.reason, 'unexpected_eof')
})

test('an explicit reason is classified, not defaulted', () => {
  // `classifyTerminal` must not swallow its argument: the two branches are
  // different statements and a caller passing a real reason gets that reason.
  assert.deepEqual(classifyTerminal('length'), { status: 'truncated' })
  assert.deepEqual(classifyTerminal('stop'), { status: 'completed' })
})

test('a stopped turn is never a completed one', () => {
  assert.deepEqual(abortedOutcome('user'), { status: 'aborted', reason: 'user' })
  assert.deepEqual(abortedOutcome('shutdown'), { status: 'aborted', reason: 'shutdown' })
})

test('the first terminal signal wins, in both orders', () => {
  const failed = failedOutcome('upstream 500', 'error')
  const completed: ChatExecutionOutcome = { status: 'completed' }

  // The SDK keeps delivering after an `error` part, and the loop used to reach its
  // own `done` chunk afterwards: the broken turn was reported as finished.
  assert.deepEqual(settleOutcome(failed, completed), failed)
  assert.deepEqual(settleOutcome(completed, failed), completed)

  // A turn that has ended cannot be re-labelled by whatever arrives next —
  // including an abort that the user pressed while the answer was already done.
  assert.deepEqual(settleOutcome(failed, abortedOutcome('user')), failed)
})

test('an unsettled turn takes the signal it is given', () => {
  const outcome: ChatExecutionOutcome = { status: 'truncated' }
  assert.deepEqual(settleOutcome(undefined, outcome), outcome)
})
