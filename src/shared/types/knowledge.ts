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
