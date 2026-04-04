/**
 * DocxLoader
 * mammoth를 사용하여 Word 문서를 파싱하고 구조 정보 추출
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
import mammoth from 'mammoth'
import * as cheerio from 'cheerio'
import Logger from '../../../shared/utils/logger'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions, SectionInfo } from './types'

/**
 * Word 문서 로더
 * mammoth 기반, DOCX 및 DOC 지원
 */
export class DocxLoader implements IDocumentLoader {
  readonly supportedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ]
  readonly supportedExtensions = ['docx', 'doc']

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
      // 순수 텍스트 추출
      const textResult = await mammoth.extractRawText({ buffer })
      const content = textResult.value.trim()

      // 구조 정보 추출 (문서를 HTML로 변환한 후 제목 추출)
      let sections: SectionInfo[] | undefined
      let title: string | undefined

      if (opts.preserveStructure) {
        const htmlResult = await mammoth.convertToHtml({ buffer })
        const $ = cheerio.load(htmlResult.value)

        // 첫 번째 제목을 문서 제목으로 추출
        const firstH1 = $('h1').first().text().trim()
        title = firstH1 || undefined

        // 섹션 구조 추출
        sections = this.extractSectionsFromHtml($, content)
      }

      return {
        content,
        title,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        structure: sections
          ? {
              type: 'sections',
              sections
            }
          : undefined,
        metadata: {
          warnings: textResult.messages,
          characterCount: content.length,
          wordCount: content.split(/\s+/).length
        }
      }
    } catch (error) {
      Logger.error('DocxLoader', 'Failed to parse Word document:', error)
      throw new Error(`Failed to parse Word document: ${(error as Error).message}`)
    }
  }

  /**
   * HTML에서 섹션 구조 추출
   */
  private extractSectionsFromHtml($: cheerio.CheerioAPI, fullContent: string): SectionInfo[] {
    const sections: SectionInfo[] = []
    const headings = $('h1, h2, h3, h4, h5, h6').toArray()

    for (let i = 0; i < headings.length; i++) {
      const heading = $(headings[i])
      const tagName = heading.prop('tagName')?.toLowerCase()
      const level = tagName ? parseInt(tagName.charAt(1)) : 1
      const title = heading.text().trim()

      if (!title) continue

      // 전체 텍스트에서 제목 위치 찾기 시도
      const startOffset = fullContent.indexOf(title)
      if (startOffset === -1) continue

      // 다음 동일 레벨 또는 상위 레벨 제목까지의 내용 계산
      let endOffset = fullContent.length
      for (let j = i + 1; j < headings.length; j++) {
        const nextHeading = $(headings[j])
        const nextTagName = nextHeading.prop('tagName')?.toLowerCase()
        const nextLevel = nextTagName ? parseInt(nextTagName.charAt(1)) : 1

        if (nextLevel <= level) {
          const nextTitle = nextHeading.text().trim()
          const nextStart = fullContent.indexOf(nextTitle, startOffset + title.length)
          if (nextStart !== -1) {
            endOffset = nextStart
            break
          }
        }
      }

      const sectionContent = fullContent.substring(startOffset, endOffset).trim()

      sections.push({
        level,
        title,
        content: sectionContent,
        startOffset,
        endOffset
      })
    }

    // 계층 구조 구축
    return this.buildHierarchy(sections)
  }

  /**
   * 섹션 계층 구조 구축
   */
  private buildHierarchy(flatSections: SectionInfo[]): SectionInfo[] {
    const root: SectionInfo[] = []
    const stack: SectionInfo[] = []

    for (const section of flatSections) {
      // 현재 섹션 레벨보다 높은 노드 팝
      while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
        stack.pop()
      }

      if (stack.length === 0) {
        // 최상위 섹션
        root.push(section)
      } else {
        // 하위 섹션
        const parent = stack[stack.length - 1]
        if (!parent.children) {
          parent.children = []
        }
        parent.children.push(section)
      }

      stack.push(section)
    }

    return root
  }
}
