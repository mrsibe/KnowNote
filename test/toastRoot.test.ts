import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * #178: there must be exactly one `<Toaster />`, at the app root.
 *
 * sonner replays every still-active toast to a late subscriber, so a toaster that
 * only exists while a note is open holds toasts fired from anywhere else (imports,
 * saves, excerpts) and releases them in a burst when a note is next opened. This
 * guard keeps a second mount from reappearing, wherever it is added.
 */

const RENDERER_DIR = join('src', 'renderer', 'src')

function sourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, files)
    else if (/\.(tsx|ts)$/.test(path)) files.push(path)
  }
  return files
}

test('the app renders exactly one Toaster, at the root', () => {
  const mounts: string[] = []

  for (const file of sourceFiles(RENDERER_DIR)) {
    const source = readFileSync(file, 'utf8')
    if (source.includes('<Toaster')) mounts.push(file)
  }

  assert.deepEqual(
    mounts,
    [join(RENDERER_DIR, 'App.tsx')],
    'a second <Toaster /> was mounted somewhere other than the app root'
  )
})

test('the note editor does not own a toaster', () => {
  const editor = readFileSync(
    join(RENDERER_DIR, 'components', 'notebook', 'note', 'NoteEditor.tsx'),
    'utf8'
  )
  assert.ok(!editor.includes('<Toaster'), 'NoteEditor must not render its own Toaster (#178)')
  assert.ok(
    !/from '\.\.\/\.\.\/ui\/sonner'/.test(editor),
    'NoteEditor must not import the Toaster component'
  )
})

test('repeatable toasts carry a stable id so they update instead of stacking', () => {
  const notePanel = readFileSync(
    join(RENDERER_DIR, 'components', 'notebook', 'NotePanel.tsx'),
    'utf8'
  )
  assert.ok(
    notePanel.includes('id: `note-saved:${currentNote.id}`'),
    'note save must key its toast to the note'
  )

  const sourcePanel = readFileSync(
    join(RENDERER_DIR, 'components', 'notebook', 'SourcePanel.tsx'),
    'utf8'
  )
  assert.ok(
    sourcePanel.includes('id: `excerpt:${currentNote.id}`'),
    'excerpt append must key its toast to the note'
  )
  assert.ok(
    sourcePanel.includes('id: `import-failed:${name}`'),
    'import failure must key its toast to the file'
  )

  const editor = readFileSync(
    join(RENDERER_DIR, 'components', 'notebook', 'note', 'NoteEditor.tsx'),
    'utf8'
  )
  assert.ok(
    editor.includes("id: 'excerpt-source-missing'"),
    'the missing-source toast must be keyed'
  )
})
