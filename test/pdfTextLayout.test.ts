import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  layoutPageText,
  type PositionedTextItem
} from '../src/main/services/loaders/pdfTextLayout.ts'
import {
  buildDocumentBlocks,
  type DocumentBlockDraft
} from '../src/main/services/blocks/documentBlocks.ts'
import type { DocumentStructure } from '../src/main/services/loaders/types.ts'

/**
 * The PDF loader used to join every `TextItem` on a page into one string, so a
 * citation could only ever say "page 12", never "the paragraph at the bottom of
 * page 12". `layoutPageText()` groups items geometrically into lines and then
 * paragraphs; these tests pin that geometry with synthetic items, so the rule
 * is testable without a PDF fixture.
 *
 * The second half checks that `buildDocumentBlocks()` turns those paragraphs
 * into blocks whose offsets still slice back out of `documents.content` — the
 * one invariant the whole provenance chain rests on.
 */

/** A viewport-space text item; font height defaults to 10. */
function item(str: string, left: number, baseline: number, width: number, height = 10) {
  return { str, left, baseline, width, height }
}

/** Two lines in one paragraph, then a second paragraph after a blank line. */
function twoParagraphPage(): PositionedTextItem[] {
  return [
    item('First', 50, 100, 40),
    item('line', 96, 100, 20),
    item('continues', 50, 114, 60),
    item('Second paragraph.', 50, 140, 110)
  ]
}

test('items on the same baseline become one line and words are spaced apart', () => {
  const [first] = layoutPageText(twoParagraphPage(), 800, 1000).slice(0, 1)
  assert.ok(first)
  // "First" ends at x=90, "line" starts at x=96: a gap, so a space is inserted.
  assert.equal(first.text, 'First line continues')
})

test('a word split across items is not given an inner space', () => {
  const words = [item('Know', 50, 100, 32), item('Note', 82, 100, 34)]
  const [paragraph] = layoutPageText(words, 800, 1000)
  assert.ok(paragraph)
  assert.equal(paragraph.text, 'KnowNote')
})

test('a vertical gap starts a new paragraph, preserving reading order', () => {
  const paragraphs = layoutPageText(twoParagraphPage(), 800, 1000)
  assert.deepEqual(
    paragraphs.map((paragraph) => paragraph.text),
    ['First line continues', 'Second paragraph.']
  )
})

test('a first-line indent starts a new paragraph even without a vertical gap', () => {
  const page = [
    item('one line', 50, 100, 60),
    item('and the next', 70, 112, 70) // left indented by 20 > height(10), gap 2
  ]
  const paragraphs = layoutPageText(page, 800, 1000)
  assert.deepEqual(
    paragraphs.map((paragraph) => paragraph.text),
    ['one line', 'and the next']
  )
})

test('paragraph bboxes are normalized to the page and cover only their own items', () => {
  const paragraphs = layoutPageText(twoParagraphPage(), 800, 1000)
  const [first, second] = paragraphs

  // First paragraph spans x 50..116, y top 90..bottom 114.
  assert.deepEqual(first.bbox, { x: 50 / 800, y: 90 / 1000, w: 66 / 800, h: 24 / 1000 })
  assert.deepEqual(second.bbox, { x: 50 / 800, y: 130 / 1000, w: 110 / 800, h: 10 / 1000 })
})

test('items arrive in any order but read top-to-bottom, left-to-right', () => {
  const shuffled = [
    item('second', 50, 114, 40),
    item('world', 100, 100, 40),
    item('hello', 50, 100, 40)
  ]
  const paragraphs = layoutPageText(shuffled, 800, 1000)
  // Both lines are only 4 apart (top 104 vs 104... 114-10=104) so they merge
  // into one paragraph; order inside the line still follows x.
  assert.equal(paragraphs[0].text, 'hello world second')
})

test('blank and non-finite items are ignored', () => {
  const page = [
    item('   ', 50, 100, 40),
    item('real', 50, 100, 40),
    { str: 'bad', left: NaN, baseline: 100, width: 10, height: 10 }
  ]
  const paragraphs = layoutPageText(page, 800, 1000)
  assert.deepEqual(
    paragraphs.map((paragraph) => paragraph.text),
    ['real']
  )
})

test('an empty page produces no paragraphs', () => {
  assert.deepEqual(layoutPageText([], 800, 1000), [])
})

// --- block consumption -------------------------------------------------------

/**
 * Collapse the two-line page above into a canonical content string the same way
 * `PdfLoader` does: paragraphs joined by a blank line.
 */
function pageStructure(
  paragraphs: {
    text: string
    bbox: import('../src/main/services/loaders/types.ts').NormalizedBox
  }[]
): {
  content: string
  structure: DocumentStructure
} {
  const content = paragraphs.map((paragraph) => paragraph.text).join('\n\n')

  let cursor = 0
  const blocks = paragraphs.map((paragraph) => {
    const startOffset = cursor
    cursor += paragraph.text.length + 2
    return {
      text: paragraph.text,
      startOffset,
      endOffset: startOffset + paragraph.text.length,
      bbox: paragraph.bbox
    }
  })

  // Offsets in `blocks` must address the *trimmed* canonical content.
  const trimmed = content.trim()
  const shift = content.length - content.trimStart().length
  for (const block of blocks) {
    block.startOffset -= shift
    block.endOffset -= shift
  }

  return {
    content: trimmed,
    structure: {
      type: 'pages',
      pages: [
        { pageNumber: 1, content: trimmed, startOffset: 0, endOffset: trimmed.length, blocks }
      ]
    }
  }
}

function assertBlocks(content: string, blocks: DocumentBlockDraft[]): void {
  for (const block of blocks) {
    assert.equal(
      content.slice(block.startOffset, block.endOffset),
      block.text,
      `block ${block.order} does not slice back to its text`
    )
  }
}

test('a multi-paragraph page becomes multiple blocks in reading order', () => {
  const paragraphs = layoutPageText(twoParagraphPage(), 800, 1000)
  const { content, structure } = pageStructure(paragraphs)
  const blocks = buildDocumentBlocks({ content, structure })

  assert.deepEqual(
    blocks.map((block) => block.text),
    ['First line continues', 'Second paragraph.']
  )
  assert.ok(blocks.every((block) => block.page === 1))
  assertBlocks(content, blocks)
})

test('a page without paragraph blocks still falls back to one page-level block', () => {
  const content = 'legacy page text'
  const structure: DocumentStructure = {
    type: 'pages',
    pages: [{ pageNumber: 1, content, startOffset: 0, endOffset: content.length }]
  }
  const blocks = buildDocumentBlocks({ content, structure })

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].text, content)
  assertBlocks(content, blocks)
})
