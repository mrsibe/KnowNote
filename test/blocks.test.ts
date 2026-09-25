import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PdfLoader } from '../src/main/services/loaders/PdfLoader.ts'
import { DocxLoader } from '../src/main/services/loaders/DocxLoader.ts'
import { MarkdownLoader } from '../src/main/services/loaders/MarkdownLoader.ts'
import { WebLoader } from '../src/main/services/loaders/WebLoader.ts'
import {
  buildDocumentBlocks,
  type BlockSource,
  type DocumentBlockDraft
} from '../src/main/services/blocks/documentBlocks.ts'
import type { DocumentLoadResult } from '../src/main/services/loaders/types.ts'

/**
 * `document_blocks` makes citations possible: a chunk will eventually point at a
 * block, and a block says where in `documents.content` the text lives. The one
 * invariant everything else rests on is
 *
 *   content.slice(startOffset, endOffset) === text
 *
 * so it is asserted for every block produced from every fixture. The rest is
 * loader mapping: PDF blocks must agree with `structure.pages`, Markdown/DOCX
 * blocks must keep their heading levels, and text/URL ingestion (which has no
 * parser structure) must still produce paragraph-level flat blocks.
 */

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const fixture = (name: string): string => join(FIXTURES, name)

/** Assert the canonical-content invariant plus dense, ordered block numbering. */
function assertBlocks(content: string, blocks: DocumentBlockDraft[]): void {
  assert.deepEqual(
    blocks.map((block) => block.order),
    blocks.map((_, index) => index),
    'block order must be dense and ascending'
  )

  for (const block of blocks) {
    assert.ok(block.endOffset > block.startOffset, `${block.kind} block ${block.order} is empty`)
    assert.ok(
      block.endOffset <= content.length,
      `${block.kind} block ${block.order} runs past the document`
    )
    assert.equal(
      content.slice(block.startOffset, block.endOffset),
      block.text,
      `${block.kind} block ${block.order} does not slice back to its text`
    )
  }
}

function blocksFor(result: DocumentLoadResult): DocumentBlockDraft[] {
  return buildDocumentBlocks({ content: result.content, structure: result.structure })
}

test('PDF: one block per page, page numbers agree with structure.pages', async () => {
  const result = await new PdfLoader().loadFromPath(fixture('multipage.pdf'))
  const pages = result.structure?.pages ?? []
  const blocks = blocksFor(result)

  assert.equal(blocks.length, pages.length)
  assert.deepEqual(
    blocks.map((block) => block.page),
    pages.map((page) => page.pageNumber)
  )
  assertBlocks(result.content, blocks)
})

test('PDF: page blocks carry a normalized bbox inside the unit square', async () => {
  const result = await new PdfLoader().loadFromPath(fixture('sample.pdf'))
  const blocks = blocksFor(result)

  assert.equal(blocks.length, 1)
  const bbox = blocks[0].bbox
  assert.ok(bbox, 'a PDF page block must carry a bbox derived from its text items')

  for (const value of [bbox.x, bbox.y, bbox.w, bbox.h]) {
    assert.ok(value >= 0 && value <= 1, `bbox component ${value} is not normalized`)
  }
  assert.ok(bbox.w > 0 && bbox.h > 0, 'bbox must have a non-zero area')
  assert.ok(bbox.x + bbox.w <= 1 && bbox.y + bbox.h <= 1, 'bbox escapes the page')
})

test('DOCX: heading blocks keep their level and body becomes paragraphs', async () => {
  const result = await new DocxLoader().loadFromPath(fixture('headings.docx'))
  const blocks = blocksFor(result)
  assertBlocks(result.content, blocks)

  assert.deepEqual(
    blocks.map((block) => [block.kind, block.level, block.text]),
    [
      ['heading', 1, 'Overview'],
      ['paragraph', null, 'Overview body text.'],
      ['heading', 2, 'Details'],
      ['paragraph', null, 'Details body text.'],
      ['heading', 1, 'Summary'],
      ['paragraph', null, 'Summary body text.']
    ]
  )
  assert.ok(
    blocks.every((block) => block.page === null),
    'a non-paged document must not invent page numbers'
  )
})

test('Markdown: headings and paragraphs follow document order', async () => {
  const result = await new MarkdownLoader().loadFromPath(fixture('sample.md'))
  const blocks = blocksFor(result)
  assertBlocks(result.content, blocks)

  assert.deepEqual(
    blocks.map((block) => [block.kind, block.level]),
    [
      ['heading', 1],
      ['paragraph', null],
      ['heading', 2],
      ['paragraph', null],
      ['heading', 2],
      ['paragraph', null]
    ]
  )
  assert.equal(blocks[0].text, '# Sample Markdown')
  assert.equal(blocks[2].text, '## Section One')
  assert.equal(blocks[2].startOffset, result.content.indexOf('## Section One'))
})

test('HTML without reliable section offsets falls back to flat paragraphs', async () => {
  const result = await new WebLoader().loadFromBuffer(await readFile(fixture('sample.html')))
  const blocks = blocksFor(result)
  assertBlocks(result.content, blocks)

  assert.ok(blocks.length > 0)
  assert.ok(
    blocks.every((block) => block.kind === 'paragraph'),
    'unreliable section offsets must not become heading blocks'
  )
})

test('sections whose offsets do not point at their titles are ignored', () => {
  const source: BlockSource = {
    content: 'Opening paragraph.\n\n## Real Heading\n\nBody.',
    structure: {
      type: 'sections',
      sections: [{ level: 2, title: 'Real Heading', content: '', startOffset: 0, endOffset: 0 }]
    }
  }

  const blocks = buildDocumentBlocks(source)
  assertBlocks(source.content, blocks)
  assert.ok(
    blocks.every((block) => block.kind !== 'heading'),
    'a zero offset must not be trusted as a heading location'
  )
})

test('flat text is split into paragraph blocks on blank lines only', () => {
  const content = 'First paragraph\nstill the first.\n\nSecond paragraph.\n\n\nThird.'
  const blocks = buildDocumentBlocks({ content })
  assertBlocks(content, blocks)

  assert.deepEqual(
    blocks.map((block) => block.text),
    ['First paragraph\nstill the first.', 'Second paragraph.', 'Third.']
  )
})

test('whitespace-only content produces no blocks', () => {
  assert.deepEqual(buildDocumentBlocks({ content: '   \n\n\t\n' }), [])
})
