/**
 * WebLoader
 * @mozilla/readability를 사용하여 웹페이지 본문 지능형 추출
 */

import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import Logger from '../../../shared/utils/logger'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions, SectionInfo } from './types'

/**
 * 웹페이지 로더
 * Mozilla Readability (Firefox Reader View) 기반
 */
export class WebLoader implements IDocumentLoader {
  readonly supportedMimeTypes = ['text/html', 'application/xhtml+xml']
  readonly supportedExtensions = ['html', 'htm']

  private turndownService: TurndownService

  constructor() {
    // HTML을 Markdown으로 변환하는 서비스 초기화
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced'
    })
  }

  canLoad(filePathOrMimeType: string): boolean {
    const lower = filePathOrMimeType.toLowerCase()
    return (
      this.supportedMimeTypes.includes(lower) ||
      this.supportedExtensions.some((ext) => lower.endsWith(`.${ext}`))
    )
  }

  async loadFromPath(): Promise<DocumentLoadResult> {
    // 웹 콘텐츠는 일반적으로 파일 경로가 아닌 URL에서 로드합니다
    // 플레이스홀더 구현 제공
    throw new Error(
      'WebLoader.loadFromPath is not supported. Use loadFromBuffer with HTML content.'
    )
  }

  async loadFromBuffer(buffer: Buffer, options?: LoadOptions): Promise<DocumentLoadResult> {
    const opts = { preserveStructure: true, ...options }
    const html = buffer.toString('utf-8')

    try {
      // Readability를 사용하여 본문 지능형 추출
      const dom = new JSDOM(html, { url: 'https://example.com' })
      const reader = new Readability(dom.window.document)
      const article = reader.parse()

      if (!article) {
        // 폴백: cheerio를 사용하여 직접 추출
        Logger.warn('WebLoader', 'Readability failed, falling back to cheerio')
        return this.fallbackParse(html, opts)
      }

      // Markdown으로 변환
      const markdown = this.turndownService.turndown(article.content || '')

      // 섹션 구조 추출
      const sections = opts.preserveStructure
        ? this.extractSections(article.content || '')
        : undefined

      return {
        content: markdown.trim(),
        title: article.title || undefined,
        mimeType: 'text/html',
        structure: sections
          ? {
              type: 'sections',
              sections
            }
          : undefined,
        metadata: {
          excerpt: article.excerpt,
          byline: article.byline,
          siteName: article.siteName,
          length: article.length,
          publishedTime: article.publishedTime
        }
      }
    } catch (error) {
      Logger.error('WebLoader', 'Failed to parse web content:', error)
      throw new Error(`Failed to parse web content: ${(error as Error).message}`)
    }
  }

  /**
   * 폴백 파싱 (Readability 실패 시)
   */
  private fallbackParse(html: string, opts: LoadOptions): DocumentLoadResult {
    const $ = cheerio.load(html)

    // 푸터, 스타일 등 자동 제거
    $('script, style, nav, footer, aside').remove()

    // 메인 콘텐츠 영역 찾기 시도
    const mainContent =
      $('article').html() ||
      $('main').html() ||
      $('.content').html() ||
      $('#content').html() ||
      $('body').html() ||
      ''

    const markdown = this.turndownService.turndown(mainContent)

    // 제목 추출
    const title = $('title').text().trim() || $('h1').first().text().trim() || undefined

    // 섹션 추출
    const sections = opts.preserveStructure ? this.extractSections(mainContent) : undefined

    return {
      content: markdown.trim(),
      title,
      mimeType: 'text/html',
      structure: sections
        ? {
            type: 'sections',
            sections
          }
        : undefined,
      metadata: {
        fallback: true
      }
    }
  }

  /**
   * HTML에서 섹션 구조 추출
   */
  private extractSections(html: string): SectionInfo[] {
    const $ = cheerio.load(html)
    const sections: SectionInfo[] = []
    const headings = $('h1, h2, h3, h4, h5, h6').toArray()

    for (const heading of headings) {
      const $heading = $(heading)
      const tagName = $heading.prop('tagName')?.toLowerCase()
      const level = tagName ? parseInt(tagName.charAt(1)) : 1
      const title = $heading.text().trim()

      if (!title) continue

      // 제목 이후부터 다음 동일 레벨 또는 상위 레벨 제목까지의 내용 추출
      let contentHtml = ''
      let nextSibling = $heading.next()
      while (nextSibling.length) {
        const nextTag = nextSibling.prop('tagName')?.toLowerCase()
        if (nextTag && /^h[1-6]$/.test(nextTag)) {
          const nextLevel = parseInt(nextTag.charAt(1))
          if (nextLevel <= level) break
        }
        contentHtml += $.html(nextSibling)
        nextSibling = nextSibling.next()
      }

      const contentMarkdown = this.turndownService.turndown(contentHtml).trim()

      sections.push({
        level,
        title,
        content: contentMarkdown,
        startOffset: 0, // HTML에서는 정확한 위치 확인이 어려움
        endOffset: 0
      })
    }

    return this.buildHierarchy(sections)
  }

  /**
   * 섹션 계층 구조 구축
   */
  private buildHierarchy(flatSections: SectionInfo[]): SectionInfo[] {
    const root: SectionInfo[] = []
    const stack: SectionInfo[] = []

    for (const section of flatSections) {
      while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
        stack.pop()
      }

      if (stack.length === 0) {
        root.push(section)
      } else {
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
