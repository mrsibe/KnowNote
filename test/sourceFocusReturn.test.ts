import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rememberSourceOrigin,
  restoreSourceOriginFocus,
  type FocusableOrigin
} from '../src/renderer/src/hooks/sourceFocusReturn.ts'

/**
 * #65 returned focus to the element that opened the reader. The handoff has two
 * failure modes worth pinning: restoring a stale element from a previous visit,
 * and trying a disconnected element twice. The module is deliberately structural
 * (`isConnected` + `focus`) so both can be exercised without a DOM.
 */
function fakeOrigin(over: Partial<FocusableOrigin> = {}): {
  element: FocusableOrigin
  focusCalls: () => number
} {
  let focusCalls = 0
  const element: FocusableOrigin = {
    isConnected: true,
    focus: () => {
      focusCalls += 1
    },
    ...over
  }
  return { element, focusCalls: () => focusCalls }
}

test('restore focuses a connected origin once and clears it', () => {
  const { element, focusCalls } = fakeOrigin()
  rememberSourceOrigin(element)

  assert.equal(restoreSourceOriginFocus(), true)
  assert.equal(focusCalls(), 1)

  // A second close must not focus the same element again.
  assert.equal(restoreSourceOriginFocus(), false)
  assert.equal(focusCalls(), 1)
})

test('restore refuses a disconnected origin and does not retry it', () => {
  const { element, focusCalls } = fakeOrigin({ isConnected: false })
  rememberSourceOrigin(element)

  assert.equal(restoreSourceOriginFocus(), false)
  assert.equal(focusCalls(), 0)

  // The stale element was cleared with the failed attempt.
  assert.equal(restoreSourceOriginFocus(), false)
  assert.equal(focusCalls(), 0)
})

test('restore with no recorded origin reports false', () => {
  rememberSourceOrigin(null)
  assert.equal(restoreSourceOriginFocus(), false)
})

test('remembering null clears a previous origin', () => {
  const { element, focusCalls } = fakeOrigin()
  rememberSourceOrigin(element)
  rememberSourceOrigin(null)

  assert.equal(restoreSourceOriginFocus(), false)
  assert.equal(focusCalls(), 0)
})
