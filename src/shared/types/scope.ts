/**
 * 检索范围（#94）
 *
 * 「这次问题用哪些来源回答」，不是「notebook 里有哪些来源」。
 *
 * 它存在于 **session** 上，而不是 notebook 上：#97 的多个会话各自保留自己的 scope，
 * 现在存 notebook 上到时还要迁移。今天一个 notebook 通常只有一个 active session，
 * 用户体验与「每个 notebook 一个 scope」完全一致，代价为零。
 */

export type RetrievalScope =
  | { type: 'notebook' }
  | { type: 'current-source'; documentId: string }
  | { type: 'selected-sources'; documentIds: string[] }

export const DEFAULT_RETRIEVAL_SCOPE: RetrievalScope = { type: 'notebook' }

/**
 * scope → 实际传给检索的 `documentIds`。
 *
 * `undefined` 表示不过滤（整个 notebook）——「没有限制」和「限制到空集」是两件事，
 * 前者返回全部，后者应当返回空。
 */
export function scopeDocumentIds(scope: RetrievalScope | null | undefined): string[] | undefined {
  if (!scope || scope.type === 'notebook') return undefined
  if (scope.type === 'current-source') return [scope.documentId]
  return scope.documentIds.length > 0 ? scope.documentIds : undefined
}

/**
 * 防御式解析。
 *
 * scope 存在 DB 的 JSON 列里，可能是旧版本写的、被手改的，或形状不对的。读不出来时
 * 收敛到默认值（整个 notebook）而不是抛错：一个坏 scope 不应该让历史会话打不开。
 */
export function parseRetrievalScope(value: unknown): RetrievalScope {
  if (!value || typeof value !== 'object') return DEFAULT_RETRIEVAL_SCOPE
  const candidate = value as Record<string, unknown>

  if (candidate.type === 'current-source' && typeof candidate.documentId === 'string') {
    return { type: 'current-source', documentId: candidate.documentId }
  }

  if (candidate.type === 'selected-sources' && Array.isArray(candidate.documentIds)) {
    const documentIds = candidate.documentIds.filter((id): id is string => typeof id === 'string')
    return { type: 'selected-sources', documentIds }
  }

  return DEFAULT_RETRIEVAL_SCOPE
}
