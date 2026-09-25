import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 守住 PDF 脚本执行的边界（#121 / GHSA-hq66-cqwq-w95j）。
 *
 * 这条漏洞的官方 workaround 是「把 `enableScripting` 设为 false 或加 CSP」。但对这个仓库
 * 来说那个开关**不存在**：`enableScripting` 只声明在 `annotation_layer.d.ts`、
 * `annotation_layer_builder.d.ts` 和 `pdf_viewer.d.ts` 上，**不在 `getDocument` 的参数里** ——
 * 它是 viewer / AnnotationLayer 的参数，不是 API 的参数。真正执行文档内 JavaScript 的
 * `PDFScriptingManager` 也只在 viewer build（`pdfjs-dist/web/*`）里，而 API build
 * `build/pdf.mjs` 里根本没有它。
 *
 * 于是 KnowNote 的 mitigation 是结构性的：**不构造 AnnotationLayer，也不引入 viewer**。
 * 这个前提一直是成立的，但它此前只是「我们碰巧没写」，没人守着 —— 而它正是 #121 里
 * 「当前检查过的调用点下漏洞路径不可达」这个结论唯一依赖的东西。这个测试把那条结论从
 * 一次性检查变成持续保证：谁把 annotation layer 或 viewer 拉进来，CI 会在这里失败。
 *
 * 失败时该怎么做：如果确实需要 AnnotationLayer，就给它的参数显式传
 * `enableScripting: false`，然后回到 #121 重新评估可达性 —— 不要只是把这个测试改绿。
 */

/** 仓库里的渲染进程/主进程源码；测试与脚本不在扫描范围内。 */
const SCAN_ROOTS = ['src']

const walk = (dir: string, files: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, files)
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(path)) files.push(path)
  }
  return files
}

const sourceFiles = (): string[] => SCAN_ROOTS.flatMap((root) => walk(root))

/** 只取 import / require / 动态 import 位置上的说明符，避免匹配到注释里的普通提及。 */
const importSpecifiers = (source: string): string[] => {
  const pattern = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"\n]+)['"]/g
  return [...source.matchAll(pattern)].map((match) => match[1])
}

/** viewer build —— `PDFScriptingManager` 只存在于这里。 */
const isViewerImport = (specifier: string): boolean =>
  specifier === 'pdfjs-dist/web' ||
  specifier.startsWith('pdfjs-dist/web/') ||
  specifier.includes('pdf_viewer')

test('no source file imports the pdfjs viewer build, where the scripting manager lives', () => {
  const offenders: string[] = []

  for (const file of sourceFiles()) {
    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (isViewerImport(specifier)) offenders.push(`${file} imports ${specifier}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'The pdfjs viewer build carries PDFScriptingManager, which is what executes JavaScript ' +
      'embedded in a PDF. Importing it puts that path back in scope for GHSA-hq66-cqwq-w95j ' +
      '(#121). If it is genuinely needed, pass `enableScripting: false` explicitly and re-assess.'
  )
})

test('no source file constructs the annotation layer or the scripting manager', () => {
  const forbidden = new Set([
    'AnnotationLayer',
    'AnnotationLayerBuilder',
    'PDFScriptingManager',
    'ScriptingManager'
  ])
  const offenders: string[] = []

  for (const file of sourceFiles()) {
    // Collect every constructed name with one static pattern and filter, rather than
    // building a regex per name. Comments are naturally exempt: `new X(` is what
    // matters, so prose explaining why we avoid these classes stays valid.
    for (const match of readFileSync(file, 'utf8').matchAll(/\bnew\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (forbidden.has(match[1])) offenders.push(`${file} constructs ${match[1]}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'These classes consume `enableScripting`, and the manager is what runs document JavaScript. ' +
      'Constructing one re-enables the path described in #121; if that is intended, the ' +
      '`enableScripting: false` option must be passed explicitly and the reachability analysis redone.'
  )
})

test('`enableScripting` is never left on', () => {
  const offenders: string[] = []

  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8')
    if (/enableScripting\s*:\s*true/.test(source)) offenders.push(file)
  }

  assert.deepEqual(
    offenders,
    [],
    '`enableScripting: true` is the precondition of GHSA-hq66-cqwq-w95j (#121). It is not a ' +
      '`getDocument` option either, so seeing it here means an annotation layer or viewer was added.'
  )
})

test('no source file imports the modern pdfjs build, which requires Chromium 145', () => {
  // pdfjs-dist 6.x calls `Map.prototype.getOrInsertComputed` (and `getOrInsert`) in the
  // main-thread API and in the worker. That proposal shipped in Chromium 145; Electron 39
  // is Chromium 142, so the modern build dies at the first `page.render()` with
  // `getOrInsertComputed is not a function` and every page paints blank (#125). The legacy
  // build bundles the core-js polyfills for it, which is why every runtime import must go
  // through `pdfjs-dist/legacy/build/*`. Lift this guard once the app runs on Chromium >= 145.
  const offenders: string[] = []

  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8')
    for (const line of source.split('\n')) {
      // Type-only imports emit nothing, so `import type ... from 'pdfjs-dist'` is fine.
      // It is the value import (`import * as pdfjs from 'pdfjs-dist'`) and the
      // `pdfjs-dist/build/*` subpaths that pull the modern runtime in.
      if (/^\s*import\s+type\b/.test(line)) continue
      for (const specifier of importSpecifiers(line)) {
        if (specifier === 'pdfjs-dist' || specifier.startsWith('pdfjs-dist/build/')) {
          offenders.push(`${file} imports ${specifier}`)
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'The modern pdfjs build needs `Map.prototype.getOrInsertComputed`, which Electron 39 ' +
      '(Chromium 142) does not implement, so it throws on the first render (#125). Use ' +
      "'pdfjs-dist/legacy/build/*' instead; the legacy build ships the polyfill."
  )
})

test('the guard actually scans the source tree', () => {
  // A boundary test that silently scans nothing is worse than no test: it would report the
  // invariant as enforced while checking no files at all.
  const files = sourceFiles()

  assert.ok(files.length > 50, `expected to scan the source tree, got ${files.length} files`)
  assert.ok(
    files.some((file) => file.endsWith(join('source', 'reader', 'PdfSourceReader.tsx'))),
    'the PDF reader itself must be inside the scanned set'
  )
  assert.ok(
    files.some((file) => file.endsWith(join('loaders', 'PdfLoader.ts'))),
    'the main-process PDF loader must be inside the scanned set'
  )

  // And the extraction really finds imports, including the pdfjs one that is allowed.
  const reader = files.find((file) =>
    file.endsWith(join('source', 'reader', 'PdfSourceReader.tsx'))
  )
  assert.ok(reader)
  assert.ok(
    importSpecifiers(readFileSync(reader, 'utf8')).some((specifier) =>
      specifier.startsWith('pdfjs-dist')
    ),
    'import extraction found no pdfjs specifier in the reader'
  )
})
