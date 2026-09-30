import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { defaultShortcuts } from '../src/main/config/defaults.ts'
import { ShortcutAction } from '../src/shared/types/index.ts'
import { migrateShortcuts } from '../src/shared/utils/shortcutMigration.ts'

const close = defaultShortcuts.find((entry) => entry.action === ShortcutAction.CLOSE_NOTEBOOK)!

test('close notebook defaults to Ctrl/Cmd+D and migrates retired defaults', () => {
  assert.equal(close.accelerator, 'CommandOrControl+D')
  for (const accelerator of ['Escape', 'CommandOrControl+W']) {
    const stored = [{ ...close, accelerator, enabled: false }]
    const migrated = migrateShortcuts(stored, defaultShortcuts)
    assert.equal(migrated[0].accelerator, 'CommandOrControl+D')
    assert.equal(migrated[0].enabled, false)
    assert.equal(stored[0].accelerator, accelerator)
    assert.deepEqual(migrateShortcuts(migrated, defaultShortcuts), migrated)
  }
})

test('migration preserves custom close shortcuts and adds missing actions', () => {
  const migrated = migrateShortcuts(
    [{ ...close, accelerator: 'CommandOrControl+Shift+D' }],
    defaultShortcuts
  )
  assert.equal(migrated[0].accelerator, 'CommandOrControl+Shift+D')
  assert.equal(migrated.length, defaultShortcuts.length)
})

test('panel shortcuts use header toggle handlers, citation requests use reveal only', () => {
  const source = readFileSync(
    new URL('../src/renderer/src/components/layouts/ResizableLayout.tsx', import.meta.url),
    'utf8'
  )
  for (const [event, handler] of [
    ['shortcut:toggle-knowledge-base', 'toggleLeftPanel'],
    ['shortcut:toggle-creative-space', 'toggleRightPanel']
  ]) {
    assert.ok(source.includes(`window.addEventListener('${event}', ${handler})`))
    assert.ok(source.includes(`window.removeEventListener('${event}', ${handler})`))
  }
  assert.ok(source.includes('window.addEventListener(REVEAL_LIBRARY_EVENT, revealLibrary)'))
})
