/**
 * documentBlocks
 * 把解析结果（`DocumentLoadResult`）转换成可持久化的文档块序列。
 *
 * 块是"引用"的落点：每个块都带 `startOffset`/`endOffset`，它们索引的是
 * `documents.content` 这一份规范字符串。因此这里不重新清洗文本、不拼接字符串，
 * 块文本一律由 `content.slice(start, end)` 得到，从构造上保证
 * `content.slice(start, end) === text` 恒成立。
 *
 * 纯函数、不依赖 Electron/SQLite，便于直接单测。
 */

import type { DocumentStructure, NormalizedBox, PageInfo, SectionInfo } from '../loaders/types'

/** 块类型。当前只产出 heading / paragraph，其余留给后续的阅读器工作。 */
export type BlockKind =
  'heading' | 'paragraph' | 'list_item' | 'table' | 'figure' | 'caption' | 'code'

/** 尚未分配 id/documentId 的块。 */
export interface DocumentBlockDraft {
  kind: BlockKind
  order: number
  page: number | null
  level: number | null
  text: string
  startOffset: number
  endOffset: number
  bbox: NormalizedBox | null
  metadata: Record<string, unknown> | null
}

/** 已分配 id 的块；持久化与分块共用同一批对象，id 只生成一次。 */
export interface IdentifiedBlockDraft extends DocumentBlockDraft {
  id: string
  documentId: string
}

/**
 * 给块分配 id。id 由 documentId 与顺序确定，天然唯一且可读。重新索引复用同一个
 * documentId，但会先删除该文档的旧块，所以顺序 id 不会与旧块冲突。
 */
export function assignBlockIds(
  documentId: string,
  drafts: DocumentBlockDraft[]
): IdentifiedBlockDraft[] {
  return drafts.map((draft) => ({
    ...draft,
    id: `blk_${documentId}_${draft.order}`,
    documentId
  }))
}

export interface BlockSource {
  content: string
  structure?: DocumentStructure
}

interface HeadingRef {
  level: number
  title: string
  startOffset: number
}

/**
 * 生成块序列，`order` 从 0 开始连续编号。
 *
 * - 分页文档（PDF/PPT）：每页一个块，页码与 `structure.pages` 一致，bbox 取该页
 *   文本项的归一化并集。
 * - 有可用标题偏移的章节文档（Markdown/DOCX）：按标题层级切出 heading + paragraph。
 * - 其余（纯文本、URL、偏移不可靠的 HTML 等）：按空行切段落级平铺块。
 */
export function buildDocumentBlocks(source: BlockSource): DocumentBlockDraft[] {
  const { content, structure } = source

  let blocks: Omit<DocumentBlockDraft, 'order'>[]
  if (structure?.type === 'pages' && structure.pages) {
    blocks = buildPageBlocks(content, structure.pages)
  } else {
    const headings =
      structure?.type === 'sections' && structure.sections
        ? usableHeadings(content, structure.sections)
        : []
    blocks = headings.length > 0 ? buildSectionBlocks(content, headings) : buildFlatBlocks(content)
  }

  return blocks.map((block, order) => ({ ...block, order }))
}

/**
 * 分页文档：优先用 loader 已经分好的页内段落（PDF），每个段落一个块；loader 没有
 * 提供页内块时（例如旧的 / 非 PDF 分页格式）回退到整页一块。页偏移已由 loader
 * 保证与规范文本一致，块文本直接切出来。
 */
function buildPageBlocks(content: string, pages: PageInfo[]): Omit<DocumentBlockDraft, 'order'>[] {
  const blocks: Omit<DocumentBlockDraft, 'order'>[] = []

  for (const page of pages) {
    if (page.blocks && page.blocks.length > 0) {
      for (const pageBlock of page.blocks) {
        const text = content.slice(pageBlock.startOffset, pageBlock.endOffset)
        if (text.trim().length === 0) continue

        blocks.push({
          kind: 'paragraph',
          page: page.pageNumber,
          level: null,
          text,
          // 用实际切出的文本长度回写 endOffset，避免 loader 的结尾空白把块撑出内容范围
          startOffset: pageBlock.startOffset,
          endOffset: pageBlock.startOffset + text.length,
          bbox: pageBlock.bbox ?? null,
          metadata: null
        })
      }
      continue
    }

    const text = content.slice(page.startOffset, page.endOffset)
    if (text.trim().length === 0) continue

    blocks.push({
      kind: 'paragraph',
      page: page.pageNumber,
      level: null,
      text,
      startOffset: page.startOffset,
      endOffset: page.startOffset + text.length,
      bbox: page.bbox ?? null,
      metadata: null
    })
  }

  return blocks
}

/**
 * 章节文档：只依赖标题的 `startOffset`（mdast/标题定位给出的位置是准确的），
 * 正文从标题行末尾切到下一个标题，再按空行分段。父子标题因此不会互相包含。
 */
function buildSectionBlocks(
  content: string,
  headings: HeadingRef[]
): Omit<DocumentBlockDraft, 'order'>[] {
  const blocks: Omit<DocumentBlockDraft, 'order'>[] = []
  let cursor = 0

  for (const heading of headings) {
    if (heading.startOffset > cursor) {
      blocks.push(...paragraphBlocks(content, cursor, heading.startOffset))
    }

    const lineEnd = endOfLine(content, heading.startOffset)
    blocks.push({
      kind: 'heading',
      page: null,
      level: heading.level,
      text: content.slice(heading.startOffset, lineEnd),
      startOffset: heading.startOffset,
      endOffset: lineEnd,
      bbox: null,
      metadata: null
    })

    cursor = lineEnd
  }

  if (cursor < content.length) {
    blocks.push(...paragraphBlocks(content, cursor, content.length))
  }

  return blocks
}

function buildFlatBlocks(content: string): Omit<DocumentBlockDraft, 'order'>[] {
  return paragraphBlocks(content, 0, content.length)
}

function paragraphBlocks(
  content: string,
  from: number,
  to: number
): Omit<DocumentBlockDraft, 'order'>[] {
  return splitParagraphs(content, from, to).map(({ start, end }) => ({
    kind: 'paragraph' as const,
    page: null,
    level: null,
    text: content.slice(start, end),
    startOffset: start,
    endOffset: end,
    bbox: null,
    metadata: null
  }))
}

/**
 * 返回章节树里可用的标题，按文档顺序排列。不可用时返回空数组，调用方回退到平铺块。
 *
 * 拒绝两件事：偏移重复（例如 WebLoader 的章节全是 0），以及偏移处根本不是该标题
 * （防止把错误偏移当成结构来用）。
 */
function usableHeadings(content: string, sections: SectionInfo[]): HeadingRef[] {
  const flat = flattenSections(sections)
  if (flat.length === 0) return []

  const starts = flat.map((section) => section.startOffset)
  if (new Set(starts).size !== starts.length) return []

  const usable: HeadingRef[] = []
  for (const section of flat) {
    if (section.startOffset < 0 || section.startOffset >= content.length) return []
    if (!headingMatchesContent(content, section)) return []
    usable.push({ level: section.level, title: section.title, startOffset: section.startOffset })
  }

  return usable.sort((a, b) => a.startOffset - b.startOffset)
}

function flattenSections(sections: SectionInfo[]): SectionInfo[] {
  const flat: SectionInfo[] = []
  const walk = (nodes: SectionInfo[]): void => {
    for (const node of nodes) {
      flat.push(node)
      if (node.children?.length) walk(node.children)
    }
  }
  walk(sections)
  return flat
}

/** 标题文本应出现在 `startOffset` 附近（Markdown 前面还有 `#` 标记）。 */
function headingMatchesContent(content: string, section: SectionInfo): boolean {
  const windowEnd = Math.min(
    content.length,
    section.startOffset + section.level + section.title.length + 4
  )
  return content.slice(section.startOffset, windowEnd).includes(section.title)
}

function endOfLine(content: string, from: number): number {
  const newline = content.indexOf('\n', from)
  return newline === -1 ? content.length : newline
}

/**
 * 把 [from, to) 按空行切成段落范围。范围是精确的、互不重叠的，块文本由调用方切片，
 * 因此不需要（也不允许）在这里改写文本。
 */
function splitParagraphs(
  content: string,
  from: number,
  to: number
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let i = from

  while (i < to) {
    while (i < to && isWhitespace(content[i])) i++
    if (i >= to) break

    const start = i
    let end = i

    while (i < to) {
      if (content[i] === '\n' && isBlankLineBreak(content, i, to)) break
      if (!isWhitespace(content[i])) end = i + 1
      i++
    }

    if (end > start) ranges.push({ start, end })

    while (i < to && isWhitespace(content[i])) i++
  }

  return ranges
}

/** `content[index]` 是换行符时，判断它是否开启一个空行。 */
function isBlankLineBreak(content: string, index: number, to: number): boolean {
  let i = index + 1
  while (i < to && content[i] !== '\n' && isWhitespace(content[i])) i++
  return i >= to || content[i] === '\n'
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}
