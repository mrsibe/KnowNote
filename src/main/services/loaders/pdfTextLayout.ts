/**
 * pdfTextLayout
 * 把 pdf.js 的文本项按几何位置还原成「行 → 段落」。
 *
 * `PdfLoader` 之前把一页所有文本项用空格拼成一个字符串，块粒度因此停在一页一句。
 * 引用要落到「第 12 页右下角那一段」，就需要在页内再分一层。这里只做几何分组，
 * 不碰文本内容 —— 规范文本与偏移由 `PdfLoader` 在拼出内容时统一计算，从而保证
 * `content.slice(startOffset, endOffset) === text` 继续成立。
 *
 * 纯函数：输入是已经转换到视口坐标的文本项，便于用合成数据单测，不需要 PDF fixture。
 */

import type { NormalizedBox } from './types'

/** 已转换到视口坐标（原点左上，y 向下）的文本项。 */
export interface PositionedTextItem {
  str: string
  /** 文本左边缘 x */
  left: number
  /** 文本基线 y（视口坐标） */
  baseline: number
  /** 文本宽度 */
  width: number
  /** 字号（视口坐标下的行高） */
  height: number
}

/** 一行文本。 */
export interface TextLine {
  text: string
  left: number
  right: number
  top: number
  bottom: number
  height: number
}

/** 一个段落：文本 + 归一化到页面的包围盒。 */
export interface TextParagraph {
  text: string
  bbox: NormalizedBox
}

/** 同一行的基线容差（相对最小字号）。 */
const LINE_TOLERANCE = 0.5
/** 行间垂直空隙超过多少倍行高视为新段落。 */
const PARAGRAPH_GAP = 0.6
/** 行首相对段首左边缘缩进超过多少倍字号视为新段落。 */
const INDENT_RATIO = 1
/** 同一行内文本项间距超过多少倍字号时补一个空格。 */
const SPACE_GAP = 0.25

/**
 * 把一页的文本项还原成段落列表。顺序为阅读顺序：先按基线自上而下，行内自左向右。
 * 文本项全部无效时返回空数组。
 */
export function layoutPageText(
  items: PositionedTextItem[],
  pageWidth: number,
  pageHeight: number
): TextParagraph[] {
  const lines = groupLines(items)
  const paragraphs = groupParagraphs(lines)

  return paragraphs.map((paragraph) => ({
    text: paragraph.text,
    bbox: normalizeBox(paragraph.box, pageWidth, pageHeight)
  }))
}

interface LineDraft {
  items: PositionedTextItem[]
  baseline: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
}

/** 按基线把文本项聚成行，行内按 x 排序后拼出文本。 */
function groupLines(items: PositionedTextItem[]): TextLine[] {
  const usable = items.filter(
    (item) =>
      item.str.trim().length > 0 &&
      Number.isFinite(item.left) &&
      Number.isFinite(item.baseline) &&
      Number.isFinite(item.width) &&
      Number.isFinite(item.height)
  )

  const sorted = [...usable].sort((a, b) => a.baseline - b.baseline || a.left - b.left || 0)

  const drafts: LineDraft[] = []

  for (const item of sorted) {
    const last = drafts[drafts.length - 1]
    const tolerance = Math.max(
      1,
      Math.min(last?.height ?? item.height, item.height) * LINE_TOLERANCE
    )
    const sameLine = last !== undefined && Math.abs(item.baseline - last.baseline) <= tolerance

    if (sameLine && last) {
      last.items.push(item)
      const count = last.items.length
      last.baseline = (last.baseline * (count - 1) + item.baseline) / count
      last.height = Math.max(last.height, item.height)
      last.left = Math.min(last.left, item.left)
      last.right = Math.max(last.right, item.left + item.width)
      last.top = Math.min(last.top, item.baseline - item.height)
      last.bottom = Math.max(last.bottom, item.baseline)
    } else {
      drafts.push({
        items: [item],
        baseline: item.baseline,
        height: item.height,
        left: item.left,
        right: item.left + item.width,
        top: item.baseline - item.height,
        bottom: item.baseline
      })
    }
  }

  return drafts
    .filter((draft) => draft.items.some((item) => item.str.trim().length > 0))
    .map((draft) => ({
      text: lineText(draft.items),
      left: draft.left,
      right: draft.right,
      top: draft.top,
      bottom: draft.bottom,
      height: draft.height
    }))
    .filter((line) => line.text.length > 0)
}

/** 行内按 x 排序，间距足够大时补空格（同一词被拆成多个文本项时不补）。 */
function lineText(items: PositionedTextItem[]): string {
  const ordered = [...items].sort((a, b) => a.left - b.left)

  let text = ''
  let previousRight: number | null = null
  let previousHeight = 0

  for (const item of ordered) {
    if (previousRight !== null) {
      const gap = item.left - previousRight
      if (gap > SPACE_GAP * Math.max(previousHeight, item.height)) text += ' '
    }
    text += item.str
    previousRight = item.left + item.width
    previousHeight = item.height
  }

  return collapseWhitespace(text)
}

interface ParagraphDraft {
  lines: TextLine[]
  left: number
  top: number
  bottom: number
}

/** 按垂直间距与首行缩进把行聚成段落。 */
function groupParagraphs(lines: TextLine[]): Array<{ text: string; box: Box }> {
  const paragraphs: ParagraphDraft[] = []
  let current: ParagraphDraft | null = null

  const flush = (): void => {
    if (current && current.lines.length > 0) paragraphs.push(current)
    current = null
  }

  for (const line of lines) {
    if (!current) {
      current = {
        lines: [line],
        left: line.left,
        top: line.top,
        bottom: line.bottom
      }
      continue
    }

    const previous = current.lines[current.lines.length - 1]
    const gap = line.top - previous.bottom
    const lineHeight = Math.max(previous.height, line.height)
    const newParagraph =
      gap > PARAGRAPH_GAP * lineHeight ||
      (gap > 0 && line.left - current.left > INDENT_RATIO * line.height)

    if (newParagraph) {
      flush()
      current = {
        lines: [line],
        left: line.left,
        top: line.top,
        bottom: line.bottom
      }
      continue
    }

    current.lines.push(line)
    current.top = Math.min(current.top, line.top)
    current.bottom = Math.max(current.bottom, line.bottom)
  }

  flush()

  return paragraphs
    .map((paragraph) => ({
      text: collapseWhitespace(paragraph.lines.map((line) => line.text).join(' ')),
      box: {
        left: Math.min(...paragraph.lines.map((line) => line.left)),
        top: paragraph.top,
        right: Math.max(...paragraph.lines.map((line) => line.right)),
        bottom: paragraph.bottom
      }
    }))
    .filter((paragraph) => paragraph.text.length > 0)
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** 视口坐标 → 0..1 归一化页面坐标。 */
function normalizeBox(box: Box, pageWidth: number, pageHeight: number): NormalizedBox {
  const clamp = (value: number): number => Math.min(1, Math.max(0, value))
  const width = pageWidth || 1
  const height = pageHeight || 1

  const left = Math.min(box.left, box.right)
  const right = Math.max(box.left, box.right)
  const top = Math.min(box.top, box.bottom)
  const bottom = Math.max(box.top, box.bottom)

  return {
    x: clamp(left / width),
    y: clamp(top / height),
    w: clamp((right - left) / width),
    h: clamp((bottom - top) / height)
  }
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
