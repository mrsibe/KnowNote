import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_RECENT_NOTEBOOKS,
  parseRecentlyOpened,
  recentlyOpenedIds,
  recordNotebookOpened,
  type RecentlyOpenedNotebook
} from '../src/renderer/src/lib/recentlyOpened.ts'

/**
 * This record is the only place "where was I" is stored, and it is read back from
 * `localStorage`, which any earlier version of the app — or the user — could have
 * written. The parsing is therefore asserted per entry, not just on the happy path.
 */

const entry = (notebookId: string, at: number): RecentlyOpenedNotebook => ({ notebookId, at })

test('nothing stored reads as an empty list', () => {
  assert.deepEqual(parseRecentlyOpened(null), [])
  assert.deepEqual(parseRecentlyOpened(''), [])
})

test('a corrupt or non-array value reads as an empty list instead of throwing', () => {
  assert.deepEqual(parseRecentlyOpened('{'), [])
  assert.deepEqual(parseRecentlyOpened('"a string"'), [])
  assert.deepEqual(parseRecentlyOpened('{"notebookId":"a","at":1}'), [])
  assert.deepEqual(parseRecentlyOpened('42'), [])
})

test('one malformed entry does not discard the good ones', () => {
  const raw = JSON.stringify([
    { notebookId: 'keep', at: 10 },
    { notebookId: '', at: 20 },
    { notebookId: 'no-timestamp' },
    { at: 30 },
    null,
    'nope',
    { notebookId: 'keep2', at: 'not a number' },
    { notebookId: 'keep3', at: 5 }
  ])
  assert.deepEqual(recentlyOpenedIds(parseRecentlyOpened(raw)), ['keep', 'keep3'])
})

test('NaN and Infinity timestamps are rejected: they cannot be ordered', () => {
  const raw = JSON.stringify([
    { notebookId: 'nan', at: Number.NaN },
    { notebookId: 'inf', at: Number.POSITIVE_INFINITY },
    { notebookId: 'ok', at: 1 }
  ])
  assert.deepEqual(recentlyOpenedIds(parseRecentlyOpened(raw)), ['ok'])
})

test('the stored order is not trusted: entries come back newest first', () => {
  const raw = JSON.stringify([entry('old', 1), entry('new', 3), entry('mid', 2)])
  assert.deepEqual(recentlyOpenedIds(parseRecentlyOpened(raw)), ['new', 'mid', 'old'])
})

test('a duplicate id keeps its newest timestamp and appears once', () => {
  const raw = JSON.stringify([entry('a', 1), entry('b', 2), entry('a', 9)])
  assert.deepEqual(parseRecentlyOpened(raw), [entry('a', 9), entry('b', 2)])
})

test('opening a notebook puts it first without duplicating it', () => {
  const before = [entry('a', 30), entry('b', 20), entry('c', 10)]
  const after = recordNotebookOpened(before, 'c', 40)
  assert.deepEqual(recentlyOpenedIds(after), ['c', 'a', 'b'])
})

test('opening a notebook that is not in the list adds it at the front', () => {
  const after = recordNotebookOpened([entry('a', 30)], 'fresh', 40)
  assert.deepEqual(recentlyOpenedIds(after), ['fresh', 'a'])
})

test('the list is capped, and it is the oldest that falls off', () => {
  let entries: RecentlyOpenedNotebook[] = []
  for (let i = 0; i < MAX_RECENT_NOTEBOOKS + 5; i += 1) {
    entries = recordNotebookOpened(entries, `nb-${i}`, i)
  }
  assert.equal(entries.length, MAX_RECENT_NOTEBOOKS)
  assert.equal(entries[0].notebookId, `nb-${MAX_RECENT_NOTEBOOKS + 4}`)
  assert.ok(!recentlyOpenedIds(entries).includes('nb-0'))
})

test('recording is pure: it does not mutate the list it was given', () => {
  const before = [entry('a', 1)]
  const snapshot = structuredClone(before)
  recordNotebookOpened(before, 'b', 2)
  assert.deepEqual(before, snapshot)
})
