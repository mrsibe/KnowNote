import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 自定义 scheme 特权只能提交一次。
 *
 * `protocol.registerSchemesAsPrivileged()` 是**替换**而不是追加：第二个调用会把上一张
 * 表整个覆盖。`knownote-asset` 单独注册时顶掉了 `knownote-doc` 的 `supportFetchAPI`，
 * 渲染进程再 `fetch('knownote-doc://...')` 就报 `URL scheme ... is not supported`，
 * PDF Reader 全挂（#135）。
 *
 * 这条护栏把「只能有一个提交点」钉住；真正的行为检查在 `smokeTest.ts` 里，用真实
 * 渲染进程 fetch 两个 scheme。
 */

const SCAN_ROOT = 'src'

const walk = (dir: string, files: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, files)
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(path)) files.push(path)
  }
  return files
}

test('exactly one call site submits the custom-scheme privileges', () => {
  const callSites: string[] = []

  for (const file of walk(SCAN_ROOT)) {
    const matches = readFileSync(file, 'utf8').match(/protocol\.registerSchemesAsPrivileged\s*\(/g)
    if (matches) callSites.push(`${file} (${matches.length})`)
  }

  assert.equal(
    callSites.length,
    1,
    'Electron replaces the whole privilege table on every call, so a second call drops the ' +
      'schemes the first registered (#135). Declare schemes with `declarePrivilegedScheme()` ' +
      `and submit them once. Found: ${callSites.join(', ') || 'none'}`
  )
  assert.ok(
    callSites[0].startsWith(join(SCAN_ROOT, 'main', 'protocol', 'privilegedSchemes.ts')),
    `the single call must live in privilegedSchemes.ts, found ${callSites[0]}`
  )
})

test('every scheme is declared and submitted before the app is ready', () => {
  const index = readFileSync(join(SCAN_ROOT, 'main', 'index.ts'), 'utf8')

  for (const call of [
    'declareDocumentScheme()',
    'declarePdfjsAssetScheme()',
    'applyPrivilegedSchemes()'
  ]) {
    assert.ok(index.includes(call), `index.ts stopped calling ${call}`)
  }
})
