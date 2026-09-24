import { test } from 'node:test'
import assert from 'node:assert/strict'
import { titleBarOverlayOptions, titleBarSymbolColor } from '../src/main/windows/titleBarOverlay.ts'

/**
 * Issue #26: the custom title bar's window controls are drawn by the OS with
 * `symbolColor`. In light mode a white symbol sits on the `#fafafa` title bar
 * and becomes invisible, so the symbol colour must follow the app theme.
 */
test('window-control symbols are dark in light mode and light in dark mode', () => {
  assert.equal(titleBarSymbolColor('light'), 'black')
  assert.equal(titleBarSymbolColor('dark'), 'white')
})

test('titleBarOverlay keeps the transparent fill and fixed height', () => {
  assert.deepEqual(titleBarOverlayOptions('light'), {
    color: 'rgba(0,0,0,0)',
    height: 35,
    symbolColor: 'black'
  })
  assert.deepEqual(titleBarOverlayOptions('dark'), {
    color: 'rgba(0,0,0,0)',
    height: 35,
    symbolColor: 'white'
  })
})
