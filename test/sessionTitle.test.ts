import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SESSION_TITLE_MAX_LENGTH,
  continuedSessionTitle,
  deriveSessionTitle
} from '../src/shared/utils/sessionTitle.ts'

/**
 * Session titles are a shared derivation (#97): Main persists the title from the
 * first user message and the renderer shows the same string optimistically, so the
 * two have to agree on the boundary cases — a pasted paragraph, a CJK sentence, and
 * the continuation suffix that keeps an archived chat distinguishable in the list.
 */

test('a short first message becomes the title, whitespace collapsed', () => {
  assert.equal(deriveSessionTitle('  How does   attention work?\n'), 'How does attention work?')
})

test('a long title is cut at a word boundary, never mid-word', () => {
  const message =
    'Explain the derivation of the scaled dot product attention complexity in detail please'
  const title = deriveSessionTitle(message)

  assert.ok(title.length <= SESSION_TITLE_MAX_LENGTH + 1, 'title overshot the limit')
  assert.ok(title.endsWith('…'), 'a truncated title is marked as one')
  assert.equal(title, `${message.slice(0, title.length - 1).trimEnd()}…`)
  assert.ok(!title.includes('  '), 'collapsing left a double space')
})

test('a CJK message with no spaces is cut hard rather than word-split', () => {
  const message = `${'请详细解释注意力机制的复杂度推导过程以及它和循环神经网络之间的区别'.repeat(3)}`
  assert.ok(message.length > SESSION_TITLE_MAX_LENGTH, 'the fixture must exceed the limit')
  const title = deriveSessionTitle(message)

  assert.ok(title.length <= SESSION_TITLE_MAX_LENGTH + 1)
  assert.ok(title.endsWith('…'))
})

test('a continuation title carries its position and stays distinguishable', () => {
  assert.equal(continuedSessionTitle('Understanding attention', 3), 'Understanding attention (3)')
})

test('a continuation of an empty title still gets a usable name', () => {
  assert.equal(continuedSessionTitle('   ', 2), 'Chat (2)')
})

test('a very long base title is shortened before the sequence suffix', () => {
  const base = 'a'.repeat(SESSION_TITLE_MAX_LENGTH)
  const title = continuedSessionTitle(base, 12)

  assert.ok(title.length <= SESSION_TITLE_MAX_LENGTH)
  assert.ok(title.endsWith(' (12)'))
})
