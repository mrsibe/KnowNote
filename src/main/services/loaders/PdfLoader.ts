/**
 * PdfLoader
 * 使用 pdfjs-dist 解析 PDF，提取文本和页码信息
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
// 使用 legacy build for Node.js 环境
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api'
import Logger from '../../../shared/utils/logger'
import type {
  IDocumentLoader,
  DocumentLoadResult,
  LoadOptions,
  PageInfo,
  NormalizedBox
} from './types'

/**
 * PDF 文档加载器
 * 基于 Mozilla 的 PDF.js（纯 JS 实现）
 */
export class PdfLoader implements IDocumentLoader {
  readonly supportedMimeTypes = ['application/pdf']
  readonly supportedExtensions = ['pdf']

  constructor() {
    // 配置 PDF.js worker（使用 legacy build）
    // 在 Electron/Node.js 环境中,需要使用 legacy 版本
    try {
      // 使用动态 import 代替 require
      import('pdfjs-dist/legacy/build/pdf.worker.mjs')
        .then((pdfjsWorker) => {
          if (pdfjsWorker) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker
          }
        })
        .catch(() => {
          Logger.warn('PdfLoader', 'Failed to load PDF.js worker, using inline mode')
        })
    } catch {
      // 如果加载 worker 失败，使用内联模式
      Logger.warn('PdfLoader', 'Failed to load PDF.js worker, using inline mode')
    }
  }

  canLoad(filePathOrMimeType: string): boolean {
    const lower = filePathOrMimeType.toLowerCase()
    return (
      this.supportedMimeTypes.includes(lower) ||
      this.supportedExtensions.includes(extname(lower).slice(1))
    )
  }

  async loadFromPath(filePath: string, options?: LoadOptions): Promise<DocumentLoadResult> {
    const buffer = await readFile(filePath)
    return this.loadFromBuffer(buffer, options)
  }

  async loadFromBuffer(buffer: Buffer, options?: LoadOptions): Promise<DocumentLoadResult> {
    const opts = { preserveStructure: true, ...options }

    try {
      // 加载 PDF 文档
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        password: opts.password
      })
      const pdfDoc: PDFDocumentProxy = await loadingTask.promise

      Logger.info('PdfLoader', `Loading PDF with ${pdfDoc.numPages} pages`)

      // 提取元数据
      const metadata = await pdfDoc.getMetadata().catch(() => null)
      const metadataInfo = metadata?.info as Record<string, unknown> | undefined
      const title = (metadataInfo?.Title as string) || undefined

      // 逐页提取文本
      const pages: PageInfo[] = []
      let fullText = ''
      let currentOffset = 0

      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum)
        const textContent = await page.getTextContent()
        const viewport = page.getViewport({ scale: 1.0 })

        // 提取页面文本
        const textItems = textContent.items.filter((item): item is TextItem => 'str' in item)
        const pageText = textItems.map((item) => item.str).join(' ')

        // 清理文本
        const cleanedText = this.cleanPDFText(pageText)
        const pageTextWithNewline = cleanedText + '\n\n'

        // 记录页面信息
        if (opts.preserveStructure) {
          pages.push({
            pageNumber: pageNum,
            content: cleanedText,
            startOffset: currentOffset,
            endOffset: currentOffset + cleanedText.length,
            bbox: this.computeNormalizedBBox(textItems, viewport),
            metadata: {
              width: viewport.width,
              height: viewport.height
            }
          })
        }

        fullText += pageTextWithNewline
        currentOffset += pageTextWithNewline.length

        // 释放页面资源
        page.cleanup()
      }

      // 清理文档
      await pdfDoc.cleanup()
      await pdfDoc.destroy()

      return {
        content: fullText.trim(),
        title,
        mimeType: 'application/pdf',
        structure: opts.preserveStructure
          ? {
              type: 'pages',
              pages
            }
          : undefined,
        metadata: {
          pageCount: pdfDoc.numPages,
          author: metadataInfo?.Author,
          creator: metadataInfo?.Creator,
          producer: metadataInfo?.Producer,
          creationDate: metadataInfo?.CreationDate,
          subject: metadataInfo?.Subject,
          keywords: metadataInfo?.Keywords
        }
      }
    } catch (error) {
      Logger.error('PdfLoader', 'Failed to parse PDF:', error)
      throw new Error(`Failed to parse PDF: ${(error as Error).message}`)
    }
  }

  /**
   * 把页面上所有文本项映射到页面空间,取并集后归一化到 0..1。
   *
   * 用 viewport.transform 把 PDF 用户空间（原点在左下）转成视口空间（原点在左上），
   * 这样渲染层不需要知道缩放比例。没有任何文本项时返回 undefined。
   */
  private computeNormalizedBBox(
    items: TextItem[],
    viewport: ReturnType<PDFPageProxy['getViewport']>
  ): NormalizedBox | undefined {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const item of items) {
      const textTransform = pdfjsLib.Util.transform(viewport.transform, item.transform)
      const fontHeight = Math.hypot(textTransform[2], textTransform[3])
      const left = textTransform[4]
      const right = left + Math.abs(item.width)
      const top = textTransform[5] - fontHeight
      const bottom = textTransform[5]

      minX = Math.min(minX, left, right)
      maxX = Math.max(maxX, left, right)
      minY = Math.min(minY, top, bottom)
      maxY = Math.max(maxY, top, bottom)
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return undefined

    const clamp = (value: number): number => Math.min(1, Math.max(0, value))
    const width = viewport.width || 1
    const height = viewport.height || 1

    return {
      x: clamp(minX / width),
      y: clamp(minY / height),
      w: clamp((maxX - minX) / width),
      h: clamp((maxY - minY) / height)
    }
  }

  /**
   * 清理 PDF 提取的文本
   */
  private cleanPDFText(text: string): string {
    return (
      text
        // 移除多余的空格
        .replace(/[ \t]+/g, ' ')
        // 修复断行（连续的行可能是同一段落）
        .replace(/([^\n])\n([^\n])/g, '$1 $2')
        // 统一多个换行为两个
        .replace(/\n{3,}/g, '\n\n')
        // 移除首尾空白
        .trim()
    )
  }
}
