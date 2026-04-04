/**
 * PdfLoader
 * pdfjs-dist를 사용하여 PDF를 파싱하고 텍스트 및 페이지 정보 추출
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
// Node.js 환경용 legacy build 사용
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api'
import Logger from '../../../shared/utils/logger'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions, PageInfo } from './types'

/**
 * PDF 문서 로더
 * Mozilla의 PDF.js 기반 (순수 JS 구현)
 */
export class PdfLoader implements IDocumentLoader {
  readonly supportedMimeTypes = ['application/pdf']
  readonly supportedExtensions = ['pdf']

  constructor() {
    // PDF.js worker 설정 (legacy build 사용)
    // Electron/Node.js 환경에서는 legacy 버전을 사용해야 합니다
    try {
      // require 대신 동적 import 사용
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
      // worker 로드 실패 시 인라인 모드 사용
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
      // PDF 문서 로드
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        password: opts.password
      })
      const pdfDoc: PDFDocumentProxy = await loadingTask.promise

      Logger.info('PdfLoader', `Loading PDF with ${pdfDoc.numPages} pages`)

      // 메타데이터 추출
      const metadata = await pdfDoc.getMetadata().catch(() => null)
      const metadataInfo = metadata?.info as Record<string, unknown> | undefined
      const title = (metadataInfo?.Title as string) || undefined

      // 순차적으로 페이지별 텍스트 추출
      const pages: PageInfo[] = []
      let fullText = ''
      let currentOffset = 0

      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum)
        const textContent = await page.getTextContent()
        const viewport = page.getViewport({ scale: 1.0 })

        // 페이지 텍스트 추출
        const pageText = textContent.items
          .filter((item): item is TextItem => 'str' in item)
          .map((item) => item.str)
          .join(' ')

        // 텍스트 정리
        const cleanedText = this.cleanPDFText(pageText)
        const pageTextWithNewline = cleanedText + '\n\n'

        // 페이지 정보 기록
        if (opts.preserveStructure) {
          pages.push({
            pageNumber: pageNum,
            content: cleanedText,
            startOffset: currentOffset,
            endOffset: currentOffset + cleanedText.length,
            metadata: {
              width: viewport.width,
              height: viewport.height
            }
          })
        }

        fullText += pageTextWithNewline
        currentOffset += pageTextWithNewline.length

        // 페이지 리소스 해제
        page.cleanup()
      }

      // 문서 정리
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
   * PDF 추출 텍스트 정리
   */
  private cleanPDFText(text: string): string {
    return (
      text
        // 불필요한 공백 자동 제거
        .replace(/[ \t]+/g, ' ')
        // 잘못된 줄 바꿈 수정 (연속된 줄을 하나의 단락으로 연결)
        .replace(/([^\n])\n([^\n])/g, '$1 $2')
        // 여러 줄 바꿈을 두 개로 통합
        .replace(/\n{3,}/g, '\n\n')
        // 앞뒤 공백 자동 제거
        .trim()
    )
  }
}
