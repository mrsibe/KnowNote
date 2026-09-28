import type { RetrievalFilter, RetrievalTrace } from './types'

export interface RetrievalTraceInput {
  strategy: string
  filter?: RetrievalFilter
  topK: number
  threshold?: number
  durationMs: number
}

/**
 * 组装一次检索的 trace。
 *
 * 纯函数，便于单测：trace 会被 #157 原样快照到 message 上，所以它的形状必须稳
 * 定，并且与具体策略实现解耦 —— 策略只说「我用了什么参数」，不决定 trace 的结构。
 *
 * `scope` 只在真的有过滤时才带 `documentIds`；没有过滤时是 `{}`，序列化后也不会
 * 留下一个 `undefined` 字段。
 */
export function buildRetrievalTrace(input: RetrievalTraceInput): RetrievalTrace {
  const scope: { documentIds?: string[] } = {}
  if (input.filter?.documentIds) scope.documentIds = input.filter.documentIds

  const trace: RetrievalTrace = {
    strategy: input.strategy,
    scope,
    topK: input.topK,
    durationMs: input.durationMs
  }

  if (input.threshold !== undefined) trace.threshold = input.threshold

  return trace
}
