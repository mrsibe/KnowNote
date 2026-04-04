/**
 * MarkdownLoader
 * remark/unified를 사용하여 Markdown 파싱, AST 구조 유지
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import { visit } from 'unist-util-visit'
import type { Root, Heading, Content } from 'mdast'
import Logger from '../../../shared/utils/logger'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions, SectionInfo } from './types'

/**
 * Markdown 문서 로더
 * unified/remark 기반 파싱, GFM 지원
 */
export class MarkdownLoader implements IDocumentLoader {
  readonly supportedMimeTypes = ['text/markdown']
  readonly supportedExtensions = ['md', 'markdown']

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
    const content = buffer.toString('utf-8')

    try {
      // Markdown AST 파싱
      // ESM/CommonJS 호환성 처리: 런타임에 정확한 함수 확인
      const remarkFn = typeof remark === 'function' ? remark : (remark as any).remark
      const remarkGfmPlugin =
        typeof remarkGfm === 'function' ? remarkGfm : (remarkGfm as any).default
      const processor = remarkFn().use(remarkGfmPlugin)
      const ast = processor.parse(content) as Root

      // 제목 추출
      const title = this.extractTitle(ast)

      // 섹션 구조 추출
      const sections = opts.preserveStructure ? this.extractSections(content, ast) : undefined

      return {
        content: content.trim(),
        title,
        mimeType: 'text/markdown',
        structure: sections
          ? {
              type: 'sections',
              sections
            }
          : undefined,
        metadata: {
          lineCount: content.split('\n').length,
          hasCodeBlocks: this.hasCodeBlocks(ast),
          hasTables: this.hasTables(ast)
        }
      }
    } catch (error) {
      Logger.error('MarkdownLoader', 'Failed to parse Markdown:', error)
      throw new Error(`Failed to parse Markdown: ${(error as Error).message}`)
    }
  }

  /**
   * 문서 제목 추출 (첫 번째 h1)
   */
  private extractTitle(ast: Root): string | undefined {
    let title: string | undefined

    visit(ast, 'heading', (node: Heading) => {
      if (!title && node.depth === 1) {
        title = this.nodeToText(node)
        return false // 순회 중지
      }
      return undefined // 순회 계속
    })

    return title
  }

  /**
   * 섹션 구조 추출
   */
  private extractSections(content: string, ast: Root): SectionInfo[] {
    const sections: SectionInfo[] = []
    const stack: { section: SectionInfo; level: number }[] = []

    visit(ast, (node) => {
      if (node.type === 'heading') {
        const heading = node as Heading
        const title = this.nodeToText(heading)
        const startOffset = node.position?.start.offset ?? 0
        const endOffset = node.position?.end.offset ?? startOffset

        const section: SectionInfo = {
          level: heading.depth,
          title,
          content: '',
          startOffset,
          endOffset,
          children: []
        }

        // 섹션 계층 유지
        while (stack.length > 0 && stack[stack.length - 1].level >= heading.depth) {
          stack.pop()
        }

        if (stack.length === 0) {
          sections.push(section)
        } else {
          stack[stack.length - 1].section.children!.push(section)
        }

        stack.push({ section, level: heading.depth })
      }
    })

    // 각 섹션의 내용 추출
    this.fillSectionContent(sections, content)

    return sections
  }

  /**
   * 섹션 내용 채우기
   */
  private fillSectionContent(sections: SectionInfo[], fullContent: string): void {
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]
      const nextSectionStart =
        i + 1 < sections.length ? sections[i + 1].startOffset : fullContent.length

      // 현재 제목부터 다음 동일 레벨 제목 사이의 내용 추출
      section.content = fullContent.substring(section.startOffset, nextSectionStart).trim()
      section.endOffset = nextSectionStart

      // 하위 섹션 재귀 처리
      if (section.children && section.children.length > 0) {
        this.fillSectionContent(section.children, section.content)
      }
    }
  }

  /**
   * AST 노드를 순수 텍스트로 변환
   */
  private nodeToText(node: Content | Heading): string {
    if ('value' in node && typeof node.value === 'string') {
      return node.value
    }
    if ('children' in node && Array.isArray(node.children)) {
      return node.children.map((child) => this.nodeToText(child)).join('')
    }
    return ''
  }

  /**
   * 코드 블록 존재 여부 확인
   */
  private hasCodeBlocks(ast: Root): boolean {
    let hasCode = false
    visit(ast, 'code', () => {
      hasCode = true
      return false
    })
    return hasCode
  }

  /**
   * 테이블 존재 여부 확인
   */
  private hasTables(ast: Root): boolean {
    let hasTable = false
    visit(ast, 'table', () => {
      hasTable = true
      return false
    })
    return hasTable
  }
}
