import type { CitationCandidate } from '../../shared/types/citation'
import type { EvidenceLocator } from './retrieval'

/**
 * Sentence-level citation candidates (#155).
 *
 * A retrieval chunk exists to make a passage **findable**; a citation must point at
 * the passage that **supports the claim**. `buildCitationCandidates()` is where
 * those two stop being the same thing: it turns each retrieved chunk into the
 * verbatim spans the model will cite, *before* the answer exists.
 *
 * Why before, and not after: deciding that an answer sentence is supported by a
 * source sentence is semantic entailment. "Transformer 不需要 RNN 结构" is
 * supported by "Transformers eliminate recurrent connections", and no substring,
 * token-overlap or embedding rule proves that. Asking the model to *choose among
 * spans that already exist* removes the guess entirely.
 *
 * The chunk stays the retrieval unit. Candidates are the citation unit.
 */

/**
 * 生成候选所需的最小形状。
 *
 * `SearchResult`（chat 路径）与 `RetrievedEvidence`（检索层）都满足它，因此这里
 * 不需要为了造引用再回查一次数据库，也不需要依赖任一上层的具体类型。
 */
export interface CitationCandidateSource {
  chunkId: string
  documentId: string
  locator: EvidenceLocator
  /** 没有块结构时的兜底原文；只有 `locator.blocks` 为空时才会用到。 */
  content?: string
}

/** 相对传入字符串的字符区间。 */
export interface TextRange {
  start: number
  end: number
}

/** 一个 candidate 大致的最小字符数：短句会与相邻句合并，而不是各自成条。 */
const MIN_CANDIDATE_CHARS = 80

/** 一个 candidate 最多合并多少句。 */
const MAX_CANDIDATE_SENTENCES = 3

/**
 * 常见的缩写。它们后面的句点不是句末 —— 误判成句末会把句子切碎，而碎 candidate
 * 比略大的 candidate 更糟：模型拿不到能支撑 claim 的完整片段。
 */
const ABBREVIATIONS = new Set([
  'al',
  'approx',
  'cf',
  'dr',
  'etc',
  'fig',
  'inc',
  'jr',
  'ltd',
  'mr',
  'mrs',
  'ms',
  'prof',
  'ref',
  'sec',
  'sr',
  'st',
  'vol',
  'vs'
])

/** 形如 `U.S` / `e.g` / `i.e` 的点分隔缩写。 */
const DOTTED_INITIALS = /^(?:[a-z]\.)+[a-z]?$/

/** 可以紧跟句末标点而不影响断句的收尾符号。 */
const CLOSERS = /["')\]}»”’】」』]/

const isCjk = (char: string): boolean => /[\u3000-\u9fff\uff00-\uffef]/.test(char)

/**
 * `text[i]` 是不是一个句末标点。
 *
 * 刻意保守：`3.14`、`U.S.`、`Fig. 3`、`et al.` 里面的点都不断句。宁可把两句话合成
 * 一个 candidate，也不要把一句话切成两半。
 */
function isSentenceBoundary(text: string, i: number): boolean {
  const char = text[i]

  if (char === '。' || char === '！' || char === '？') return true
  if (char === '!' || char === '?') return true
  if (char !== '.') return false

  const prev = text[i - 1]
  const next = text[i + 1]

  // 3.14 —— 数字之间的小数点
  if (prev !== undefined && next !== undefined && /\d/.test(prev) && /\d/.test(next)) return false

  // 点前面的 token
  let start = i
  while (start > 0 && /[A-Za-z.\u00c0-\u024f]/.test(text[start - 1])) start--
  const token = text.slice(start, i).toLowerCase()
  if (token.length === 1) return false // 缩写首字母："J. Smith"
  if (DOTTED_INITIALS.test(token)) return false
  if (ABBREVIATIONS.has(token)) return false

  // 点后面粘连着一个普通字母（"word.Foo"）不是句末；CJK 与收尾符号可以。
  if (next !== undefined && !/\s/.test(next) && !isCjk(next) && !CLOSERS.test(next)) return false

  return true
}

/** 把 `[start, end)` 去空白后加入区间列表。 */
function pushRange(ranges: TextRange[], text: string, start: number, end: number): void {
  let from = start
  let to = end
  while (from < to && /\s/.test(text[from])) from++
  while (to > from && /\s/.test(text[to - 1])) to--
  if (to > from) ranges.push({ start: from, end: to })
}

/**
 * 按句子/换行切分文本，返回相对 `text` 的区间。
 *
 * 纯函数：只有偏移，不产出字符串，调用方自己切片，因此 `quote` 与被引用的原文
 * 一定逐字一致（reader 的高亮就靠这个）。
 */
export function splitSentences(text: string): TextRange[] {
  const ranges: TextRange[] = []
  let start = 0

  for (let i = 0; i < text.length; i++) {
    const boundary = text[i] === '\n' || isSentenceBoundary(text, i)
    if (!boundary) continue
    pushRange(ranges, text, start, i + 1)
    start = i + 1
  }

  pushRange(ranges, text, start, text.length)
  return ranges
}

/**
 * 句子区间 → candidate 区间。
 *
 * 单句是基本单位，但不强制拆到单句：一句太短时与后面的句子合并，这样
 * 「A 导致 B。因此结果为 C。」这类需要两句才能支撑的 claim 仍然能被引到。
 * 上限是 3 句或约 80 字符，先到者为准；末尾过短的片段并回上一条，不留半句话。
 */
export function groupCandidateRanges(text: string): TextRange[] {
  const groups: TextRange[] = []
  let current: TextRange | null = null
  let sentences = 0

  for (const sentence of splitSentences(text)) {
    current = current ? { start: current.start, end: sentence.end } : { ...sentence }
    sentences += 1

    if (
      sentences >= MAX_CANDIDATE_SENTENCES ||
      current.end - current.start >= MIN_CANDIDATE_CHARS
    ) {
      groups.push(current)
      current = null
      sentences = 0
    }
  }

  if (current) {
    const last = groups[groups.length - 1]
    if (last) {
      last.end = current.end
    } else {
      groups.push(current)
    }
  }

  return groups
}

/**
 * 一次检索的全部证据 → 全局连续编号的 citation candidates。
 *
 * 编号从 `startIndex` 起、跨 chunk 连续，因为它同时就是模型在回答里写的 `[n]`。
 * 它只在这一次回答内有效，不是数据库级 id；稳定的定位是 candidate 携带的
 * `documentId` / `chunkId` / `blockId` / `startOffset` / `endOffset` / `quote`。
 */
export function buildCitationCandidates(
  sources: readonly CitationCandidateSource[],
  startIndex = 1
): CitationCandidate[] {
  const candidates: CitationCandidate[] = []
  let index = startIndex

  for (const source of sources) {
    const { blocks } = source.locator

    // 没有块结构（旧索引，或未产出块的来源）：保留整段原文作为兜底候选，但没有
    // 任何 span 可指 —— 缺字段好过编一个假的 offset。
    if (blocks.length === 0) {
      const quote = source.content?.trim()
      if (quote) {
        candidates.push({
          index: index++,
          documentId: source.documentId,
          chunkId: source.chunkId,
          quote
        })
      }
      continue
    }

    for (const block of blocks) {
      const portion = block.text.slice(block.startInBlock, block.endInBlock)
      if (portion.trim().length === 0) continue

      for (const range of groupCandidateRanges(portion)) {
        const candidate: CitationCandidate = {
          index: index++,
          documentId: source.documentId,
          chunkId: source.chunkId,
          quote: portion.slice(range.start, range.end),
          startOffset: block.startOffset + block.startInBlock + range.start,
          endOffset: block.startOffset + block.startInBlock + range.end
        }

        if (block.blockId) candidate.blockId = block.blockId
        if (block.page !== null && block.page !== undefined) candidate.page = block.page

        candidates.push(candidate)
      }
    }
  }

  return candidates
}
