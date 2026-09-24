import { test } from 'node:test'
import assert from 'node:assert/strict'
import { titleBarOverlayOptions, titleBarSymbolColor } from '../src/main/windows/titleBarOverlay.ts'
import {
  TITLE_BAR_HEIGHT,
  WINDOW_CONTROLS_WIDTH,
  MAC_TRAFFIC_LIGHTS_WIDTH
} from '../src/shared/utils/windowChrome.ts'

/**
 * Issue #26: the custom title bar's window controls are drawn by the OS with
 * `symbolColor`. In light mode a white symbol sits on the `#fafafa` title bar
 * and becomes invisible, so the symbol colour must follow the app theme.
 */
test('window-control symbols are dark in light mode and light in dark mode', () => {
  assert.equal(titleBarSymbolColor('light'), 'black')
  assert.equal(titleBarSymbolColor('dark'), 'white')
})

test('titleBarOverlay keeps the transparent fill and the title-bar height', () => {
  assert.deepEqual(titleBarOverlayOptions('light'), {
    color: 'rgba(0,0,0,0)',
    height: TITLE_BAR_HEIGHT,
    symbolColor: 'black'
  })
  assert.deepEqual(titleBarOverlayOptions('dark'), {
    color: 'rgba(0,0,0,0)',
    height: TITLE_BAR_HEIGHT,
    symbolColor: 'white'
  })
})

/**
 * The overlay height is only correct if it matches the height the renderer
 * gives the title bar (`h-11` in WindowTitleBar). The two drifted apart once
 * already, which is why the number lives in a shared module and is asserted
 * here rather than being repeated as a literal.
 */
test('the overlay matches the renderer title bar and reserves room for the controls', () => {
  assert.equal(TITLE_BAR_HEIGHT, 44, 'h-11 in WindowTitleBar is 44px')
  assert.equal(WINDOW_CONTROLS_WIDTH, 3 * 46, 'three 46px caption buttons')
  assert.equal(MAC_TRAFFIC_LIGHTS_WIDTH, 80, 'traffic lights at x=16 plus the standard gap')
})
