import type { RetrievalFilter } from './types'

/**
 * 目前只有 dense 检索，还没有任何后端支持按来源预过滤。
 *
 * `RetrievalRequest.filter` 是 #94 需要的 seam，但预过滤的实现（向量表要能按来源
 * 过滤，且必须在 KNN 之前生效）属于 #94。这里如果接受 filter 却不使用，就会返回
 * 「看起来受限、实际是整个 notebook」的结果 —— 那正是 #160 要删掉的那种「声明了
 * 却不生效」的接口。所以宁可在它被真正使用前明确拒绝，也不要静默忽略。
 *
 * 空数组与缺省一样表示「不过滤」，因此不触发拒绝。
 */
export function assertFilterSupported(filter?: RetrievalFilter): void {
  const documentIds = filter?.documentIds
  if (documentIds && documentIds.length > 0) {
    throw new Error(
      'Source filtering is not implemented yet (#94). ' +
        'Refusing to ignore the filter and return unscoped results.'
    )
  }
}
