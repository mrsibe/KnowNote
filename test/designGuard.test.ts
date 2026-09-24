import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { isChartSurfaceAllowed } from '../scripts/check-design-tokens.mjs'

/**
 * The design guard is a build gate, so a silent hole in it is worse than a
 * missing rule: everything downstream reads "no violations" as proof.
 *
 * The allowlist predicate is tested directly because the first version of it
 * compared a forward-slash pattern against a platform path. On Windows it never
 * matched, so the one file it was written to exempt was the one file it flagged —
 * linux and macOS CI both passed and the Windows job failed.
 */

const ALLOWED = '/components/notebook/mindmap/CustomNode.tsx'

test('the chart allowlist matches a posix path', () => {
  assert.equal(isChartSurfaceAllowed('/home/dev/repo/src/renderer/src' + ALLOWED), true)
})

test('the chart allowlist matches a windows path', () => {
  // The exact shape that failed CI: backslashes from the platform path.
  assert.equal(
    isChartSurfaceAllowed(
      'C:\\dev\\repo\\src\\renderer\\src\\components\\notebook\\mindmap\\CustomNode.tsx'
    ),
    true
  )
})

test('the chart allowlist matches a relative windows path', () => {
  assert.equal(
    isChartSurfaceAllowed('src\\renderer\\src\\components\\notebook\\mindmap\\CustomNode.tsx'),
    true
  )
})

test('the chart allowlist does not match any other file, on either platform', () => {
  const others = [
    '/home/dev/repo/src/renderer/src/components/notebook/item/ItemList.tsx',
    '/home/dev/repo/src/renderer/src/components/notebook/chat/MessageList.tsx',
    'C:\\dev\\repo\\src\\renderer\\src\\components\\notebook\\item\\ItemList.tsx',
    'C:\\dev\\repo\\src\\renderer\\src\\components\\notebook\\mindmap\\CustomNode.tsx.bak',
    ''
  ]
  for (const file of others) {
    assert.equal(isChartSurfaceAllowed(file), false, file)
  }
})

test('a missing path is not allowed', () => {
  assert.equal(isChartSurfaceAllowed(undefined), false)
  assert.equal(isChartSurfaceAllowed(null), false)
})

test('the guard still reports its rules and exits clean on the repository', () => {
  // Read-only end-to-end check: `--list` must name every rule, so deleting one
  // silently is not possible, and a plain run must stay green.
  const list = execFileSync('node', ['scripts/check-design-tokens.mjs', '--list'], {
    encoding: 'utf8'
  })
  for (const id of [
    'radius',
    'shadow',
    'palette',
    'text-level',
    'chart-scope',
    'raw-colour-in-style',
    'css-radius'
  ]) {
    assert.ok(list.includes(id), `--list should mention the ${id} rule`)
  }

  const run = execFileSync('node', ['scripts/check-design-tokens.mjs'], { encoding: 'utf8' })
  assert.match(run, /check:design — no violations\./)
})
