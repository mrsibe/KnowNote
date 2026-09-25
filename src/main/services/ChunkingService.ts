/**
 * ChunkingService
 * 分块服务：按块序列切分，保留规范文本偏移。
 *
 * 关键约束：chunk 的 `content` 一律是 `content.slice(startOffset, endOffset)`。
 * 分块器不再预处理文本、不再改写空白，所以 `documents.content`（每个文档唯一的
 * 规范字符串）与 `chunks.start_offset/end_offset` 永远指向同一份字节。旧的
 * `preprocessText()` 会把偏移算到清洗后的字符串上，这正是"能看到来源标题却无法
 * 高亮来源"的根因。
 */

import Logger from '../../shared/utils/logger'
import type { BlockKind } from './blocks/documentBlocks'

/**
 * 分块选项
 */
export interface ChunkOptions {
  chunkSize?: number // 每块的目标字符数，默认 500
  chunkOverlap?: number // 块之间的重叠字符数，默认 50
  separators?: string[] // 回退窗口在何处断开的优先级列表
  minChunkSize?: number // 整篇文本不超过它时直接作为一块
  allowSpanPages?: boolean // 允许一个 chunk 跨页，默认 false（分页文档在页边界断开）
}

/**
 * 默认分块参数。导出的原因只有一个：eval baseline 报告必须引用真实值，而不是
 * 把它手抄一遍。改了默认值而没有重新跑 baseline，差异会从报告里直接暴露出来。
 */
export const DEFAULT_CHUNK_OPTIONS: Required<ChunkOptions> = {
  chunkSize: 500,
  chunkOverlap: 50,
  minChunkSize: 100,
  allowSpanPages: false,
  separators: [
    '\n\n\n', // 多个空行（章节分隔）
    '\n\n', // 段落分隔
    '\n', // 行分隔
    '。', // 中文句号
    '.', // 英文句号
    '！',
    '!',
    '？',
    '?',
    '；',
    ';',
    '，',
    ',',
    ' ' // 空格（最后手段）
  ]
}

/**
 * 分块器接受的块。字段是 `document_blocks` 的子集。
 */
export interface ChunkBlock {
  id: string
  kind: BlockKind
  page: number | null
  level: number | null
  text: string
  startOffset: number
  endOffset: number
}

/** 一个 chunk 覆盖的某个块内的字符区间。 */
export interface ChunkBlockSpan {
  blockId: string
  startInBlock: number
  endInBlock: number
}

/**
 * 分块结果
 */
export interface ChunkResult {
  content: string // 块内容（规范文本的精确切片）
  index: number // 块索引
  startOffset: number // 规范文本起始位置
  endOffset: number // 规范文本结束位置
  tokenCount: number // 估算 token 数
  blockSpans: ChunkBlockSpan[] // 覆盖的块及其区间（按文档顺序）
  pageStart: number | null // 覆盖块的最小页码；无分页块时为 null
  pageEnd: number | null // 覆盖块的最大页码；无分页块时为 null
}

interface Unit {
  blockIndex: number
  start: number // 规范文本偏移
  end: number
  page: number | null
}

interface Range {
  start: number
  end: number
}

/**
 * 文档分块服务
 * 支持块感知分块（保留来源结构），以及无块时的字符窗口回退。
 */
export class ChunkingService {
  private defaultOptions: Required<ChunkOptions> = DEFAULT_CHUNK_OPTIONS

  /**
   * 块感知分块。偏移与内容都锚定在 `content` 这份规范字符串上。
   *
   * 分块边界只落在语义单元之间（标题 → 段落 → 行 → 句子 → 空白），标题块是原子
   * 单元，永远不会被切开；分页文档默认不跨页。`blockSpans` 记录每个 chunk 覆盖
   * 的块及其区间，供调用方持久化。
   */
  chunkBlocks(content: string, blocks: ChunkBlock[], options?: ChunkOptions): ChunkResult[] {
    const opts = { ...this.defaultOptions, ...options }
    const ordered = [...blocks]
      .filter((block) => block.endOffset > block.startOffset)
      .sort((a, b) => a.startOffset - b.startOffset)

    if (ordered.length === 0) {
      return this.chunk(content, options)
    }

    const units = this.buildUnits(ordered, opts.chunkSize)
    const packed = this.packUnits(content, ordered, units, opts)

    const chunks = packed.map((chunk, index) => ({
      ...chunk,
      index,
      tokenCount: this.estimateTokens(chunk.content)
    }))

    Logger.debug('ChunkingService', `Split ${ordered.length} blocks into ${chunks.length} chunks`)
    return chunks
  }

  /**
   * 无块回退：按字符窗口切分规范文本。不预处理、不改写长度，偏移可精确切回。
   */
  chunk(text: string, options?: ChunkOptions): ChunkResult[] {
    const opts = { ...this.defaultOptions, ...options }
    const { chunkSize, chunkOverlap, separators, minChunkSize } = opts

    if (!text || text.trim().length === 0) return []

    const chunks: ChunkResult[] = []
    const push = (start: number, end: number): void => {
      while (start < end && isWhitespace(text[start])) start++
      while (end > start && isWhitespace(text[end - 1])) end--
      if (end <= start) return

      const content = text.slice(start, end)
      chunks.push({
        content,
        index: chunks.length,
        startOffset: start,
        endOffset: end,
        tokenCount: this.estimateTokens(content),
        blockSpans: [],
        pageStart: null,
        pageEnd: null
      })
    }

    if (text.length <= minChunkSize) {
      push(0, text.length)
      return chunks
    }

    let start = 0
    while (start < text.length) {
      let end = Math.min(start + chunkSize, text.length)
      if (end < text.length) {
        const split = this.findSeparatorSplit(text, start, end, separators)
        if (split > start) end = split
      }

      push(start, end)
      if (end >= text.length) break

      start = Math.max(end - chunkOverlap, start + 1)
    }

    Logger.debug('ChunkingService', `Split text into ${chunks.length} chunks`)
    return chunks
  }

  /**
   * 把块序列拆成语义单元。标题块整体作为一个原子单元；段落按行、句子、空白逐步
   * 细分，但绝不跨越块边界（块边界本身就是段落级语义边界）。
   */
  private buildUnits(blocks: ChunkBlock[], chunkSize: number): Unit[] {
    const units: Unit[] = []

    blocks.forEach((block, blockIndex) => {
      const page = block.page
      const push = (start: number, end: number, trim: boolean): void => {
        if (trim) {
          while (start < end && isWhitespace(block.text[start])) start++
          while (end > start && isWhitespace(block.text[end - 1])) end--
        }
        if (end > start) {
          units.push({
            blockIndex,
            start: block.startOffset + start,
            end: block.startOffset + end,
            page
          })
        }
      }

      if (block.kind === 'heading') {
        push(0, block.text.length, true)
        return
      }

      // 代码/表格保留行首缩进；其余块的行首行尾空白不属于内容
      const preserveWhitespace = block.kind === 'code' || block.kind === 'table'

      for (const line of lineRanges(block.text)) {
        if (line.end - line.start <= chunkSize) {
          push(line.start, line.end, !preserveWhitespace)
          continue
        }

        for (const sentence of sentenceRanges(block.text, line.start, line.end)) {
          if (sentence.end - sentence.start <= chunkSize) {
            push(sentence.start, sentence.end, !preserveWhitespace)
            continue
          }
          for (const piece of hardSplit(block.text, sentence.start, sentence.end, chunkSize)) {
            push(piece.start, piece.end, !preserveWhitespace)
          }
        }
      }
    })

    return units
  }

  /**
   * 贪心装箱：装满 chunkSize 前尽量合并单元；页边界处默认断开；重叠按规范偏移对齐
   * 到单元起点，所以重叠区域两块的字节完全一致。
   */
  private packUnits(
    content: string,
    blocks: ChunkBlock[],
    units: Unit[],
    opts: Required<ChunkOptions>
  ): Array<Omit<ChunkResult, 'index' | 'tokenCount'>> {
    const chunks: Array<Omit<ChunkResult, 'index' | 'tokenCount'>> = []
    let current: Unit[] = []

    const flush = (): void => {
      if (current.length === 0) return
      chunks.push(this.materialize(content, blocks, current))
      current = []
    }

    for (const unit of units) {
      if (current.length === 0) {
        current.push(unit)
        continue
      }

      const pageBreak =
        !opts.allowSpanPages &&
        unit.page !== null &&
        current[current.length - 1].page !== null &&
        unit.page !== current[current.length - 1].page
      const wouldOverflow = unit.end - current[0].start > opts.chunkSize

      if (pageBreak || wouldOverflow) {
        const overlap = pageBreak ? [] : this.overlapUnits(current, opts.chunkOverlap)
        flush()
        current = overlap
      }

      current.push(unit)
    }

    flush()
    return chunks
  }

  /** 从已满 chunk 的尾部取不超过 chunkOverlap 的单元作为下一块的开头。 */
  private overlapUnits(current: Unit[], chunkOverlap: number): Unit[] {
    if (chunkOverlap <= 0) return []

    const end = current[current.length - 1].end
    const picked: Unit[] = []
    for (let i = current.length - 1; i >= 0; i--) {
      if (end - current[i].start > chunkOverlap) break
      picked.unshift(current[i])
    }

    // 不要把整个上一块当作重叠，否则新块只会不停变长
    if (picked.length === current.length && picked.length > 1) picked.shift()
    return picked
  }

  /** 依据单元范围切出 chunk 内容与块区间。内容永远是规范文本的精确切片。 */
  private materialize(
    content: string,
    blocks: ChunkBlock[],
    units: Unit[]
  ): Omit<ChunkResult, 'index' | 'tokenCount'> {
    const startOffset = units[0].start
    const endOffset = units[units.length - 1].end
    const pieces = content.slice(startOffset, endOffset)

    const blockSpans: ChunkBlockSpan[] = []
    const pages: number[] = []

    for (const unit of units) {
      const block = blocks[unit.blockIndex]
      if (block.page !== null) pages.push(block.page)

      const startInBlock = unit.start - block.startOffset
      const endInBlock = unit.end - block.startOffset
      const last = blockSpans[blockSpans.length - 1]

      if (last && last.blockId === block.id) {
        last.startInBlock = Math.min(last.startInBlock, startInBlock)
        last.endInBlock = Math.max(last.endInBlock, endInBlock)
      } else {
        blockSpans.push({ blockId: block.id, startInBlock, endInBlock })
      }
    }

    return {
      content: pieces,
      startOffset,
      endOffset,
      blockSpans,
      pageStart: pages.length > 0 ? Math.min(...pages) : null,
      pageEnd: pages.length > 0 ? Math.max(...pages) : null
    }
  }

  /** 在 [start, end) 内从右向左找优先级最高的分隔符，返回断开位置。 */
  private findSeparatorSplit(
    text: string,
    start: number,
    end: number,
    separators: string[]
  ): number {
    const searchStart = Math.max(start + Math.floor((end - start) / 2), start)
    let bestPos = -1
    let bestPriority = separators.length

    for (let i = end; i >= searchStart; i--) {
      for (let j = 0; j < separators.length; j++) {
        if (text.startsWith(separators[j], i)) {
          if (j < bestPriority) {
            bestPos = i + separators[j].length
            bestPriority = j
          }
          break
        }
      }
      if (bestPriority <= 2) break
    }

    return bestPos > start ? bestPos : end
  }

  /**
   * 估算 token 数量
   * 基于中英文混合文本的经验公式
   */
  estimateTokens(text: string): number {
    if (!text || text.length === 0) return 0

    let chineseChars = 0
    let otherChars = 0

    for (const char of text) {
      const code = char.charCodeAt(0)
      // CJK 统一表意文字及扩展
      if (
        (code >= 0x4e00 && code <= 0x9fff) || // CJK 基本
        (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
        (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容
        (code >= 0x3040 && code <= 0x309f) || // 平假名
        (code >= 0x30a0 && code <= 0x30ff) || // 片假名
        (code >= 0xac00 && code <= 0xd7af) // 韩文
      ) {
        chineseChars++
      } else {
        otherChars++
      }
    }

    // 中文约 1.5 字符/token，英文约 4 字符/token
    return Math.ceil(chineseChars / 1.5 + otherChars / 4)
  }

  /**
   * 更新默认选项
   */
  setDefaultOptions(options: Partial<ChunkOptions>): void {
    this.defaultOptions = { ...this.defaultOptions, ...options }
  }
}

/** 文本的每一行（不含换行符）的相对区间。 */
function lineRanges(text: string): Range[] {
  const ranges: Range[] = []
  let start = 0

  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      ranges.push({ start, end: i })
      start = i + 1
    }
  }

  return ranges
}

/** 在 [from, to) 内按句末标点切分。 */
function sentenceRanges(text: string, from: number, to: number): Range[] {
  const ranges: Range[] = []
  let start = from

  for (let i = from; i < to; i++) {
    if (!isSentenceEnd(text[i])) continue

    let end = i + 1
    while (end < to && isSentenceEnd(text[end])) end++
    ranges.push({ start, end })
    start = end
    i = end - 1
  }

  if (start < to) ranges.push({ start, end: to })
  return ranges
}

/** 超长片段的最后手段：按空白装箱，单词本身仍超长时硬切。 */
function hardSplit(text: string, from: number, to: number, maxLength: number): Range[] {
  const ranges: Range[] = []
  let start = from
  let i = from
  let lastWhitespace = -1

  while (i < to) {
    if (i - start >= maxLength) {
      const cut = lastWhitespace > start ? lastWhitespace : i
      ranges.push({ start, end: cut })
      start = cut
      while (start < to && isWhitespace(text[start])) start++
      i = start
      lastWhitespace = -1
      continue
    }

    if (isWhitespace(text[i])) lastWhitespace = i
    i++
  }

  if (start < to) ranges.push({ start, end: to })
  return ranges
}

function isSentenceEnd(char: string): boolean {
  return (
    char === '。' || char === '！' || char === '？' || char === '.' || char === '!' || char === '?'
  )
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}
