import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerNoticeKey,
  isAnswerLive,
  keepsPartialAnswer
} from '../src/shared/utils/answerState.ts'
import type { ChatExecutionStatus } from '../src/shared/types/chat.ts'

/**
 * What an ended answer says about itself (#142).
 *
 * One function decides, and it reads the record — `status` and `error`. That is what
 * makes the live overlay and a reloaded message the same statement: both hand the
 * same fields to the same function, so "what was on screen" and "what a reload
 * shows" cannot drift apart the way two rendering paths would.
 */

const STATUSES: ChatExecutionStatus[] = [
  'pending',
  'streaming',
  'completed',
  'truncated',
  'blocked',
  'aborted',
  'failed'
]

test('only a turn that is arriving is live', () => {
  assert.equal(isAnswerLive('pending'), true, 'a turn before its first token is live')
  assert.equal(isAnswerLive('streaming'), true)

  for (const status of ['completed', 'truncated', 'blocked', 'aborted', 'failed'] as const) {
    assert.equal(isAnswerLive(status), false, status)
  }
})

test('a row written before the column existed is unknown, not finished', () => {
  // `null` is "we never recorded it". Reading it as `completed` would claim an
  // answer is whole on no evidence, and reading it as live would spin forever.
  assert.equal(isAnswerLive(null), false)
  assert.equal(isAnswerLive(undefined), false)
  assert.equal(answerNoticeKey({ status: null, error: null }), null)
})

test('every status that ends an answer early explains itself, and completed does not', () => {
  const expected = {
    truncated: 'answerTruncated',
    blocked: 'answerBlocked',
    aborted: 'answerStopped',
    failed: 'answerFailed'
  } as const

  for (const [status, key] of Object.entries(expected)) {
    assert.equal(
      answerNoticeKey({ status: status as ChatExecutionStatus, error: null }),
      key,
      status
    )
  }

  // `completed` needs no line: the answer is the whole story.
  assert.equal(answerNoticeKey({ status: 'completed', error: null }), null)
  assert.equal(answerNoticeKey({ status: 'pending', error: null }), null)
  assert.equal(answerNoticeKey({ status: 'streaming', error: null }), null)
})

test('the notice depends on the record alone, so a reload cannot disagree', () => {
  const error = { message: 'socket hang up' }

  // Two messages that differ in everything except the record's state fields: the
  // same notice, which is the property the acceptance asks for.
  const live = { status: 'failed' as const, error }
  const reloaded = { status: 'failed' as const, error }

  assert.equal(answerNoticeKey(live), answerNoticeKey(reloaded))
  assert.equal(answerNoticeKey(live), 'answerFailed')
})

test('a partial answer is kept for every status that ended it early', () => {
  for (const status of STATUSES) {
    const expected = ['truncated', 'blocked', 'aborted', 'failed'].includes(status)
    assert.equal(keepsPartialAnswer(status), expected, status)
  }
})
