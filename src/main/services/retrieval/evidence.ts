/**
 * evidence
 * 把一次检索的命中（chunkId + score）补齐成 `RetrievedEvidence[]`。
 *
 * 上层拿到的不再是裸 chunk：来源标题/类型、规范化页码区间和块区间都在这里一次补
 * 齐。补齐是批量的 —— 无论 topK 多大，SQL 查询次数恒定，不会形成 N+1。
 */

import { inArray } from 'drizzle-orm'
import { chunks, documents } from '../../db/schema'
import type { getDatabase } from '../../db'
import { resolveChunksProvenance, type ChunkProvenance } from '../chunkProvenance'
import type { RetrievedEvidence } from './types'

type Db = ReturnType<typeof getDatabase>

/** 一次向量检索的命中。 */
export interface EvidenceHit {
  chunkId: string
  score: number
}

/** 组装证据所需的最小 chunk / document 字段。 */
export interface EvidenceChunk {
  documentId: string
  content: string
  chunkIndex: number
  metadata?: Record<string, unknown> | null
}

export interface EvidenceDocument {
  title: string
  type: string
}

/**
 * 纯映射：命中 + chunk + 来源 + 来源结构 → 证据。便于单测，不碰数据库。
 */
export function assembleEvidence(
  hit: EvidenceHit,
  chunk: EvidenceChunk,
  document: EvidenceDocument,
  provenance: ChunkProvenance | undefined
): RetrievedEvidence {
  return {
    chunkId: hit.chunkId,
    documentId: chunk.documentId,
    content: chunk.content,
    score: hit.score,
    chunkIndex: chunk.chunkIndex,
    source: { title: document.title, type: document.type },
    locator: {
      pageStart: provenance?.pageStart ?? null,
      pageEnd: provenance?.pageEnd ?? null,
      blocks: provenance?.blocks ?? []
    },
    metadata: chunk.metadata ?? undefined
  }
}

/**
 * 批量补齐证据。保持 `hits` 的顺序（即向量库的相关性排序）；找不到 chunk 的命中被
 * 丢弃，而不是用占位符污染结果。
 */
export function hydrateEvidence(db: Db, hits: EvidenceHit[]): RetrievedEvidence[] {
  if (hits.length === 0) return []

  const chunkIds = hits.map((hit) => hit.chunkId)

  const chunkRows = db
    .select({
      id: chunks.id,
      documentId: chunks.documentId,
      content: chunks.content,
      chunkIndex: chunks.chunkIndex,
      metadata: chunks.metadata
    })
    .from(chunks)
    .where(inArray(chunks.id, chunkIds))
    .all()

  const documentIds = [...new Set(chunkRows.map((row) => row.documentId))]
  const documentRows =
    documentIds.length > 0
      ? db
          .select({ id: documents.id, title: documents.title, type: documents.type })
          .from(documents)
          .where(inArray(documents.id, documentIds))
          .all()
      : []

  const chunkMap = new Map(chunkRows.map((row) => [row.id, row]))
  const documentMap = new Map(documentRows.map((row) => [row.id, row]))
  const provenance = resolveChunksProvenance(db, chunkIds)

  const evidence: RetrievedEvidence[] = []
  for (const hit of hits) {
    const chunk = chunkMap.get(hit.chunkId)
    if (!chunk) continue

    const document = documentMap.get(chunk.documentId) ?? { title: 'Unknown', type: 'unknown' }
    evidence.push(assembleEvidence(hit, chunk, document, provenance.get(hit.chunkId)))
  }

  return evidence
}
