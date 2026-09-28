import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BACK_TO_BOTTOM_BOTTOM,
  COMPOSER_GAP,
  COMPOSER_RESERVE,
  COMPOSER_RESERVE_FALLBACK,
  COMPOSER_RESERVE_VAR,
  PINNED_THRESHOLD,
  distanceToBottom,
  isPinnedToBottom
} from '../src/renderer/src/components/notebook/chat/stickToBottom.ts'

/**
 * The follow state is what decides whether a streaming answer drags the reader
 * along. Getting the distance wrong in either direction is visible: too strict
 * and the follow silently stops working, too loose and scrolling up to re-read
 * is impossible. These assertions pin the arithmetic, not the DOM.
 */

test('distance to the bottom is the space below the viewport', () => {
  assert.equal(distanceToBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 300 }), 300)
})

test('a viewport resting exactly at the bottom has zero distance', () => {
  assert.equal(distanceToBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 }), 0)
})

test('fractional pixels past the end clamp to zero, never negative', () => {
  // Font metrics and sub-pixel layout routinely make this sum slightly negative
  // at the end. A negative distance must still read as "at the bottom".
  const distance = distanceToBottom({ scrollHeight: 1000.4, scrollTop: 700.6, clientHeight: 300 })
  assert.ok(distance >= 0)
})

test('height yet to be laid out does not produce a distance', () => {
  assert.equal(distanceToBottom({ scrollHeight: 0, scrollTop: 0, clientHeight: 0 }), 0)
})

test('within the threshold counts as pinned', () => {
  // 40px from the end, under the 48px threshold.
  assert.equal(isPinnedToBottom({ scrollHeight: 1000, scrollTop: 660, clientHeight: 300 }), true)
})

test('exactly the threshold still counts as pinned', () => {
  assert.equal(
    isPinnedToBottom({ scrollHeight: 1000, scrollTop: 652, clientHeight: 300 }),
    true,
    'a boundary comparison must be inclusive, or the follow flickers at the edge'
  )
})

test('beyond the threshold is not pinned', () => {
  assert.equal(isPinnedToBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 300 }), false)
})

test('the threshold is overridable', () => {
  const metrics = { scrollHeight: 1000, scrollTop: 600, clientHeight: 300 }
  assert.equal(isPinnedToBottom(metrics, 100), true)
  assert.equal(isPinnedToBottom(metrics, 99), false)
})

test('the default threshold is the documented 48px', () => {
  assert.equal(PINNED_THRESHOLD, 48)
})

test('the reserve reads the composer variable with a usable fallback', () => {
  assert.equal(COMPOSER_RESERVE, `var(${COMPOSER_RESERVE_VAR}, ${COMPOSER_RESERVE_FALLBACK}px)`)
})

test('the back-to-bottom control sits above the composer, under the last message', () => {
  // Reserve runs from the viewport bottom to COMPOSER_GAP above the composer;
  // the button's lower edge is another BACK_TO_BOTTOM_GAP above the composer.
  const reserve = 200
  const buttonBottom = reserve - (COMPOSER_GAP + 8)
  // Button bottom is inside the reserve, nowhere near the viewport bottom.
  assert.ok(buttonBottom > 0 && buttonBottom < reserve)
  assert.equal(
    BACK_TO_BOTTOM_BOTTOM,
    `calc(var(${COMPOSER_RESERVE_VAR}, ${COMPOSER_RESERVE_FALLBACK}px) - ${COMPOSER_GAP + 8}px)`
  )
})
