import type {
  Citation,
  CitationContext,
  CitationMatch,
  CitationResolution
} from '../types/citation'

/**
 * Citation resolution (#70).
 *
 * An answer that is asked to mark its sources with `[n]` can mark a source that
 * was never retrieved, or attribute a passage to the wrong span. Both are
 * first-class failure modes: a plausible-looking link to the wrong paragraph is
 * worse than no link, because the reader cannot tell it is wrong.
 *
 * Resolution is **deterministic and pure** — no model call, no I/O. It maps
 * markers to the citations produced during retrieval, so the same answer and the
 * same evidence always produce the same result, and citation precision can be
 * computed from the return value for the eval harness (#75).
 */

/**
 * Case- and whitespace-insensitive comparison, and nothing beyond that.
 *
 * Deliberately not fuzzy: a quote that "roughly" matches is exactly the failure
 * this guards against. Collapsing whitespace is safe because the page text is
 * reflowed; stemming or token overlap would let a fabricated quote through.
 */
export function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** 标记里的编号去重后，按 prompt 位置查 citation；重复编号取第一个。 */
function indexContexts(
  contexts: readonly (Citation | CitationContext)[]
): Map<number, CitationContext> {
  const byMarker = new Map<number, CitationContext>()
  for (const entry of contexts) {
    const context: CitationContext = 'citation' in entry ? entry : { citation: entry }
    if (!byMarker.has(context.citation.index)) {
      byMarker.set(context.citation.index, context)
    }
  }
  return byMarker
}

/**
 * 校验引文是否落在区间内。
 *
 * 区间文本缺失、或引文为空时返回 `null`，表示「无法证伪」。把未知当成错误会
 * 让一条正确的引用因为元数据不全而消失；把未知当成正确则是这里的默认立场，
 * 因为 citation 本身来自检索，不是模型生成的。
 */
function isQuoteInSpan(context: CitationContext): boolean | null {
  const quote = normalizeForComparison(context.citation.quote)
  const span = context.spanText ? normalizeForComparison(context.spanText) : ''
  if (quote.length === 0 || span.length === 0) return null
  return span.includes(quote)
}

/**
 * 解析回答里的 `[n]` 标记，映射回检索阶段产生的 citation。
 *
 * 每个标记恰好落入三类之一：
 *
 * - `resolved`       —— 有对应 context，且引文落在区间内（或无法证伪）。
 * - `unresolved`     —— 没有任何 context（模型编造了 `[9]`）。
 * - `misattributed`  —— 有 context，但引文不在其区间内。
 *
 * 三类都被返回，而不是把坏标记静默丢掉：precision 要能算，界面也要能选择把
 * 它们按普通文本渲染。
 */
export function resolveCitations(
  answer: string,
  contexts: readonly (Citation | CitationContext)[]
): CitationResolution {
  const byMarker = indexContexts(contexts)
  const matches: CitationMatch[] = []

  // A fresh regex per call: `RegExp.lastIndex` is mutable state, and a pure
  // resolver must not depend on how many times it has run before.
  const pattern = /\[(\d+)\]/g
  let found = pattern.exec(answer)
  while (found !== null) {
    const marker = Number(found[1])
    const position = found.index
    const context = byMarker.get(marker)

    if (!context) {
      matches.push({ marker, status: 'unresolved', position })
    } else if (isQuoteInSpan(context) === false) {
      matches.push({ marker, status: 'misattributed', position, citation: context.citation })
    } else {
      matches.push({ marker, status: 'resolved', position, citation: context.citation })
    }

    found = pattern.exec(answer)
  }

  const resolved = matches.filter((match) => match.status === 'resolved')
  const unresolved = matches.filter((match) => match.status === 'unresolved')
  const misattributed = matches.filter((match) => match.status === 'misattributed')

  return {
    matches,
    resolved,
    unresolved,
    misattributed,
    precision: matches.length === 0 ? 0 : resolved.length / matches.length
  }
}
