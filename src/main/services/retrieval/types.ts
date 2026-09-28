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
 * 限制检索范围的过滤条件。
 *
 * `documentIds` 为空或缺省都表示「整个 notebook」。当前还没有后端实现预过滤，
 * 所以这个 seam 由 `assertFilterSupported()` 守着：被真正使用前拒绝，而不是静默
 * 忽略（实现落在 #94）。
 */
export interface RetrievalFilter {
  documentIds?: string[]
}

/**
 * 一次检索请求。
 *
 * 取代旧的 `(notebookId, query, options)` 位置参数：#94 的 scope、#77 的策略参数
 * 与 #157 要快照的 trace 都要挂在这一个对象上，而不是散落在调用点。
 */
export interface RetrievalRequest {
  notebookId: string
  query: string
  topK?: number
  threshold?: number
  filter?: RetrievalFilter
}

/**
 * 一次检索实际生效的参数。
 *
 * 它会随回答一起被快照（#157），因此必须由检索层产出、而不是调用方猜：
 * `strategy` 说明用的是哪条检索路径，`scope` 说明结果被限制在哪些来源。
 * `threshold` 缺省表示该策略没有阈值，不是「阈值等于 0」。
 */
export interface RetrievalTrace {
  strategy: string
  scope: { documentIds?: string[] }
  topK: number
  threshold?: number
  durationMs: number
}

/** 检索结果：证据 + 本次检索的可解释参数。 */
export interface RetrievalResult {
  evidence: RetrievedEvidence[]
  trace: RetrievalTrace
}

/**
 * 检索策略的稳定契约。当前只有 `DenseRetriever`；#77 的 BM25 / hybrid / reranker
 * 只要实现这个接口就能被 eval harness 直接度量与替换。
 */
export interface Retriever {
  search(request: RetrievalRequest): Promise<RetrievalResult>
}
