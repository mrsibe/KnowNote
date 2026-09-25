import type {
  ReaderAnchor,
  ReaderSelection,
  SourceBlock
} from '../../../../../../shared/types/source'

/**
 * Reader 定位的纯计算（#71）
 *
 * 把「阅读器里的一次选择 / 一个点」映射成来源里的位置。拆出来是为了能在没有浏览器
 * 的环境里测：DOM 里只有 rect 和 text，映射规则本身不该藏在组件里。
 */

/** 归一化页面坐标（0-1，左上原点）里的一个点。 */
export interface NormalizedPoint {
  x: number
  y: number
}

/** 按字符偏移找包含它的块。 */
export function blockContainingOffset(
  blocks: readonly SourceBlock[],
  offset: number
): SourceBlock | null {
  return blocks.find((block) => offset >= block.startOffset && offset <= block.endOffset) ?? null
}

/**
 * 按归一化坐标找块。`page` 用于排除其它页；命中多个时取面积最小的（最具体）。
 */
export function blockAtPoint(
  blocks: readonly SourceBlock[],
  page: number | null,
  point: NormalizedPoint
): SourceBlock | null {
  let best: SourceBlock | null = null
  let bestArea = Number.POSITIVE_INFINITY

  for (const block of blocks) {
    if (page !== null && block.page !== null && block.page !== page) continue
    const bbox = block.bbox
    if (!bbox) continue
    if (point.x < bbox.x || point.x > bbox.x + bbox.w) continue
    if (point.y < bbox.y || point.y > bbox.y + bbox.h) continue

    const area = bbox.w * bbox.h
    if (area < bestArea) {
      best = block
      bestArea = area
    }
  }

  return best
}

export function blockById(
  blocks: readonly SourceBlock[],
  blockId: string | null | undefined
): SourceBlock | null {
  if (!blockId) return null
  return blocks.find((block) => block.id === blockId) ?? null
}

/**
 * 把一个 `ReaderAnchor` 解析成「翻到哪一页、高亮哪个块」。
 *
 * 定位优先级（#72）：
 *
 *   blockId            —— 命中最方便，但它是派生索引，reindex 后可能失效；
 *   startOffset/endOffset —— canonical offset，稳定，用来找回重建后的块；
 *   page               —— 只翻页，不高亮；
 *   都没有             —— 打开文档顶部。
 *
 * 返回 null 的块表示「没有可高亮的块」，调用方据此清掉上一次的高亮，而不是把旧高亮
 * 留在屏幕上冒充这一次的落点。
 */
export function resolveAnchor(
  blocks: readonly SourceBlock[],
  anchor: ReaderAnchor
): { page: number | null; block: SourceBlock | null } {
  const byId = blockById(blocks, anchor.blockId)
  if (byId) return { page: anchor.page ?? byId.page ?? null, block: byId }

  if (typeof anchor.startOffset === 'number') {
    const byOffset = blockContainingOffset(blocks, anchor.startOffset)
    if (byOffset) return { page: anchor.page ?? byOffset.page ?? null, block: byOffset }
  }

  return { page: anchor.page ?? null, block: null }
}

/**
 * 把一次选区映射成 `ReaderSelection`。
 *
 * 字符区间在能定位到块时给出；定位不到就省略，而不是编一个看似精确的偏移。
 * 返回 null 表示这次选择没有可用的定位信息（空白、跨出阅读器）。
 */
export function resolveSelection(
  documentId: string,
  text: string,
  blocks: readonly SourceBlock[],
  point: { page: number | null; normalized: NormalizedPoint } | null,
  fallbackOffset: number | null
): ReaderSelection | null {
  if (text.trim().length === 0) return null

  const block =
    (point ? blockAtPoint(blocks, point.page, point.normalized) : null) ??
    (fallbackOffset !== null ? blockContainingOffset(blocks, fallbackOffset) : null)

  if (!block) {
    return { documentId, page: point?.page ?? null, text }
  }

  const localStart = block.text.indexOf(text)
  const startOffset = localStart >= 0 ? block.startOffset + localStart : null
  const endOffset = startOffset !== null ? startOffset + text.length : null

  return {
    documentId,
    page: block.page ?? point?.page ?? null,
    blockId: block.id,
    startOffset,
    endOffset,
    text
  }
}

/** 一个块在页面上的像素矩形（由归一化 bbox 换算）。 */
export function blockRect(
  block: SourceBlock,
  pageWidth: number,
  pageHeight: number
): { left: number; top: number; width: number; height: number } | null {
  if (!block.bbox) return null
  return {
    left: block.bbox.x * pageWidth,
    top: block.bbox.y * pageHeight,
    width: block.bbox.w * pageWidth,
    height: block.bbox.h * pageHeight
  }
}
