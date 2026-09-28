/**
 * 知识库相关类型定义
 * 基于 Drizzle 推导的数据库 schema,确保类型定义的单一数据源
 */

import type { Document, Chunk } from '../../main/db/schema'

/**
 * 文档类型（直接使用 Drizzle 推导的类型）
 */
export type KnowledgeDocument = Document

/**
 * 文档分块（直接使用 Drizzle 推导的类型）
 */
export type KnowledgeChunk = Chunk

/**
 * 文档类型枚举
 */
export type DocumentType = 'file' | 'note' | 'url' | 'text'

/**
 * 文档状态枚举
 */
export type DocumentStatus = 'pending' | 'processing' | 'indexed' | 'failed'

/**
 * 搜索结果
 */
export interface KnowledgeSearchResult {
  chunkId: string
  documentId: string
  documentTitle: string
  documentType: string
  content: string
  score: number
  chunkIndex: number
  metadata?: Record<string, unknown>
  /**
   * 命中在来源里的位置（#96）：页码区间与块区间。运行时会随结果一起送达
   * （`KnowledgeService.search` / `searchText` 共用 `SearchResult`），搜索面板用它
   * 跳到命中的段落，而不是只打开文档。
   */
  locator?: {
    pageStart: number | null
    pageEnd: number | null
    blocks: Array<{
      blockId: string
      page: number | null
      startOffset: number
      endOffset: number
      startInBlock: number
      endInBlock: number
    }>
  }
}

/**
 * 索引进度
 */
export interface IndexProgress {
  notebookId?: string
  documentId?: string
  stage: string
  progress: number
}

/**
 * 知识库统计
 */
export interface KnowledgeStats {
  documentCount: number
  chunkCount: number
  embeddingCount: number
}

/**
 * 添加文档选项
 */
export interface AddDocumentOptions {
  title: string
  type: DocumentType
  content: string
  sourceUri?: string
  sourceNoteId?: string
  mimeType?: string
  fileSize?: number
  metadata?: Record<string, unknown>
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  topK?: number
  threshold?: number
  includeContent?: boolean
  /** 只在这些来源里检索（#94）；为空/缺省表示整个 notebook。 */
  documentIds?: string[]
}
