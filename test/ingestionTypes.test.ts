import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INGESTION_STAGES, isTerminalStage } from '../src/main/services/ingestion/types.ts'

/**
 * The ingestion state machine (#160) is what #95, #98 and #158 agree on. The one
 * property worth pinning now is the split between an in-progress stage and a
 * terminal one: retry/advance logic keys off it, and a stage that is classified
 * wrongly would let a finished run be advanced or a running one be retried.
 */

test('ingestion stages split into in-progress and terminal', () => {
  for (const stage of [
    'queued',
    'copying',
    'parsing',
    'chunking',
    'embedding',
    'finalizing'
  ] as const) {
    assert.equal(isTerminalStage(stage), false, `${stage} should not be terminal`)
  }

  for (const stage of ['completed', 'failed', 'cancelled'] as const) {
    assert.equal(isTerminalStage(stage), true, `${stage} should be terminal`)
  }
})

test('every declared stage is classified exactly once', () => {
  const terminal = new Set(['completed', 'failed', 'cancelled'])

  for (const stage of INGESTION_STAGES) {
    assert.equal(isTerminalStage(stage), terminal.has(stage), `misclassified: ${stage}`)
  }
})
