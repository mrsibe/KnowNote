/**
 * FileParserService
 * 文件解析服务，使用 Loader 模式统一处理各种文档格式
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
 * 支持的文件类型
 */
export type SupportedFileType =
  'pdf' | 'docx' | 'doc' | 'pptx' | 'ppt' | 'txt' | 'md' | 'markdown' | 'text'

/**
 * 文件解析服务
 * 支持 PDF、Word、PowerPoint、Markdown、纯文本
 */
export class FileParserService {
  private loaders: Map<string, IDocumentLoader>
  private allLoaders: IDocumentLoader[]

  constructor() {
    // 初始化所有 Loader
    this.allLoaders = [
      new PdfLoader(),
      new MarkdownLoader(),
      new DocxLoader(),
      new PptLoader(),
      new WebLoader()
    ]

    // 按扩展名和 MIME 类型注册 Loader
    this.loaders = new Map()
    for (const loader of this.allLoaders) {
      // 注册扩展名
      for (const ext of loader.supportedExtensions) {
        this.loaders.set(ext.toLowerCase(), loader)
      }
      // 注册 MIME 类型
      for (const mime of loader.supportedMimeTypes) {
        this.loaders.set(mime, loader)
      }
    }

    Logger.info('FileParserService', `Registered ${this.allLoaders.length} document loaders`)
  }

  /**
   * 根据文件路径自动识别格式并解析
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
   * 根据文件类型解析 Buffer
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
   * 解析纯文本/Markdown
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
   * 检查是否支持该文件类型
   */
  isSupported(fileType: string): boolean {
    return this.loaders.has(fileType.toLowerCase())
  }

  /**
   * 根据 MIME 类型获取文件类型
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
   * 获取 MIME 类型
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
   * 根据扩展名获取 Loader
   */
  private getLoaderByExtension(ext: string): IDocumentLoader | undefined {
    // 处理纯文本特殊情况
    if (ext === 'txt' || ext === 'text') {
      return this.loaders.get('md') // 使用 MarkdownLoader 处理纯文本
    }
    return this.loaders.get(ext.toLowerCase())
  }
}

// 导出类型（保持向后兼容）
export type { DocumentLoadResult as ParseResult, LoadOptions }
