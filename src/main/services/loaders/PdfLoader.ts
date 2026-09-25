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
import { layoutPageText, type PositionedTextItem } from './pdfTextLayout'
import type {
  IDocumentLoader,
  DocumentLoadResult,
  LoadOptions,
  PageBlockInfo,
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
      //
      // 这里刻意不建 AnnotationLayer，也不导入 `pdfjs-dist/web/*`（#121 / GHSA-hq66-cqwq-w95j）。
      // 真正执行文档内 JS 的 `PDFScriptingManager` 只在 viewer build 里，而 `enableScripting`
      // 也不在 `getDocument` 的参数里 —— 它在 AnnotationLayer / viewer 上。所以这条 API 路径
      // **在当前检查过的调用点下漏洞路径不可达**，而这个前提由
      // `test/pdfjsScriptingBoundary.test.ts` 守着：一旦有人把 annotation layer 或 viewer
      // 拉进来，那个测试会失败。
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

        // 把文本项按几何位置还原成页内段落，引用才能落到"第 12 页右下角那一段"
        const textItems = textContent.items.filter((item): item is TextItem => 'str' in item)
        const paragraphs = layoutPageText(
          this.toPositionedItems(textItems, viewport),
          viewport.width,
          viewport.height
        )

        // 页内容由段落拼出，段落偏移随后锚定到这份规范字符串上
        const pageContent = paragraphs.map((paragraph) => paragraph.text).join('\n\n')
        const pageBlocks: PageBlockInfo[] = []
        let pageCursor = 0
        for (const paragraph of paragraphs) {
          const startOffset = currentOffset + pageCursor
          pageBlocks.push({
            text: paragraph.text,
            startOffset,
            endOffset: startOffset + paragraph.text.length,
            bbox: paragraph.bbox
          })
          pageCursor += paragraph.text.length + 2 // '\n\n'
        }

        // 记录页面信息
        if (opts.preserveStructure) {
          pages.push({
            pageNumber: pageNum,
            content: pageContent,
            startOffset: currentOffset,
            endOffset: currentOffset + pageContent.length,
            bbox: this.unionBBox(paragraphs.map((paragraph) => paragraph.bbox)),
            blocks: pageBlocks,
            metadata: {
              width: viewport.width,
              height: viewport.height
            }
          })
        }

        const pageTextWithNewline = pageContent + '\n\n'
        fullText += pageTextWithNewline
        currentOffset += pageTextWithNewline.length

        // 释放页面资源
        page.cleanup()
      }

      // 清理文档
      //
      // `destroy()` 在 pdfjs-dist 6.x 从 `PDFDocumentProxy` 移到了
      // `PDFDocumentLoadingTask`（doc 上只剩 `cleanup()`），所以这里销毁的是 loading task。
      await pdfDoc.cleanup()
      await loadingTask.destroy()

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
   * 把 pdf.js 的文本项转换到视口坐标（原点左上，y 向下）。渲染层因此不需要知道缩放。
   */
  private toPositionedItems(
    items: TextItem[],
    viewport: ReturnType<PDFPageProxy['getViewport']>
  ): PositionedTextItem[] {
    const positioned: PositionedTextItem[] = []

    for (const item of items) {
      if (!item.str) continue

      const textTransform = pdfjsLib.Util.transform(viewport.transform, item.transform)
      const fontHeight = Math.hypot(textTransform[2], textTransform[3])

      positioned.push({
        str: item.str,
        left: textTransform[4],
        baseline: textTransform[5],
        width: Math.abs(item.width),
        height: fontHeight > 0 ? fontHeight : 1
      })
    }

    return positioned
  }

  /** 多个归一化包围盒的并集（页面 bbox）。没有有效盒时返回 undefined。 */
  private unionBBox(boxes: NormalizedBox[]): NormalizedBox | undefined {
    if (boxes.length === 0) return undefined

    const left = Math.min(...boxes.map((box) => box.x))
    const top = Math.min(...boxes.map((box) => box.y))
    const right = Math.max(...boxes.map((box) => box.x + box.w))
    const bottom = Math.max(...boxes.map((box) => box.y + box.h))

    return { x: left, y: top, w: right - left, h: bottom - top }
  }
}
