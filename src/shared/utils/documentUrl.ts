/**
 * `knownote-doc://` URL 形状（#71）
 *
 * 主进程按这个形状解析 documentId、按 id 查库；渲染进程按它构造请求。两侧共用同一
 * 份实现，避免「解析端接受、构造端生成」两处漂移。
 */

export const DOCUMENT_SCHEME = 'knownote-doc'

/** 渲染进程请求某个来源字节时使用的 URL。 */
export function documentUrl(documentId: string): string {
  return `${DOCUMENT_SCHEME}://docs/${encodeURIComponent(documentId)}`
}

/**
 * 只接受 `knownote-doc://docs/<id>`。其余形状一律返回 null，调用方回 404。
 *
 * WHATWG URL 把 `//docs` 解析为 host（不是 path 的一段），所以这里检查 hostname，
 * 而不是把整条路径当字符串切。
 */
export function parseDocumentUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${DOCUMENT_SCHEME}:`) return null
  if (parsed.hostname !== 'docs') return null

  const match = /^\/([^/]+)$/.exec(parsed.pathname)
  if (!match) return null

  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}
