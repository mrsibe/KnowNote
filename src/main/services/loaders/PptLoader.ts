/**
 * PptLoader
 * officeparser를 사용하여 PPT 파싱, 페이지별 추출
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
import officeParser from 'officeparser'
import Logger from '../../../shared/utils/logger'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions, PageInfo } from './types'

/**
 * PowerPoint 문서 로더
 * officeparser 기반, PPTX 지원
 */
export class PptLoader implements IDocumentLoader {
  readonly supportedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint'
  ]
  readonly supportedExtensions = ['pptx', 'ppt']

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
      // officeparser로 텍스트 추출
      const text = await officeParser.parseOfficeAsync(buffer)
      const content = text.trim()

      // 시작 형식 기준으로 슬라이드 분할
      // officeparser는 페이지 구분을 직접 제공하지 않으므로 연속 줄 바꿈을 구분자로 사용
      const pages: PageInfo[] = []
      let currentOffset = 0

      if (opts.preserveStructure) {
        // 연속 3개 이상의 줄 바꿈으로 분할 (일반적으로 슬라이드 간의 구분)
        const slideTexts = content.split(/\n{3,}/)

        for (let i = 0; i < slideTexts.length; i++) {
          const slideText = slideTexts[i].trim()
          if (!slideText) continue

          const pageInfo: PageInfo = {
            pageNumber: i + 1,
            content: slideText,
            startOffset: currentOffset,
            endOffset: currentOffset + slideText.length
          }

          pages.push(pageInfo)
          currentOffset += slideText.length + 3 // +3 for separator
        }
      }

      // 제목 추출 (일반적으로 첫 페이지의 첫 줄)
      const firstLine = content.split('\n')[0]?.trim()
      const title = firstLine && firstLine.length < 100 ? firstLine : undefined

      return {
        content,
        title,
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        structure:
          pages.length > 0
            ? {
                type: 'pages',
                pages
              }
            : undefined,
        metadata: {
          slideCount: pages.length,
          characterCount: content.length
        }
      }
    } catch (error) {
      Logger.error('PptLoader', 'Failed to parse PPT:', error)
      throw new Error(`Failed to parse PPT: ${(error as Error).message}`)
    }
  }
}
