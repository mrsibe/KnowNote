import type { Citation, CitationCandidate, CitationContext } from '../../shared/types/citation'
import type { AnswerSource } from '../../shared/types/chat'
import type { SearchResult } from './KnowledgeService'
import { buildCitationCandidates } from './citationCandidates'

/**
 * 检索 → 引用 的组装。
 *
 * 检索层（`RetrievedEvidence` / `SearchResult`）已经带着来源身份、页码区间和块区间；
 * 这里把它切成 **citation candidates**（#155），再把 candidate 投影成 prompt 与
 * `chat_messages.metadata` 用的形状，不再回查数据库。
 *
 * 关键变化：citation 指向的粒度从「整个 chunk」变成「chunk 内的一段原文」。
 * `[n]` 仍然存在、仍然是 `Citation.index`，只是它现在标的是 candidate，而不再标
 * 检索命中的 chunk —— 用户可见的引用协议没有变，变的是它背后的证据精度。
 *
 * candidate 编号是一次回答内的临时命名空间（1..M），不是数据库级 id。真正稳定的
 * 定位是 `documentId` / `chunkId` / `blockId` / `startOffset` / `endOffset` / `quote`。
 */

/** 一个 citation candidate + 它来自的检索结果 → 一条 Citation。 */
export function citationFromCandidate(
  candidate: CitationCandidate,
  source: SearchResult
): Citation {
  const citation: Citation = {
    index: candidate.index,
    documentId: candidate.documentId,
    documentTitle: source.documentTitle,
    chunkId: candidate.chunkId,
    quote: candidate.quote,
    score: source.score
  }

  if (source.documentType) citation.documentType = source.documentType
  if (candidate.page !== undefined) citation.page = candidate.page
  if (candidate.blockId) citation.blockId = candidate.blockId
  if (candidate.startOffset !== undefined) citation.startOffset = candidate.startOffset
  if (candidate.endOffset !== undefined) citation.endOffset = candidate.endOffset

  return citation
}

/** 检索结果在 prompt / 元数据里共用的「回答基于什么」视图。 */
export interface RAGContext {
  context: string
  sources: AnswerSource[]
  citations: Citation[]
  citationContexts: CitationContext[]
}

/** `[来源: Attention Is All You Need — p.7]`；不分页的来源不带页码。 */
function sourceHeader(result: SearchResult): string {
  const page = result.locator.pageStart
  const suffix = typeof page === 'number' ? ` — p.${page}` : ''
  return `[来源: ${result.documentTitle}${suffix}]`
}

/**
 * 构建 RAG 上下文 prompt，并交出「这次回答引用了哪些原文片段」。
 *
 * prompt 按来源/chunk 分组展示，但 marker 全局连续：可读性来自分组，解析协议仍然
 * 只有一套 `[n]`。每个 candidate 的 `quote` 就是它自己的 span，因此模型引用
 * `[n]` 时，对应的 `startOffset`/`endOffset`/`blockId`/`page` 早已确定 —— 不需要
 * 回答之后再猜哪句话支持了哪个断言。
 */
export function buildRAGContext(searchResults: SearchResult[]): RAGContext {
  if (searchResults.length === 0) {
    return { context: '', sources: [], citations: [], citationContexts: [] }
  }

  const candidates = buildCitationCandidates(searchResults)

  // 一个 chunk 的 candidates 在全局编号里是连续的，按 chunk 归组只影响 prompt 的
  // 呈现顺序，不影响编号。
  const candidatesByChunk = new Map<string, CitationCandidate[]>()
  for (const candidate of candidates) {
    const list = candidatesByChunk.get(candidate.chunkId)
    if (list) list.push(candidate)
    else candidatesByChunk.set(candidate.chunkId, [candidate])
  }

  const citations: Citation[] = []
  const citationContexts: CitationContext[] = []
  const promptParts: string[] = []

  for (const result of searchResults) {
    const chunkCandidates = candidatesByChunk.get(result.chunkId)
    if (!chunkCandidates || chunkCandidates.length === 0) continue

    promptParts.push(
      [sourceHeader(result), ...chunkCandidates.map((c) => `[${c.index}] ${c.quote}`)].join('\n')
    )

    for (const candidate of chunkCandidates) {
      const citation = citationFromCandidate(candidate, result)
      citations.push(citation)
      // candidate.quote 就是它自己的 span，所以这里不需要再回查块文本来校验引文。
      citationContexts.push({ citation, spanText: candidate.quote })
    }
  }

  const sources: AnswerSource[] = searchResults.map((result, index) => ({
    index: index + 1,
    documentId: result.documentId,
    documentTitle: result.documentTitle,
    documentType: result.documentType,
    chunkId: result.chunkId,
    chunkIndex: result.chunkIndex,
    content: result.content,
    score: result.score
  }))

  const context = `以下是与用户问题相关的资料片段，每条片段都有一个编号。请参考这些片段来回答：

${promptParts.join('\n\n---\n\n')}

请基于以上片段回答用户的问题。引用某一个片段时，请在该句子后使用 [n] 标注片段编号（n 为上面的编号，例如 [1]）。如果这些片段不足以回答问题，请说明并尽力提供有帮助的回答。`

  return { context, sources, citations, citationContexts }
}
