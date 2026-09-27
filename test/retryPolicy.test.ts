import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_ATTEMPTS,
  isRetryableFailure,
  retryDelayMs,
  shouldRetry
} from '../src/main/services/chat/retryPolicy.ts'
import { failedOutcome } from '../src/shared/utils/chatExecution.ts'

/**
 * When a failed turn is worth attempting again (#150).
 *
 * The direction this is wrong in matters: retrying a deterministic failure costs the
 * reader a second wait for the same error, so only recognisably transient failures
 * qualify and everything else is reported as it is.
 */

test('transient failures are recognised by what the provider said', () => {
  for (const message of [
    'Rate limit reached for requests',
    '429 Too Many Requests',
    'upstream provider returned 500',
    'the server is overloaded',
    'request timed out',
    'socket hang up',
    'fetch failed',
    'read ECONNRESET'
  ]) {
    assert.equal(
      isRetryableFailure(failedOutcome(message, 'error')),
      true,
      `not recognised as transient: ${message}`
    )
  }
})

test('a deterministic failure is not retried, and neither is an unknown one', () => {
  for (const message of [
    'content policy violation',
    'invalid api key',
    'model not found',
    'the request was malformed',
    'No valid conversation history',
    // Unrecognised on purpose: the default is not to retry.
    'something the provider invented'
  ]) {
    assert.equal(
      isRetryableFailure(failedOutcome(message, 'error')),
      false,
      `wrongly treated as transient: ${message}`
    )
  }
})

test('a stream that went quiet or ended without saying anything is the connection’s fault', () => {
  assert.equal(isRetryableFailure(failedOutcome('The model stopped responding.', 'timeout')), true)
  assert.equal(
    isRetryableFailure(failedOutcome('The stream ended without a reason.', 'unexpected_eof')),
    true
  )
})

test('an ending that is not a failure is never retried', () => {
  for (const outcome of [
    { status: 'completed' as const },
    { status: 'truncated' as const },
    { status: 'blocked' as const },
    { status: 'aborted' as const, reason: 'user' as const }
  ]) {
    assert.equal(isRetryableFailure(outcome), false, outcome.status)
  }
})

test('a retry needs a transient failure, room to try, and nothing shown yet', () => {
  const transient = failedOutcome('429 Too Many Requests', 'error')
  const deterministic = failedOutcome('invalid api key', 'error')

  assert.equal(shouldRetry({ outcome: transient, attempt: 1, contentSent: false }), true)
  assert.equal(
    shouldRetry({ outcome: transient, attempt: MAX_ATTEMPTS, contentSent: false }),
    false,
    'the attempts are bounded'
  )
  assert.equal(
    shouldRetry({ outcome: transient, attempt: 1, contentSent: true }),
    false,
    'content has reached the reader, so a second attempt cannot replace it cleanly'
  )
  assert.equal(shouldRetry({ outcome: deterministic, attempt: 1, contentSent: false }), false)
})

test('backoff grows with each attempt, starting immediately after the first failure', () => {
  // The first retry waits a little; later ones wait more, so a provider that is down
  // is not hammered.
  assert.equal(retryDelayMs(2), 500)
  assert.equal(retryDelayMs(3), 1000)
  assert.ok(retryDelayMs(4) > retryDelayMs(3))
})
