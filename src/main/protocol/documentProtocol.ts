/**
 * `knownote-doc://` 协议（#71）
 *
 * 渲染进程不应拿到任意文件路径。它只知道 documentId，主进程按 id 查库、只服务
 * 这份来源自己的文件。路径永远来自数据库，不来自请求，因此不存在路径穿越。
 *
 * scheme 必须在 app ready 之前声明为 privileged；handler 在 ready 之后安装。
 */

import { net, protocol } from 'electron'
import { pathToFileURL } from 'url'
import { DOCUMENT_SCHEME, parseDocumentUrl } from '../../shared/utils/documentUrl'
import Logger from '../../shared/utils/logger'
import { declarePrivilegedScheme } from './privilegedSchemes'

/**
 * Origins allowed to read a document. The renderer is `file://` in production
 * (serialised as `null`) or the electron-vite dev server in development. A
 * wildcard would let any origin that guesses a document id read the file, so the
 * request's own origin is reflected only when it is one of these.
 */
const ALLOWED_ORIGINS = new Set(['null', 'http://localhost:5173', 'http://127.0.0.1:5173'])

export { DOCUMENT_SCHEME, documentUrl, parseDocumentUrl } from '../../shared/utils/documentUrl'

/** 声明特权。只入队，提交由 `applyPrivilegedSchemes()` 在 ready 前统一完成（#135）。 */
export function declareDocumentScheme(): void {
  declarePrivilegedScheme({
    scheme: DOCUMENT_SCHEME,
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
  })
}

/** 在 app ready 之后调用，安装只读的字节服务 handler。 */
export function registerDocumentProtocolHandler(
  resolveLocalFilePath: (documentId: string) => string | null
): void {
  protocol.handle(DOCUMENT_SCHEME, async (request) => {
    const documentId = parseDocumentUrl(request.url)
    if (!documentId) return new Response('Not found', { status: 404 })

    // 路径来自 Document 层，不来自这里，也不来自请求。handler 自己不碰数据库：
    // 它只需要一个「可读文件」的答案，依赖方向保持 protocol → Document 层 → database（#60）。
    const localFilePath = resolveLocalFilePath(documentId)
    if (!localFilePath) return new Response('Not found', { status: 404 })

    try {
      // net.fetch handles file:// in the main process and streams the response, so
      // a large PDF is not read into memory to be served.
      const response = await net.fetch(pathToFileURL(localFilePath).toString())
      const headers = new Headers(response.headers)
      const origin = request.headers.get('Origin') ?? 'null'
      if (ALLOWED_ORIGINS.has(origin)) headers.set('Access-Control-Allow-Origin', origin)
      return new Response(response.body, { status: response.status, headers })
    } catch (error) {
      Logger.warn('DocumentProtocol', `Failed to serve ${documentId}:`, error)
      return new Response('Not found', { status: 404 })
    }
  })
}
