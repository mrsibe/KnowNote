/**
 * Retrieval contract
 *
 * 检索是一等能力，不是 Chat 的附属逻辑。Chat、MCP、Search 面板都通过同一个
 * `Retriever` 拿到同一份 `RetrievedEvidence`，因此不必各自重写一遍 RAG，也让
 * #75 的 eval harness 有一个稳定的入口。
 *
 * `RetrievedEvidence` 与 `SearchResult` 的关键区别是 provenance 是一等字段：引用
 * 要落到"哪个来源、哪一页、哪一段"，检索结果在交付给上层时就必须带着它。
 */

import type { ChunkProvenanceBlock } from '../chunkProvenance'

/** 检索结果覆盖的单个块（`chunk_blocks` 映射 + `document_blocks`）。 */
export type EvidenceBlock = ChunkProvenanceBlock

/** 证据在来源里的位置。`blocks` 按文档顺序排列。 */
export interface EvidenceLocator {
  pageStart: number | null
  pageEnd: number | null
  blocks: EvidenceBlock[]
}

/** 证据来自哪份来源。 */
export interface EvidenceSource {
  title: string
  type: string
}

/** 一条可供引用/展示的检索证据。 */
export interface RetrievedEvidence {
  chunkId: string
  documentId: string
  content: string
  score: number
  chunkIndex: number
  source: EvidenceSource
  locator: EvidenceLocator
  metadata?: Record<string, unknown>
}

/**
 * 检索选项。`includeContent` 不在这里：截断内容由 legacy `SearchResult` 映射决定，
 * 不是检索策略的事（策略应当总是返回真实内容）。
 */
export interface RetrieveOptions {
  topK?: number
  threshold?: number
}

/**
 * 检索策略的稳定契约。当前只有 `DenseRetriever`；#77 的 BM25 / hybrid / reranker
 * 只要实现这个接口就能被 eval harness 直接度量与替换。
 */
export interface Retriever {
  search(notebookId: string, query: string, options?: RetrieveOptions): Promise<RetrievedEvidence[]>
}
