import type { Citation } from '../types/citation'
import type { ReaderAnchor, SourceAnchor } from '../types/source'

/**
 * `SourceAnchor` 的构造与序列化（#72）。
 *
 * 这里是纯函数：不查库、不碰 DOM、不读 React state。引用快照只带位置信息，跳转所需的
 * 「打开哪个来源、去哪」全部由 citation 自身的字段推导，因此 jump 不需要在打开时再去
 * 反查 chunk / block —— 那正是 #69/#70/#71 已经做完的事。
 *
 * 同一套函数同时服务两条路径：
 *
 *   citation → SourceAnchor → URL query   （点击引用）
 *   URL query → SourceAnchor → Reader     （reload / deep-link 恢复）
 *
 * URL 里同时保留 `block` 与 `start/end`：blockId 属于派生索引，reindex 后可能失效，而
 * canonical offset 是稳定定位，页码是最后的兜底。定位优先级由 reader 决定，不由这里决定。
 */

/** 与来源定位相关的 query key。关闭阅读器时只移除这些，不碰 notebook route 的其他参数。 */
export const SOURCE_ANCHOR_PARAM_KEYS = ['doc', 'page', 'start', 'end', 'block'] as const

/** citation 快照 → 定位。只用 citation 自己记录的字段，不补、不猜。 */
export function citationToSourceAnchor(citation: Citation): SourceAnchor {
  const location: ReaderAnchor = { documentId: citation.documentId }

  if (typeof citation.page === 'number' && Number.isFinite(citation.page)) {
    location.page = citation.page
  }
  if (citation.blockId) location.blockId = citation.blockId
  if (typeof citation.startOffset === 'number' && Number.isFinite(citation.startOffset)) {
    location.startOffset = citation.startOffset
  }
  if (typeof citation.endOffset === 'number' && Number.isFinite(citation.endOffset)) {
    location.endOffset = citation.endOffset
  }

  return { documentId: citation.documentId, location }
}

/** 只写入确实存在的字段：缺失的位置不应该以空串或 `"null"` 的形式出现在 URL 里。 */
export function sourceAnchorToSearchParams(anchor: SourceAnchor): URLSearchParams {
  const params = new URLSearchParams()
  params.set('doc', anchor.documentId)

  const { page, startOffset, endOffset, blockId } = anchor.location
  if (isFiniteNumber(page)) params.set('page', String(page))
  if (isFiniteNumber(startOffset)) params.set('start', String(startOffset))
  if (isFiniteNumber(endOffset)) params.set('end', String(endOffset))
  if (blockId) params.set('block', blockId)

  return params
}

/**
 * URL query → 定位，防御式解析。
 *
 * deep-link 是用户可以手改、可以过期的输入。单独一个坏字段只丢弃它自己，不让整条
 * 链接失效：`page=abc`、`page=-1`、`end < start` 都退化成更低优先级的定位，而不是抛出
 * 或渲染出一个错误的位置。没有 `doc` 时返回 null —— 那不是一条来源链接。
 */
export function sourceAnchorFromSearchParams(params: URLSearchParams): SourceAnchor | null {
  const documentId = params.get('doc')
  if (!documentId) return null

  const location: ReaderAnchor = { documentId }

  const page = parseIntegerParam(params.get('page'), 1)
  if (page !== undefined) location.page = page

  const start = parseIntegerParam(params.get('start'), 0)
  const end = parseIntegerParam(params.get('end'), 0)
  if (start !== undefined) location.startOffset = start
  // 单边的 end 没有意义；end 在 start 之前则丢弃 end，保留 start。
  if (start !== undefined && end !== undefined && end >= start) location.endOffset = end

  const blockId = params.get('block')
  if (blockId) location.blockId = blockId

  return { documentId, location }
}

/** 在保留其它 query 的前提下替换或移除来源定位字段。`anchor === null` 即关闭。 */
export function withSourceAnchor(
  params: URLSearchParams,
  anchor: SourceAnchor | null
): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const key of SOURCE_ANCHOR_PARAM_KEYS) next.delete(key)
  if (anchor) {
    for (const [key, value] of sourceAnchorToSearchParams(anchor)) next.set(key, value)
  }
  return next
}

/** 两个定位是否指向同一处。用于避免把 URL 反复回填进 store 造成的无意义写入。 */
export function sourceAnchorsEqual(a: SourceAnchor | null, b: SourceAnchor | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.documentId !== b.documentId) return false

  const left = a.location
  const right = b.location
  return (
    (left.page ?? null) === (right.page ?? null) &&
    (left.blockId ?? null) === (right.blockId ?? null) &&
    (left.startOffset ?? null) === (right.startOffset ?? null) &&
    (left.endOffset ?? null) === (right.endOffset ?? null)
  )
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** 非负/正整数，且不接受 `1.5`、`1e3`、`+3` 这类有歧义的写法。 */
const parseIntegerParam = (value: string | null, min: number): number | undefined => {
  if (value === null) return undefined
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  return parsed >= min ? parsed : undefined
}
