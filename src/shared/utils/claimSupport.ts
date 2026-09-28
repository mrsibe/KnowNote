import type { Citation } from '../types/citation'
import { resolveCitations } from './citationResolution'
import { splitSentences } from './sentenceSegmentation'

/**
 * Claim support / citation coverage (#156).
 *
 * What this measures is **coverage**, and only coverage:
 *
 *   does this sentence carry a citation that points at a span that exists?
 *
 * It deliberately does **not** decide whether the citation *proves* the sentence.
 * "该实验样本量为 150 人" is supported by "The experiment included 150
 * participants", and the two share almost nothing — that is semantic entailment
 * (NLI), a model question, not a rule. A deterministic check that pretended to
 * answer it would produce a wrong "grounded" verdict, which is worse than no
 * verdict because the reader trusts it. Semantic support, if wanted, is an
 * eval-only signal reported separately.
 *
 * The four statuses are mutually exclusive and exhaustive for one sentence:
 *
 *   cited             the sentence has a marker that resolves to a real citation
 *   invalid-citation  the sentence has a marker that resolves to nothing (#70 path)
 *   inference         the model marked its own claim as not coming from the sources
 *   uncited           a prose sentence with no marker at all
 */

export type ClaimSupportStatus = 'cited' | 'uncited' | 'invalid-citation' | 'inference'

export interface ClaimSupportSentence {
  status: ClaimSupportStatus
  /** 该句原文（含其 marker），按原顺序。 */
  text: string
}

export interface ClaimSupportCounts {
  cited: number
  uncited: number
  invalid: number
  inference: number
  /** `cited + uncited + invalid`。inference 不计入：它不是「来自来源的事实断言」。 */
  statements: number
}

export interface ClaimSupportReport extends ClaimSupportCounts {
  /** `cited / statements`；没有可判定句子时为 1（没有未支撑的断言）。 */
  coverage: number
  /** `uncited / statements`。 */
  unsupportedRate: number
  /** `invalid / (cited + invalid)`；没有任何 marker 时为 0。 */
  invalidRate: number
  sentences: ClaimSupportSentence[]
}

/** 模型用来标注「这是我的推断，不是来自来源」的标记。 */
const INFERENCE_MARKER = /\[inference\]/i

/**
 * 只把 1-3 位数字当作 citation marker，与 `citationMarkers` / `resolveCitations`
 * 保持一致；`[2024]` 这类年份不是引用。
 */
const MARKER_PATTERN = /\[(\d{1,3})\]/g

/** 是否存在任何（1-3 位数字或 inference）标记。 */
const HAS_MARKER = /\[inference\]|\[\d{1,3}\]/i

/**
 * 这一段是不是只剩标记、没有任何正文。
 *
 * 模型经常写 `A is true. [1]`（标记在句号之后），切句会把 `[1]` 切成一个独立
 * 片段。它不是一句话，它的标记属于前一句 —— 把这种片段并回上一条，否则前一句会
 * 被误判成 uncited、而后一句变成一条只有标记的假陈述。
 */
function isMarkerOnly(text: string): boolean {
  const withoutMarkers = text.replace(/\[inference\]/gi, '').replace(/\[\d{1,3}\]/g, '')
  return withoutMarkers.trim().length === 0 && HAS_MARKER.test(text)
}

/** 去掉 fenced code block：代码不是「从来源得出的断言」，不该进入 coverage。 */
function stripFencedCode(answer: string): string {
  return answer.replace(/```[\s\S]*?```/g, ' ')
}

/** 标题行不是断言。 */
function isHeading(text: string): boolean {
  return /^\s{0,3}#{1,6}\s/.test(text)
}

/** 至少含一个字母或 CJK 字符才算可判定的句子。 */
function isProse(text: string): boolean {
  return !isHeading(text) && /[A-Za-z\u4e00-\u9fff]/.test(text)
}

/**
 * 逐句判定 citation coverage。
 *
 * 纯函数：不查库、不调模型、不碰 DOM。`citations` 传**已经解析成功并持久化**的
 * 引用即可 —— 一个 `[n]` 找不到对应的 `Citation`，就是 `invalid-citation`，这与
 * #70 在写入时把不可解析的 marker 过滤掉是同一个事实的两端。
 */
export function classifyClaimSupport(
  answer: string,
  citations: readonly Citation[]
): ClaimSupportReport {
  const text = stripFencedCode(answer)
  const resolution = resolveCitations(text, citations)

  // marker 在原文里的绝对位置 → 无法解析。只用于查表，判定仍按句子。
  const invalidPositions = new Set(
    [...resolution.unresolved, ...resolution.misattributed].map((match) => match.position)
  )

  const sentences: ClaimSupportSentence[] = []
  const counts: ClaimSupportCounts = {
    cited: 0,
    uncited: 0,
    invalid: 0,
    inference: 0,
    statements: 0
  }

  // 先把只有标记的片段并回上一条，再逐句判定。
  const ranges: { start: number; end: number }[] = []
  for (const range of splitSentences(text)) {
    const previous = ranges.at(-1)
    if (previous && isMarkerOnly(text.slice(range.start, range.end))) {
      previous.end = range.end
      continue
    }
    ranges.push({ ...range })
  }

  for (const range of ranges) {
    const sentence = text.slice(range.start, range.end)
    if (!isProse(sentence)) continue

    let status: ClaimSupportStatus

    if (INFERENCE_MARKER.test(sentence)) {
      status = 'inference'
    } else {
      const markers = [...sentence.matchAll(MARKER_PATTERN)]
      if (markers.length === 0) {
        status = 'uncited'
      } else {
        const hasInvalid = markers.some((marker) =>
          invalidPositions.has(range.start + (marker.index ?? 0))
        )
        status = hasInvalid ? 'invalid-citation' : 'cited'
      }
    }

    if (status === 'inference') {
      counts.inference += 1
    } else {
      counts.statements += 1
      if (status === 'cited') counts.cited += 1
      else if (status === 'uncited') counts.uncited += 1
      else counts.invalid += 1
    }

    sentences.push({ status, text: sentence })
  }

  const { cited, uncited, invalid, statements } = counts
  const markerClaims = cited + invalid

  return {
    ...counts,
    coverage: statements === 0 ? 1 : cited / statements,
    unsupportedRate: statements === 0 ? 0 : uncited / statements,
    invalidRate: markerClaims === 0 ? 0 : invalid / markerClaims,
    sentences
  }
}
