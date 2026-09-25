import type { Citation } from '../../shared/types/citation'
import type { AnswerSource } from '../../shared/types/chat'
import type { SearchResult } from './KnowledgeService'

/**
 * 检索 → 引用 的组装。
 *
 * 检索层（`RetrievedEvidence`）已经带着来源身份、页码区间和块区间；这里只把它
 * 投影成 prompt 与 `chat_messages.metadata` 用的形状，不再回查数据库。保持纯函数
 * 是刻意的 —— #70 的解析/校验也走同一份 `Citation`，两条路径必须能看到同样的
 * 定位信息。
 */

/** 一个检索结果 → 一条 citation。`index` 是它在 prompt 里的 1-based 位置。 */
export function citationFromSearchResult(result: SearchResult, index: number): Citation {
  const { blocks, pageStart, pageEnd } = result.locator
  const first = blocks[0]
  const last = blocks[blocks.length - 1]

  const citation: Citation = {
    index,
    documentId: result.documentId,
    documentTitle: result.documentTitle,
    chunkId: result.chunkId,
    quote: result.content,
    score: result.score
  }

  if (result.documentType) citation.documentType = result.documentType
  if (pageStart !== null) citation.page = pageStart
  if (pageEnd !== null) citation.pageEnd = pageEnd

  // A chunk can cover several blocks. The jump anchor is the first one; the
  // char span is the union of the blocks actually covered, which is what the
  // reader highlights.
  if (first && last) {
    citation.blockId = first.blockId
    citation.startOffset = first.startOffset + first.startInBlock
    citation.endOffset = last.startOffset + last.endInBlock
  }

  return citation
}

export function buildCitations(results: SearchResult[]): Citation[] {
  return results.map((result, index) => citationFromSearchResult(result, index + 1))
}

/** 检索结果在 prompt / 元数据里共用的「回答基于什么」视图。 */
export interface RAGContext {
  context: string
  sources: AnswerSource[]
  citations: Citation[]
}

/**
 * 构建 RAG 上下文 prompt，并把「这段回答基于哪些段落」一起交出来。
 *
 * 之前这里只取 `documentTitle` / `content` / `score` 三个字段，`chunkId`、
 * `documentId`、`chunkIndex` 全部被丢掉 —— 于是回答交付之后，界面上再也没有回到
 * 原文的路。prompt 文本保持原有结构，这里只是不再丢弃身份，并显式要求模型用
 * `[n]` 标注来源，让回答里的断言可以解析回 citation。
 */
export function buildRAGContext(searchResults: SearchResult[]): RAGContext {
  if (searchResults.length === 0) return { context: '', sources: [], citations: [] }

  const citations = buildCitations(searchResults)
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

  const contextParts = sources.map(
    (source) => `[来源 ${source.index}: ${source.documentTitle}]\n${source.content}`
  )

  const context = `以下是与用户问题相关的背景知识，请参考这些信息来回答：

${contextParts.join('\n\n---\n\n')}

请基于以上背景知识回答用户的问题。引用某个来源时，请在相应句子后使用 [n] 标注来源编号（n 为上面的来源编号，例如 [1]）。如果背景知识不足以回答问题，请说明并尽力提供有帮助的回答。`

  return { context, sources, citations }
}
