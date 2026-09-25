import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PdfLoader } from '../src/main/services/loaders/PdfLoader.ts'
import {
  assignBlockIds,
  buildDocumentBlocks,
  type BlockKind
} from '../src/main/services/blocks/documentBlocks.ts'
import {
  ChunkingService,
  type ChunkBlock,
  type ChunkResult
} from '../src/main/services/ChunkingService.ts'
import {
  projectChunkProvenance,
  type ChunkProvenanceRow
} from '../src/main/services/chunkProvenance.ts'

/**
 * The chunker is the safety net for the whole provenance epic: if
 * `chunks.start_offset/end_offset` stop addressing `documents.content`, no
 * citation can ever highlight the right text again. Every test here asserts the
 * contract
 *
 *   content.slice(startOffset, endOffset) === chunk.content
 *
 * plus the properties `#67`/`#68` must preserve: dense indexing, block spans that
 * point back into real blocks, page ranges, overlap that shares exact bytes, and
 * headings that are never split.
 */

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const fixture = (name: string): string => join(FIXTURES, name)

interface Synthetic {
  content: string
  blocks: ChunkBlock[]
}

/** A small heading + paragraph document with hand-computed canonical offsets. */
function synthetic(): Synthetic {
  const heading1 = 'Overview'
  const paragraph1 = 'First paragraph sentence one. Sentence two.'
  const heading2 = 'Details'
  const paragraph2 = 'Second paragraph with more text.'
  const content = [heading1, paragraph1, heading2, paragraph2].join('\n\n')

  const make = (
    id: string,
    kind: BlockKind,
    level: number | null,
    text: string,
    page: number | null = null
  ): ChunkBlock => {
    const startOffset = content.indexOf(text)
    return { id, kind, level, page, text, startOffset, endOffset: startOffset + text.length }
  }

  return {
    content,
    blocks: [
      make('b1', 'heading', 1, heading1),
      make('b2', 'paragraph', null, paragraph1),
      make('b3', 'heading', 2, heading2),
      make('b4', 'paragraph', null, paragraph2)
    ]
  }
}

function assertCanonicalOffsets(content: string, chunks: ChunkResult[]): void {
  assert.deepEqual(
    chunks.map((chunk) => chunk.index),
    chunks.map((_, index) => index),
    'chunk index must be dense and ascending'
  )

  for (const chunk of chunks) {
    assert.equal(
      content.slice(chunk.startOffset, chunk.endOffset),
      chunk.content,
      `chunk ${chunk.index} does not slice back to documents.content`
    )
    assert.ok(chunk.tokenCount > 0, `chunk ${chunk.index} has no token estimate`)
  }
}

function assertSpansResolve(content: string, blocks: ChunkBlock[], chunks: ChunkResult[]): void {
  const order = new Map(blocks.map((block, index) => [block.id, index]))

  for (const chunk of chunks) {
    let previousOrder = -1

    for (const span of chunk.blockSpans) {
      const block = blocks.find((candidate) => candidate.id === span.blockId)
      assert.ok(block, `chunk ${chunk.index} references unknown block ${span.blockId}`)
      assert.ok(
        span.startInBlock >= 0 && span.endInBlock <= block.text.length,
        `chunk ${chunk.index} span for ${span.blockId} leaves the block`
      )
      assert.ok(span.endInBlock > span.startInBlock, 'span must not be empty')

      const spanText = content.slice(
        block.startOffset + span.startInBlock,
        block.startOffset + span.endInBlock
      )
      assert.ok(
        chunk.content.includes(spanText),
        `chunk ${chunk.index} content does not contain the text of ${span.blockId}`
      )

      const blockOrder = order.get(span.blockId)!
      assert.ok(blockOrder > previousOrder, 'block spans must follow document order')
      previousOrder = blockOrder
    }
  }
}

test('chunk offsets and content address the canonical document exactly', () => {
  const { content, blocks } = synthetic()
  const chunks = new ChunkingService().chunkBlocks(content, blocks, { chunkSize: 40 })

  assert.ok(chunks.length > 1, 'a small chunk size must produce several chunks')
  assertCanonicalOffsets(content, chunks)
  assertSpansResolve(content, blocks, chunks)
})

test('a heading block is never split, even when it forces a chunk boundary', () => {
  const { content, blocks } = synthetic()
  const chunks = new ChunkingService().chunkBlocks(content, blocks, {
    chunkSize: 20,
    chunkOverlap: 5
  })

  assertCanonicalOffsets(content, chunks)

  const headings = new Map(blocks.filter((b) => b.kind === 'heading').map((b) => [b.id, b]))
  let seen = 0

  for (const chunk of chunks) {
    for (const span of chunk.blockSpans) {
      const heading = headings.get(span.blockId)
      if (!heading) continue
      seen++
      assert.equal(span.startInBlock, 0, `chunk ${chunk.index} starts inside a heading`)
      assert.equal(
        span.endInBlock,
        heading.text.length,
        `chunk ${chunk.index} cut heading ${heading.id} short`
      )
    }
  }

  assert.ok(seen >= headings.size, 'every heading should be covered at least once')
})

test('overlapping chunks share identical bytes', () => {
  const { content, blocks } = synthetic()
  const chunks = new ChunkingService().chunkBlocks(content, blocks, {
    chunkSize: 30,
    chunkOverlap: 15
  })

  let overlaps = 0
  for (let i = 0; i < chunks.length - 1; i++) {
    const current = chunks[i]
    const next = chunks[i + 1]
    if (next.startOffset >= current.endOffset) continue

    overlaps++
    const fromCurrent = current.content.slice(next.startOffset - current.startOffset)
    const fromNext = next.content.slice(0, current.endOffset - next.startOffset)
    assert.equal(
      fromCurrent,
      fromNext,
      `chunk ${i} and ${i + 1} do not share the same overlap text`
    )
  }

  assert.ok(overlaps > 0, 'expected at least one overlapping chunk pair')
})

test('PDF chunks stay on one page and report the page range', async () => {
  const result = await new PdfLoader().loadFromPath(fixture('multipage.pdf'))
  const blocks = assignBlockIds(
    'doc_pdf',
    buildDocumentBlocks({ content: result.content, structure: result.structure })
  )
  const chunks = new ChunkingService().chunkBlocks(result.content, blocks)

  assertCanonicalOffsets(result.content, chunks)
  assertSpansResolve(result.content, blocks, chunks)

  assert.deepEqual(
    chunks.map((chunk) => [chunk.pageStart, chunk.pageEnd]),
    [
      [1, 1],
      [2, 2],
      [3, 3]
    ]
  )
})

test('cross-page chunks only appear when explicitly allowed', async () => {
  const result = await new PdfLoader().loadFromPath(fixture('multipage.pdf'))
  const blocks = assignBlockIds(
    'doc_pdf',
    buildDocumentBlocks({ content: result.content, structure: result.structure })
  )
  const service = new ChunkingService()

  const merged = service.chunkBlocks(result.content, blocks, { allowSpanPages: true })
  assert.equal(merged.length, 1, 'a large chunk size with allowSpanPages must merge the pages')
  assert.equal(merged[0].pageStart, 1)
  assert.equal(merged[0].pageEnd, 3)
  assertCanonicalOffsets(result.content, merged)
})

test('indexing test/fixtures/sample.pdf yields chunks that resolve to its blocks', async () => {
  const result = await new PdfLoader().loadFromPath(fixture('sample.pdf'))
  const blocks = assignBlockIds(
    'doc_sample',
    buildDocumentBlocks({ content: result.content, structure: result.structure })
  )
  const chunks = new ChunkingService().chunkBlocks(result.content, blocks)

  assert.ok(chunks.length >= 1)
  assertCanonicalOffsets(result.content, chunks)
  assertSpansResolve(result.content, blocks, chunks)

  // The single page is one block, so the chunk must resolve to exactly that page.
  for (const chunk of chunks) {
    assert.equal(chunk.pageStart, 1)
    assert.equal(chunk.pageEnd, 1)
  }
})

test('the char-window fallback also produces canonical offsets and overlap', () => {
  const content = Array.from({ length: 40 }, (_, i) => `Sentence number ${i}.`).join(' ')
  const chunks = new ChunkingService().chunk(content, { chunkSize: 120, chunkOverlap: 40 })

  assert.ok(chunks.length > 1)
  assertCanonicalOffsets(content, chunks)
  assert.ok(chunks.every((chunk) => chunk.blockSpans.length === 0))

  for (let i = 0; i < chunks.length - 1; i++) {
    const current = chunks[i]
    const next = chunks[i + 1]
    assert.ok(next.startOffset < current.endOffset, 'windows should overlap')
    assert.equal(
      current.content.slice(next.startOffset - current.startOffset),
      next.content.slice(0, current.endOffset - next.startOffset)
    )
  }
})

test('a chunk resolves to its ordered block spans', () => {
  const { content, blocks } = synthetic()
  const chunks = new ChunkingService().chunkBlocks(content, blocks)
  const chunk = chunks[0]

  assert.equal(chunk.blockSpans.length, blocks.length, 'the whole synthetic document is one chunk')

  // Build the rows in reverse to prove the projection sorts by document order.
  const rows: ChunkProvenanceRow[] = [...chunk.blockSpans].reverse().map((span) => {
    const order = blocks.findIndex((block) => block.id === span.blockId)
    const block = blocks[order]
    return {
      blockId: block.id,
      kind: block.kind,
      level: block.level,
      page: block.page,
      text: block.text,
      startOffset: block.startOffset,
      endOffset: block.endOffset,
      order,
      startInBlock: span.startInBlock,
      endInBlock: span.endInBlock
    }
  })

  const resolved = projectChunkProvenance(
    'chunk_1',
    'doc_synthetic',
    chunk.pageStart,
    chunk.pageEnd,
    rows
  )

  assert.equal(resolved.chunkId, 'chunk_1')
  assert.equal(resolved.documentId, 'doc_synthetic')
  assert.deepEqual(
    resolved.blocks.map((block) => block.blockId),
    blocks.map((block) => block.id)
  )
  assert.equal(resolved.blocks[0].text, blocks[0].text)
})

test('page_start/page_end equal the min/max page of the mapped blocks', async () => {
  const result = await new PdfLoader().loadFromPath(fixture('multipage.pdf'))
  const blocks = assignBlockIds(
    'doc_pdf',
    buildDocumentBlocks({ content: result.content, structure: result.structure })
  )
  const chunks = new ChunkingService().chunkBlocks(result.content, blocks)

  for (const chunk of chunks) {
    const pages = chunk.blockSpans
      .map((span) => blocks.find((block) => block.id === span.blockId)!.page)
      .filter((page): page is number => page !== null)

    assert.deepEqual(
      [chunk.pageStart, chunk.pageEnd],
      [Math.min(...pages), Math.max(...pages)],
      `chunk ${chunk.index} page range does not match its blocks`
    )
  }
})

test('no blocks and no text produces no chunks', () => {
  const service = new ChunkingService()
  assert.deepEqual(service.chunkBlocks('', []), [])
  assert.deepEqual(service.chunk('   \n\n  '), [])
})
