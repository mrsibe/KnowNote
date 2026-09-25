import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PDFJS_ASSET_SCHEME,
  PDFJS_ASSET_DIRS,
  pdfjsAssetUrl,
  parsePdfjsAssetUrl
} from '../src/shared/utils/pdfjsAssets.ts'

/**
 * PDF.js 把 CMap / 标准字体 / wasm 当外部资源按文件名拉取。缺了 `cMapUrl`，CJK
 * 文档的 `translateFont` 直接抛 `Ensure that the cMapUrl API parameter is
 * provided.`，中文既画不出来、文本层也取不到（#125）。这些测试守住两件容易静默
 * 回归的事：URL 形状（PDF.js 对结尾斜杠有硬校验）和两个 `getDocument` 调用点确实
 * 配置了资源。
 */

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

test('every asset URL ends with the slash PDF.js requires', () => {
  for (const dir of PDFJS_ASSET_DIRS) {
    const url = pdfjsAssetUrl(dir)
    assert.ok(url.endsWith('/'), `pdfjs rejects "${url}" without a trailing slash`)
    assert.equal(url, `${PDFJS_ASSET_SCHEME}://pdfjs/${dir}/`)
  }
})

test('parse accepts the allowlisted dirs and flat filenames', () => {
  assert.deepEqual(parsePdfjsAssetUrl('knownote-asset://pdfjs/cmaps/H.bcmap'), {
    dir: 'cmaps',
    file: 'H.bcmap'
  })
  assert.deepEqual(parsePdfjsAssetUrl('knownote-asset://pdfjs/wasm/qcms_bg.wasm'), {
    dir: 'wasm',
    file: 'qcms_bg.wasm'
  })
  assert.deepEqual(parsePdfjsAssetUrl('knownote-asset://pdfjs/standard_fonts/FoxitSans.pfb'), {
    dir: 'standard_fonts',
    file: 'FoxitSans.pfb'
  })
})

test('parse rejects path traversal, unknown dirs and foreign origins', () => {
  const rejected = [
    'knownote-asset://pdfjs/cmaps/../../secret',
    'knownote-asset://pdfjs/cmaps/%2e%2e',
    'knownote-asset://pdfjs/cmaps/..',
    'knownote-asset://pdfjs/../secret',
    'knownote-asset://pdfjs/other/H.bcmap',
    'knownote-asset://pdfjs/cmaps/sub/H.bcmap',
    'knownote-asset://evil/cmaps/H.bcmap',
    'https://pdfjs/cmaps/H.bcmap',
    'knownote-doc://docs/abc',
    'not a url'
  ]

  for (const url of rejected) {
    assert.equal(parsePdfjsAssetUrl(url), null, `must reject ${url}`)
  }
})

test('both getDocument call sites configure the external assets', () => {
  const reader = read('src/renderer/src/components/notebook/source/reader/PdfSourceReader.tsx')
  const loader = read('src/main/services/loaders/PdfLoader.ts')

  // Match object properties (`cMapUrl:`), not bare mentions: the explanatory
  // comments name these parameters, and a guard that accepts a comment would
  // pass with the call site reverted to `getDocument({ data })`.
  for (const property of ['cMapUrl', 'standardFontDataUrl', 'wasmUrl', 'cMapPacked']) {
    assert.match(
      reader,
      new RegExp(`\\b${property}\\s*:`),
      `PdfSourceReader no longer passes \`${property}\` to getDocument; CJK PDFs will break`
    )
  }
  assert.ok(
    reader.includes('pdfjsAssetUrl'),
    'PdfSourceReader must resolve assets through pdfjsAssetUrl()'
  )

  // PdfLoader folds the three URLs in from the helper, so assert the call and the
  // helper's own contract rather than literal keys at the call site.
  assert.ok(
    loader.includes('pdfjsNodeAssetUrls'),
    'PdfLoader must resolve assets through pdfjsNodeAssetUrls()'
  )
  assert.match(
    loader,
    /\bcMapPacked\s*:/,
    'PdfLoader must pass cMapPacked, matching the packed .bcmap files on disk'
  )

  const loaderAssets = read('src/main/pdfjsAssetPaths.ts')
  for (const key of ['cMapUrl', 'standardFontDataUrl', 'wasmUrl']) {
    assert.match(
      loaderAssets,
      new RegExp(`\\b${key}\\s*:`),
      `pdfjsNodeAssetUrls() stopped returning ${key}; CJK PDFs will break`
    )
  }
})

test('the renderer CSP permits the asset scheme and wasm compilation', () => {
  const html = read('src/renderer/index.html')
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1]
  assert.ok(csp, 'index.html must carry a Content-Security-Policy meta tag')

  const directive = (name: string): string | undefined =>
    csp
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(name))

  assert.ok(
    directive('connect-src')?.includes(`${PDFJS_ASSET_SCHEME}:`),
    'connect-src must allow the asset scheme, or PDF.js cannot fetch CMaps'
  )
  assert.ok(
    directive('script-src')?.includes("'wasm-unsafe-eval'"),
    "script-src needs 'wasm-unsafe-eval' or wasm image decoders cannot compile"
  )
})
