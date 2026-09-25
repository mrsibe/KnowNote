/**
 * PDF.js 外部资源（CMap / 标准字体 / wasm 解码器）的共享契约。
 *
 * PDF.js 把这三类资源当作**外部资源按文件名拉取**：`getDocument` 收到
 * `cMapUrl` 之后，会去请求 `${cMapUrl}${name}.bcmap`。缺了 `cMapUrl`，CJK
 * 文档的 `translateFont` 直接抛
 * `Ensure that the cMapUrl API parameter is provided.` —— 中文既画不出来，文本层
 * 也取不到。`standardFontDataUrl` / `wasmUrl` 同理，只是触发条件更窄
 * （非嵌入标准字体；JBIG2 / JPEG2000 / qcms 图像）。
 *
 * 主进程用文件系统路径（pdfjs 在 Node 侧直接 `fs.readFile`），渲染进程用这里的
 * scheme URL（走自定义协议，避免渲染进程接触任意文件路径）。两边共享"需要哪些
 * 目录"和 URL 形状的校验，但**不共享拼 URL 的实现**。
 */

/** 渲染进程访问 PDF.js 资源的自定义 scheme。见 `protocol/pdfjsAssetProtocol.ts`。 */
export const PDFJS_ASSET_SCHEME = 'knownote-asset'

/** URL 里的 host，和 `knownote-doc://docs` 一样只是形状的一部分，不表示主机。 */
const PDFJS_ASSET_HOST = 'pdfjs'

/** 要随包携带的目录名，与 `node_modules/pdfjs-dist/` 下一致。 */
export const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm'] as const

export type PdfjsAssetDir = (typeof PDFJS_ASSET_DIRS)[number]

/**
 * 渲染进程侧的资源目录 URL。
 *
 * 必须以 `/` 结尾：PDF.js 直接做字符串拼接，`getFactoryUrlProp` 对没有结尾斜杠的
 * 值会抛 `Invalid factory url: "..." must include trailing slash.`。
 */
export function pdfjsAssetUrl(dir: PdfjsAssetDir): string {
  return `${PDFJS_ASSET_SCHEME}://${PDFJS_ASSET_HOST}/${dir}/`
}

/** pdfjs 的资源文件名都是单层、无分隔符的名字（`H.bcmap`、`qcms_bg.wasm` 等）。 */
const ASSET_FILE_NAME = /^[A-Za-z0-9._-]+$/

/**
 * 只接受 `knownote-asset://pdfjs/<dir>/<file>`，其余形状一律返回 null。
 *
 * 目录必须在白名单里、文件名不允许路径分隔符也不允许 `.` / `..`，所以路径穿越在
 * 解析这一层就被挡掉，协议 handler 不需要再相信调用方。
 */
export function parsePdfjsAssetUrl(url: string): { dir: PdfjsAssetDir; file: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${PDFJS_ASSET_SCHEME}:`) return null
  if (parsed.hostname !== PDFJS_ASSET_HOST) return null

  const match = /^\/([^/]+)\/([^/]+)$/.exec(parsed.pathname)
  if (!match) return null

  let dir: string
  let file: string
  try {
    dir = decodeURIComponent(match[1])
    file = decodeURIComponent(match[2])
  } catch {
    return null
  }

  if (!(PDFJS_ASSET_DIRS as readonly string[]).includes(dir)) return null
  if (file === '.' || file === '..') return null
  if (!ASSET_FILE_NAME.test(file)) return null

  return { dir: dir as PdfjsAssetDir, file }
}
