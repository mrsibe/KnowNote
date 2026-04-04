/**
 * FileParserService
 * 파일 파싱 서비스, Loader 패턴을 사용하여 다양한 문서 형식을 통합 처리
 */

import { extname } from 'path'
import Logger from '../../shared/utils/logger'
import { PdfLoader } from './loaders/PdfLoader'
import { MarkdownLoader } from './loaders/MarkdownLoader'
import { DocxLoader } from './loaders/DocxLoader'
import { PptLoader } from './loaders/PptLoader'
import { WebLoader } from './loaders/WebLoader'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions } from './loaders/types'

/**
 * 지원하는 파일 타입
 */
export type SupportedFileType =
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'pptx'
  | 'ppt'
  | 'txt'
  | 'md'
  | 'markdown'
  | 'text'

/**
 * 파일 파싱 서비스
 * PDF, Word, PowerPoint, Markdown, 순수 텍스트 지원
 */
export class FileParserService {
  private loaders: Map<string, IDocumentLoader>
  private allLoaders: IDocumentLoader[]

  constructor() {
    // 모든 Loader 초기화
    this.allLoaders = [
      new PdfLoader(),
      new MarkdownLoader(),
      new DocxLoader(),
      new PptLoader(),
      new WebLoader()
    ]

    // 확장자 및 MIME 타입으로 Loader 등록
    this.loaders = new Map()
    for (const loader of this.allLoaders) {
      // 확장자 등록
      for (const ext of loader.supportedExtensions) {
        this.loaders.set(ext.toLowerCase(), loader)
      }
      // MIME 타입 등록
      for (const mime of loader.supportedMimeTypes) {
        this.loaders.set(mime, loader)
      }
    }

    Logger.info('FileParserService', `Registered ${this.allLoaders.length} document loaders`)
  }

  /**
   * 파일 경로로 자동 형식 인식 및 파싱
   */
  async parseFile(filePath: string, options?: LoadOptions): Promise<DocumentLoadResult> {
    const ext = extname(filePath).toLowerCase().slice(1)
    const loader = this.getLoaderByExtension(ext)

    if (!loader) {
      throw new Error(`Unsupported file type: ${ext}`)
    }

    Logger.info('FileParserService', `Parsing file with ${loader.constructor.name}`)
    return await loader.loadFromPath(filePath, options)
  }

  /**
   * 파일 타입으로 Buffer 파싱
   */
  async parseBuffer(
    buffer: Buffer,
    fileType: SupportedFileType,
    options?: LoadOptions
  ): Promise<DocumentLoadResult> {
    const loader = this.getLoaderByExtension(fileType)

    if (!loader) {
      throw new Error(`Unsupported file type: ${fileType}`)
    }

    Logger.info('FileParserService', `Parsing buffer with ${loader.constructor.name}`)
    return await loader.loadFromBuffer(buffer, options)
  }

  /**
   * 순수 텍스트/Markdown 파싱
   */
  parseText(content: string, mimeType: string = 'text/plain'): DocumentLoadResult {
    return {
      content: content.trim(),
      mimeType,
      metadata: {
        lineCount: content.split('\n').length,
        characterCount: content.length
      }
    }
  }

  /**
   * 해당 파일 타입 지원 여부 확인
   */
  isSupported(fileType: string): boolean {
    return this.loaders.has(fileType.toLowerCase())
  }

  /**
   * MIME 타입으로 파일 타입 조회
   */
  getFileTypeFromMime(mimeType: string): SupportedFileType | null {
    const mimeMap: Record<string, SupportedFileType> = {
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'application/vnd.ms-powerpoint': 'ppt',
      'text/plain': 'txt',
      'text/markdown': 'md'
    }
    return mimeMap[mimeType] || null
  }

  /**
   * MIME 타입 조회
   */
  getMimeType(fileType: string): string {
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc: 'application/msword',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ppt: 'application/vnd.ms-powerpoint',
      txt: 'text/plain',
      text: 'text/plain',
      md: 'text/markdown',
      markdown: 'text/markdown'
    }
    return mimeMap[fileType.toLowerCase()] || 'application/octet-stream'
  }

  /**
   * 확장자로 Loader 조회
   */
  private getLoaderByExtension(ext: string): IDocumentLoader | undefined {
    // 순수 텍스트 특수 처리
    if (ext === 'txt' || ext === 'text') {
      return this.loaders.get('md') // MarkdownLoader로 순수 텍스트 처리
    }
    return this.loaders.get(ext.toLowerCase())
  }
}

// 타입 내보내기 (하위 호환성 유지)
export type { DocumentLoadResult as ParseResult, LoadOptions }
