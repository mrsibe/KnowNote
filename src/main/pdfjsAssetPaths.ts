/**
 * 主进程侧的 PDF.js 资源目录解析。
 *
 * 打包后资源由 electron-builder 的 `extraResources` 放到 `resources/pdfjs/`，是 asar
 * 之外的**真实文件**：主进程要 `fs.readFile` 它们，渲染进程的自定义协议也要能从
 * 磁盘读到。放进 asar 会让 Chromium 读不到，`process.getBuiltinModule('fs')` 的路子
 * 也不保证走 Electron 的 asar 补丁 —— 所以这里刻意不用 asar 内路径。
 *
 * 开发时直接读 `node_modules/pdfjs-dist`，省掉"先打包再调试"。
 */

import * as electron from 'electron'
import { join } from 'path'
import type { PdfjsAssetDir } from '../shared/utils/pdfjsAssets'

type ElectronApp = { isPackaged?: boolean; getAppPath?: () => string }

/**
 * `electron` 在纯 Node 下解析成一个可执行文件路径字符串，`app` 因此是 `undefined`；
 * `test/parsers.test.ts`、`test/blocks.test.ts` 等会在不启动 Electron 的情况下跑
 * `PdfLoader`，所以这里不能假设自己运行在 Electron 里。
 */
// SAFETY: `electron` outside a running Electron process resolves to a path string
// with no `app` property, so the runtime value is genuinely `undefined` there. The
// cast narrows that one case away instead of pretending `app` is always present.
const electronApp = (electron as unknown as { app?: ElectronApp }).app

/** 三类资源的共同根目录。 */
export function pdfjsAssetRoot(): string {
  if (electronApp?.isPackaged === true) {
    return join(process.resourcesPath, 'pdfjs')
  }
  // electron-vite dev 下 `app.getAppPath()` 是项目根；测试里退回 cwd（同样是项目根）。
  const projectRoot = electronApp?.getAppPath?.() ?? process.cwd()
  return join(projectRoot, 'node_modules', 'pdfjs-dist')
}

/**
 * 供 PDF.js 的 Node 侧使用的目录路径。
 *
 * `NodeBinaryDataFactory` 直接 `fs.readFile(`${baseUrl}${filename}`)`，所以这里给的是
 * 目录路径，并保留 PDF.js 要求的结尾斜杠（`getFactoryUrlProp` 会校验）。
 */
export function pdfjsNodeAssetDir(dir: PdfjsAssetDir): string {
  return `${join(pdfjsAssetRoot(), dir)}/`
}

/** `PdfLoader.getDocument()` 要的三个资源参数。 */
export function pdfjsNodeAssetUrls(): {
  cMapUrl: string
  standardFontDataUrl: string
  wasmUrl: string
} {
  return {
    cMapUrl: pdfjsNodeAssetDir('cmaps'),
    standardFontDataUrl: pdfjsNodeAssetDir('standard_fonts'),
    wasmUrl: pdfjsNodeAssetDir('wasm')
  }
}
