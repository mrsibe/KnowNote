import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTAINER_PADDING_X,
  DEFAULT_LEFT_WIDTH,
  DEFAULT_RIGHT_WIDTH,
  HANDLE_WIDTH,
  KEYBOARD_STEP,
  KEYBOARD_STEP_FAST,
  MIN_CENTER_WIDTH,
  MIN_SIDE_WIDTH,
  availableFrom,
  calculateGoldenRatioWidths,
  isResizeKey,
  maxSideWidth,
  nextPanelWidth,
  parseStoredWidths
} from '../src/renderer/src/components/layouts/panelGeometry.ts'

/**
 * These exist because the resize arithmetic was only reachable by dragging a
 * mouse, and it was wrong in a way nothing could catch: `ArrowLeft` grew the left
 * panel and shrank the right one, so the two seams told a screen-reader user the
 * opposite of what they had pressed. It passed typecheck and lint. The second
 * critique run found it; this file is what should have found it.
 */

const WIDE = 1400

test('available space subtracts the container padding and both seams', () => {
  assert.equal(availableFrom(WIDE), WIDE - CONTAINER_PADDING_X - HANDLE_WIDTH * 2)
})

test('available space never goes negative in a tiny container', () => {
  assert.equal(availableFrom(4), 0)
  assert.equal(availableFrom(0), 0)
})

test('a side panel may not squeeze the centre below its minimum', () => {
  const other = 300
  assert.equal(maxSideWidth(other, WIDE), availableFrom(WIDE) - other - MIN_CENTER_WIDTH)
})

test('a side panel keeps its own minimum when the window is too narrow', () => {
  // 700px cannot hold 260 + 420 + 260. The sides hold their minimum and the
  // centre absorbs the shortfall rather than a side being clamped to nothing.
  assert.equal(maxSideWidth(300, 700), MIN_SIDE_WIDTH)
})

test('the golden ratio split is symmetric and divides the free space', () => {
  const { left, right } = calculateGoldenRatioWidths(WIDE)
  assert.equal(left, right)
  assert.ok(left > 0)
  assert.ok(left < availableFrom(WIDE) / 2, 'a side is narrower than half the free space')
})

test('isResizeKey accepts exactly the four resize keys', () => {
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    assert.equal(isResizeKey(key), true, key)
  }
  for (const key of ['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'a', '']) {
    assert.equal(isResizeKey(key), false, key)
  }
})

test('arrow keys move the seam: the left panel grows with ArrowRight', () => {
  const current = 400
  const max = 900
  assert.equal(nextPanelWidth('ArrowRight', 'left', current, max, false), current + KEYBOARD_STEP)
  assert.equal(nextPanelWidth('ArrowLeft', 'left', current, max, false), current - KEYBOARD_STEP)
})

test('arrow keys move the seam: the right panel grows with ArrowLeft', () => {
  const current = 400
  const max = 900
  assert.equal(nextPanelWidth('ArrowLeft', 'right', current, max, false), current + KEYBOARD_STEP)
  assert.equal(nextPanelWidth('ArrowRight', 'right', current, max, false), current - KEYBOARD_STEP)
})

test('the same arrow key moves the two seams in opposite directions', () => {
  // The regression: both seams moved the same way, so the value a user heard
  // changed opposite to the key they pressed on one of them.
  const current = 400
  const max = 900
  const leftDelta = nextPanelWidth('ArrowRight', 'left', current, max, false) - current
  const rightDelta = nextPanelWidth('ArrowRight', 'right', current, max, false) - current
  assert.equal(leftDelta, -rightDelta)
})

test('Shift uses the larger step on both seams', () => {
  assert.equal(nextPanelWidth('ArrowRight', 'left', 400, 900, true), 400 + KEYBOARD_STEP_FAST)
  assert.equal(nextPanelWidth('ArrowLeft', 'right', 400, 900, true), 400 + KEYBOARD_STEP_FAST)
})

test('Home and End go to the minimum and maximum of the value on both seams', () => {
  for (const side of ['left', 'right'] as const) {
    assert.equal(nextPanelWidth('Home', side, 400, 900, false), MIN_SIDE_WIDTH, side)
    assert.equal(nextPanelWidth('End', side, 400, 900, false), 900, side)
  }
})

test('a keyboard resize stays inside the constraints', () => {
  const max = 900
  for (const side of ['left', 'right'] as const) {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End'] as const) {
      for (const current of [0, MIN_SIDE_WIDTH, 400, max, 10_000]) {
        const next = nextPanelWidth(key, side, current, max, false)
        assert.ok(next >= MIN_SIDE_WIDTH, `${side} ${key} from ${current} -> ${next}`)
        assert.ok(next <= max, `${side} ${key} from ${current} -> ${next}`)
      }
    }
  }
})

test('a max below the minimum cannot invert the clamp', () => {
  // maxSideWidth floors at MIN_SIDE_WIDTH, so this cannot happen in the app — but
  // the clamp must not produce a width below the minimum if it ever did.
  const next = nextPanelWidth('End', 'left', 400, MIN_SIDE_WIDTH - 100, false)
  assert.equal(next, MIN_SIDE_WIDTH)
})

test('stored widths are parsed only when both sides are finite numbers', () => {
  assert.deepEqual(parseStoredWidths('{"left":320,"right":360}'), { left: 320, right: 360 })

  // absent, corrupt, or structurally wrong: all treated as "nothing stored"
  for (const raw of [
    null,
    '',
    'not json',
    '{}',
    'null',
    '"a string"',
    '42',
    '[1,2]',
    '{"left":320}',
    '{"left":320,"right":"360"}',
    '{"left":null,"right":360}',
    '{"left":320,"right":null}'
  ]) {
    assert.equal(parseStoredWidths(raw), null, String(raw))
  }
})

test('stored widths reject NaN and Infinity, which JSON cannot express but a bug can', () => {
  // JSON.parse turns bare `NaN` into a parse error and `1e999` into Infinity.
  assert.equal(parseStoredWidths('{"left":NaN,"right":360}'), null)
  assert.equal(parseStoredWidths('{"left":1e999,"right":360}'), null)
  assert.equal(parseStoredWidths('{"left":-1e999,"right":360}'), null)
})

test('stored widths accept zero, which is a collapsed panel rather than a corrupt entry', () => {
  assert.deepEqual(parseStoredWidths('{"left":0,"right":360}'), { left: 0, right: 360 })
})

test('the documented fallbacks are usable widths', () => {
  for (const value of [DEFAULT_LEFT_WIDTH, DEFAULT_RIGHT_WIDTH, MIN_SIDE_WIDTH]) {
    assert.ok(Number.isFinite(value) && value >= MIN_SIDE_WIDTH, String(value))
  }
})
