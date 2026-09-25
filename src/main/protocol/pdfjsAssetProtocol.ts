/**
 * `knownote-asset://` 协议（PDF.js 外部资源）
 *
 * 渲染进程不接触文件路径：它只知道资源目录名，主进程按白名单解析并只服务
 * `resources/pdfjs/{cmaps,standard_fonts,wasm}` 下的文件。路径来自这里的
 * `pdfjsAssetRoot()`，不来自请求。
 *
 * 和 `documentProtocol` 一样，scheme 必须在 app ready 之前注册为 privileged；
 * handler 在 ready 之后安装。
 */

import { net, protocol } from 'electron'
import { join, normalize, sep } from 'path'
import { pathToFileURL } from 'url'
import { PDFJS_ASSET_SCHEME, parsePdfjsAssetUrl } from '../../shared/utils/pdfjsAssets'
import { pdfjsAssetRoot } from '../pdfjsAssetPaths'
import Logger from '../../shared/utils/logger'

/**
 * Origins allowed to read an asset. Same set as `documentProtocol`: the renderer
 * is `file://` in production (serialised as `null`) or the electron-vite dev
 * server in development.
 */
const ALLOWED_ORIGINS = new Set(['null', 'http://localhost:5173', 'http://127.0.0.1:5173'])

/** 必须在 app ready 之前调用一次。 */
export function registerPdfjsAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PDFJS_ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        // The renderer fetches this scheme from a different origin (`file://` in
        // production, the dev server in development), so it is a cross-origin
        // request and must be CORS-enabled to succeed.
        corsEnabled: true
      }
    }
  ])
}

/** 在 app ready 之后调用，安装只读的资源 handler。 */
export function registerPdfjsAssetProtocolHandler(): void {
  protocol.handle(PDFJS_ASSET_SCHEME, async (request) => {
    const parsed = parsePdfjsAssetUrl(request.url)
    if (!parsed) return new Response('Not found', { status: 404 })

    const root = pdfjsAssetRoot()
    const filePath = normalize(join(root, parsed.dir, parsed.file))
    // 解析层已经限制了目录白名单和文件名，这里再确认一次最终路径没跑出根目录。
    if (!filePath.startsWith(root + sep)) return new Response('Not found', { status: 404 })

    try {
      const response = await net.fetch(pathToFileURL(filePath).toString())
      const headers = new Headers(response.headers)
      const origin = request.headers.get('Origin') ?? 'null'
      if (ALLOWED_ORIGINS.has(origin)) headers.set('Access-Control-Allow-Origin', origin)
      // Chromium 只接受这个 MIME 做 `WebAssembly.instantiateStreaming`。
      if (parsed.file.endsWith('.wasm')) headers.set('Content-Type', 'application/wasm')
      return new Response(response.body, { status: response.status, headers })
    } catch (error) {
      Logger.warn('PdfjsAssetProtocol', `Failed to serve ${parsed.dir}/${parsed.file}:`, error)
      return new Response('Not found', { status: 404 })
    }
  })
}
