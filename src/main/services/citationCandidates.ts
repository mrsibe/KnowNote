import type { CitationCandidate } from '../../shared/types/citation'
import { splitSentences, type TextRange } from '../../shared/utils/sentenceSegmentation'
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
 *
 * Sentence boundaries come from `shared/utils/sentenceSegmentation`, the same
 * splitter #156 uses to check an answer sentence by sentence — the two must agree
 * or a candidate and a coverage statement would be about different spans.
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

/** 一个 candidate 大致的最小字符数：短句会与相邻句合并，而不是各自成条。 */
const MIN_CANDIDATE_CHARS = 80

/** 一个 candidate 最多合并多少句。 */
const MAX_CANDIDATE_SENTENCES = 3

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
