import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_RETRIEVAL_SCOPE,
  parseRetrievalScope,
  scopeDocumentIds
} from '../src/shared/types/scope.ts'

/**
 * Retrieval scope (#94) is the answer to "which sources does this question use",
 * stored per session. These pin the two things the retrieval path depends on:
 *
 * - `scopeDocumentIds` distinguishes "no restriction" (undefined) from a real
 *   list, so an empty selection cannot be mistaken for "restrict to nothing";
 * - `parseRetrievalScope` is defensive, because the value round-trips through a
 *   JSON column that an older writer or a manual edit may have shaped differently.
 */

test('the default scope is the whole notebook, which means no filter', () => {
  assert.deepEqual(DEFAULT_RETRIEVAL_SCOPE, { type: 'notebook' })
  assert.equal(scopeDocumentIds(DEFAULT_RETRIEVAL_SCOPE), undefined)
  assert.equal(scopeDocumentIds(undefined), undefined)
  assert.equal(scopeDocumentIds(null), undefined)
})

test('a current-source scope resolves to its single document', () => {
  assert.deepEqual(scopeDocumentIds({ type: 'current-source', documentId: 'doc_1' }), ['doc_1'])
})

test('a selected-sources scope resolves to its documents', () => {
  assert.deepEqual(scopeDocumentIds({ type: 'selected-sources', documentIds: ['a', 'b'] }), [
    'a',
    'b'
  ])
})

test('an empty selection means no restriction, not an empty result', () => {
  // The distinction matters: returning `[]` would make a scoped query retrieve
  // nothing, while the user's intent for an empty selection is "use everything".
  assert.equal(scopeDocumentIds({ type: 'selected-sources', documentIds: [] }), undefined)
})

test('parsing accepts the three shapes and drops non-string document ids', () => {
  assert.deepEqual(parseRetrievalScope({ type: 'notebook' }), { type: 'notebook' })
  assert.deepEqual(parseRetrievalScope({ type: 'current-source', documentId: 'd' }), {
    type: 'current-source',
    documentId: 'd'
  })
  assert.deepEqual(parseRetrievalScope({ type: 'selected-sources', documentIds: ['a', 2, 'b'] }), {
    type: 'selected-sources',
    documentIds: ['a', 'b']
  })
})

test('a malformed scope falls back to the whole notebook instead of throwing', () => {
  for (const bad of [
    undefined,
    null,
    'x',
    42,
    {},
    { type: 'nope' },
    { type: 'current-source' },
    { type: 'selected-sources', documentIds: 'nope' }
  ]) {
    assert.deepEqual(parseRetrievalScope(bad), DEFAULT_RETRIEVAL_SCOPE, JSON.stringify(bad))
  }
})
