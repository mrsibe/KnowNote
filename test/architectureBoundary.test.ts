import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 守住 Electron plumbing → Document 层的依赖方向（#60）。
 *
 * #60 的第三条 acceptance 不是文字要求，而是在约束依赖方向：
 *
 *   no new service reaches directly into getDatabase() from outside the
 *   Document/Application layers
 *
 * `src/main/protocol/` 是 Electron plumbing —— 它既不是 Application 也不是 Document
 * 层。`knownote-doc://` 曾经自己 `select().from(documents)` 取 `localFilePath`，是 v1.4
 * （#116）新增代码里唯一一处这类反向依赖。现在它改为接收一个窄查询
 * （`KnowledgeService.getDocumentLocalFilePath()`），方向变成：
 *
 *   protocol → Document 层 → getDatabase() → Drizzle/SQLite
 *
 * 这个测试把那条方向固定下来：谁在 protocol 层重新引入数据库访问，CI 会在这里失败。
 * 失败时该怎么做：把需要的查询加到 Document 层并注入进来，不要只是把测试改绿。
 */

/** Electron plumbing：这里的模块只负责把请求翻译成对服务层的调用。 */
const PLUMBING_DIR = join('src', 'main', 'protocol')

const sourceFiles = (dir: string, files: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, files)
    else if (/\.(ts|tsx|mts|cts)$/.test(path)) files.push(path)
  }
  return files
}

const importSpecifiers = (source: string): string[] => {
  const pattern = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"\n]+)['"]/g
  return [...source.matchAll(pattern)].map((match) => match[1])
}

/** 数据库层的入口：直接拿连接、Drizzle，或 Drizzle 的表定义。 */
const isDatabaseAccess = (specifier: string): boolean =>
  specifier === 'drizzle-orm' ||
  specifier.startsWith('drizzle-orm/') ||
  /(^|\/)db$/.test(specifier) ||
  specifier.endsWith('/db/schema') ||
  specifier.endsWith('/db')

test('the protocol layer does not reach into the database', () => {
  const offenders: string[] = []

  for (const file of sourceFiles(PLUMBING_DIR)) {
    const source = readFileSync(file, 'utf8')

    for (const specifier of importSpecifiers(source)) {
      if (isDatabaseAccess(specifier)) offenders.push(`${file} imports ${specifier}`)
    }

    // Import form is not the only way in: a lazy `require('../../db')` or a direct
    // call would be missed by the specifier scan, so check the call too.
    if (/\bgetDatabase\s*\(/.test(source)) offenders.push(`${file} calls getDatabase()`)
  }

  assert.deepEqual(
    offenders,
    [],
    'The protocol layer is Electron plumbing and must not query the database directly ' +
      '(#60, acceptance 3). Add a narrow query to the Document layer ' +
      '(KnowledgeService) and inject it via registerDocumentProtocolHandler() instead of ' +
      'reaching for getDatabase() here.'
  )
})

test('the protocol layer gets its data through an injected resolver', () => {
  // The invariant is only meaningful if the handler really takes its answer from the
  // caller: a module that had both the db import *and* the injection would pass the test
  // above only until someone used the import.
  const source = readFileSync(join(PLUMBING_DIR, 'documentProtocol.ts'), 'utf8')

  assert.match(
    source,
    /resolveLocalFilePath\s*:\s*\(/,
    'registerDocumentProtocolHandler must take the document-path resolver as a parameter'
  )
})

test('the guard actually scans the protocol layer', () => {
  // A boundary test that silently scans nothing is worse than no test: it would report
  // the direction as enforced while reading no files.
  const files = sourceFiles(PLUMBING_DIR)

  assert.ok(files.length > 0, `expected to scan ${PLUMBING_DIR}, got ${files.length} files`)
  assert.ok(
    files.some((file) => file.endsWith('documentProtocol.ts')),
    'the document protocol handler must be inside the scanned set'
  )

  // And the extraction really finds imports.
  assert.ok(
    importSpecifiers(readFileSync(files[0], 'utf8')).includes('electron'),
    'import extraction found no specifiers in the protocol layer'
  )
})
