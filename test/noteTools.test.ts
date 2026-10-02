import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NOTE_TOOLS } from '../src/renderer/src/components/notebook/noteTools.ts'

/**
 * The Notes panel's creation tools moved out of the header into a 2 x 2 grid of
 * labelled cards (DESIGN.md, "Tool card"). That grid is the only consumer of the
 * four `tool-*` fills, and the four fills exist only for it. These tests pin the
 * parts a reviewer would otherwise have to eyeball: the order, the token-to-tool
 * mapping, the token definitions in both themes, the scope, and the copy that used
 * to point at a button that is no longer there.
 */

const read = (path: string): string => readFileSync(path, 'utf8')

const rendererSources = (dir: string, files: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) rendererSources(path, files)
    else if (/\.(ts|tsx)$/.test(path)) files.push(path.replace(/\\/g, '/'))
  }
  return files
}

test('the tool grid is create note, mind map, quiz, Anki in that order', () => {
  assert.deepEqual(
    NOTE_TOOLS.map((tool) => tool.id),
    ['note', 'mindmap', 'quiz', 'anki']
  )
})

test('each tool carries its own approved fill and a locale label key', () => {
  assert.deepEqual(
    NOTE_TOOLS.map((tool) => tool.surfaceClassName.split(' ')[0]),
    ['bg-tool-note', 'bg-tool-mindmap', 'bg-tool-quiz', 'bg-tool-anki']
  )
  assert.deepEqual(
    NOTE_TOOLS.map((tool) => tool.labelKey),
    ['createNote', 'generateMindMap', 'generateQuiz', 'generateAnki']
  )
  // The four are distinct; a duplicated token would make two cards indistinguishable.
  assert.equal(new Set(NOTE_TOOLS.map((tool) => tool.surfaceClassName)).size, 4)
})

test('hover retains each opaque tool fill underneath the state overlay', () => {
  for (const tool of NOTE_TOOLS) {
    const [fill, hover] = tool.surfaceClassName.split(' ')
    assert.equal(hover, `hover:${fill}`)
  }
  const panel = read('src/renderer/src/components/notebook/NotePanel.tsx')
  assert.doesNotMatch(panel, /hover:bg-transparent/)
  assert.match(panel, /bg-surface-hover opacity-0 transition-opacity group-hover:opacity-100/)
})

test('theme.css defines a light value, a dark value and a Tailwind mapping per fill', () => {
  const css = read('src/renderer/src/assets/theme.css')

  for (const token of ['tool-note', 'tool-mindmap', 'tool-quiz', 'tool-anki']) {
    const values = css.match(new RegExp(`--${token}: oklch\\(`, 'g')) || []
    assert.equal(values.length, 2, `${token} needs one light and one dark value`)
    assert.ok(css.includes(`--color-${token}: var(--${token})`), `${token} needs a mapping`)
  }
})

test('the tool fills are used only by the Notes tool cards', () => {
  const users = rendererSources(join('src', 'renderer', 'src')).filter((file) =>
    read(file).includes('bg-tool-')
  )
  assert.deepEqual(users, ['src/renderer/src/components/notebook/noteTools.ts'])
})

test('both locales carry the tool labels and point at the card, not a top-right plus', () => {
  for (const locale of ['en-US', 'zh-CN']) {
    const messages = JSON.parse(read(`src/renderer/src/locales/${locale}/notebook.json`))
    for (const key of ['createNote', 'generateMindMap', 'generateQuiz', 'generateAnki']) {
      assert.ok(messages[key], `${locale} is missing ${key}`)
    }
    const description: string = messages.noNotesYetDesc
    assert.ok(description, `${locale} has noNotesYetDesc`)
    assert.doesNotMatch(description, /top right|右上角/)
    // The empty-state hint names the card the user now clicks.
    assert.ok(description.includes(messages.createNote), `${locale} should name the create card`)
  }
})
