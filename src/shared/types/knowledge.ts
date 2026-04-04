/**
 * 지식 베이스 관련 타입 정의
 * Drizzle에서 추론된 데이터베이스 schema를 기반으로 타입 정의의 단일 소스를 보장
 */

import type { Document, Chunk } from '../../main/db/schema'

/**
 * 문서 타입 (Drizzle에서 추론된 타입을 직접 사용)
 */
export type KnowledgeDocument = Document

/**
 * 문서 청크 (Drizzle에서 추론된 타입을 직접 사용)
 */
export type KnowledgeChunk = Chunk

/**
 * 문서 타입 열거
 */
export type DocumentType = 'file' | 'note' | 'url' | 'text'

/**
 * 문서 상태 열거
 */
export type DocumentStatus = 'pending' | 'processing' | 'indexed' | 'failed'

/**
 * 검색 결과
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
 * 인덱싱 진행률
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
}
