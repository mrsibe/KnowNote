/**
 * 句子切分（共享）
 *
 * 两个地方需要同一套「什么算一句话」：#155 用它把检索到的 chunk 切成 citation
 * candidate，#156 用它逐句判断回答有没有引用来源。两边必须是同一套规则，否则
 * candidate 的边界和 coverage 的边界会对不上。
 *
 * 只有偏移，不产出字符串：调用方自己切片，因此 quote 与被引用的原文一定逐字一致。
 * 刻意保守 —— `3.14`、`U.S.`、`Fig. 3`、`et al.` 里面的点都不断句。宁可把两句话
 * 合成一段，也不要把一句话切成两半。
 */

/** 相对传入字符串的字符区间。 */
export interface TextRange {
  start: number
  end: number
}

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
