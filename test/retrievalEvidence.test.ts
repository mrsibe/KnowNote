import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assembleEvidence,
  type EvidenceChunk,
  type EvidenceDocument
} from '../src/main/services/retrieval/evidence.ts'
import type { ChunkProvenance } from '../src/main/services/chunkProvenance.ts'

/**
 * `RetrievedEvidence` is the seam between retrieval and citations (#74): the
 * retriever has to hand over provenance, not just the chunk text, or #69 cannot
 * build a citation without querying the database again.
 *
 * `assembleEvidence()` is the pure step that attaches it. `hydrateEvidence()`
 * only adds the batch queries around it; the shape asserted here is what every
 * retriever strategy must produce.
 */

const hit = { chunkId: 'chunk_1', score: 0.87 }
const chunk: EvidenceChunk = {
  documentId: 'doc_1',
  content: 'the extracted passage',
  chunkIndex: 4
}
const document: EvidenceDocument = { title: 'Attention Is All You Need', type: 'file' }

const provenance: ChunkProvenance = {
  chunkId: 'chunk_1',
  documentId: 'doc_1',
  pageStart: 12,
  pageEnd: 12,
  blocks: [
    {
      blockId: 'blk_doc_1_7',
      kind: 'paragraph',
      level: null,
      page: 12,
      text: 'the extracted passage',
      startOffset: 100,
      endOffset: 121,
      startInBlock: 0,
      endInBlock: 21
    }
  ]
}

test('evidence carries score, source and locator together', () => {
  const evidence = assembleEvidence(hit, chunk, document, provenance)

  assert.deepEqual(evidence, {
    chunkId: 'chunk_1',
    documentId: 'doc_1',
    content: 'the extracted passage',
    score: 0.87,
    chunkIndex: 4,
    source: { title: 'Attention Is All You Need', type: 'file' },
    locator: {
      pageStart: 12,
      pageEnd: 12,
      blocks: provenance.blocks
    },
    metadata: undefined
  })
})

test('a chunk without a provenance row still produces a valid locator', () => {
  const evidence = assembleEvidence(hit, chunk, document, undefined)

  assert.deepEqual(evidence.locator, { pageStart: null, pageEnd: null, blocks: [] })
})

test('chunk metadata survives the mapping', () => {
  const evidence = assembleEvidence(
    hit,
    { ...chunk, metadata: { source: 'legacy' } },
    document,
    provenance
  )
  assert.deepEqual(evidence.metadata, { source: 'legacy' })
})

test('the locator keeps block spans in the order provenance resolved them', () => {
  const evidence = assembleEvidence(hit, chunk, document, {
    ...provenance,
    blocks: [provenance.blocks[0], { ...provenance.blocks[0], blockId: 'b2' }]
  })
  assert.deepEqual(
    evidence.locator.blocks.map((block) => block.blockId),
    ['blk_doc_1_7', 'b2']
  )
})
