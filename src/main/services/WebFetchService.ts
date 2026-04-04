/**
 * WebFetchService
 * 웹 크롤링 서비스, 본문 추출 및 Markdown 변환 지원
 */

import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import Logger from '../../shared/utils/logger'

/**
 * 크롤링 결과
 */
export interface FetchResult {
  content: string // 추출된 텍스트 내용
  title?: string // 페이지 제목
  description?: string // 페이지 설명
  url: string // 원본 URL
  mimeType: string
  metadata?: Record<string, unknown>
}

/**
 * 크롤링 옵션
 */
export interface FetchOptions {
  timeout?: number // 타임아웃 (밀리초), 기본값 30000
  extractMainContent?: boolean // 주요 내용 추출 여부, 기본값 true
  convertToMarkdown?: boolean // Markdown으로 변환 여부, 기본값 true
  userAgent?: string // 사용자 정의 User-Agent
}

/**
 * 웹 크롤링 서비스
 */
export class WebFetchService {
  private turndown: TurndownService
  private defaultOptions: Required<FetchOptions> = {
    timeout: 30000,
    extractMainContent: true,
    convertToMarkdown: true,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }

  constructor() {
    // Turndown 설정
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    })

    // 불필요한 요소 제거
    this.turndown.remove(['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe'])
  }

  /**
   * 웹페이지 내용 크롤링
   */
  async fetchUrl(url: string, options?: FetchOptions): Promise<FetchResult> {
    const opts = { ...this.defaultOptions, ...options }

    try {
      // URL 유효성 검사
      const parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Only HTTP and HTTPS URLs are supported')
      }

      Logger.info('WebFetchService', `Fetching: ${url}`)

      // 타임아웃용 AbortController 생성
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), opts.timeout)

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': opts.userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
          },
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status} ${response.statusText}`)
        }

        const contentType = response.headers.get('content-type') || ''
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
          throw new Error(`Unsupported content type: ${contentType}`)
        }

        const html = await response.text()
        return this.parseHtml(html, url, opts)
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Request timeout after ${opts.timeout}ms`)
      }
      Logger.error('WebFetchService', 'Failed to fetch URL:', error)
      throw error
    }
  }

  /**
   * HTML 내용 파싱
   */
  parseHtml(html: string, url: string, options?: FetchOptions): FetchResult {
    const opts = { ...this.defaultOptions, ...options }
    const $ = cheerio.load(html)

    // 제목 추출
    const title = $('title').text().trim() || $('h1').first().text().trim()

    // 설명 추출
    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content')

    // 주요 내용 추출
    let content: string
    if (opts.extractMainContent) {
      content = this.extractMainContent($)
    } else {
      content = $('body').html() || ''
    }

    // Markdown으로 변환
    if (opts.convertToMarkdown) {
      content = this.htmlToMarkdown(content)
    } else {
      // 텍스트 직접 추출
      content = cheerio.load(content).text()
    }

    // 내용 정리
    content = this.cleanContent(content)

    return {
      content,
      title,
      description: description || undefined,
      url,
      mimeType: 'text/html',
      metadata: {
        originalLength: html.length
      }
    }
  }

  /**
   * 주요 내용 추출
   */
  private extractMainContent($: cheerio.CheerioAPI): string {
    // 불필요한 요소 제거
    $(
      'script, style, nav, footer, header, aside, iframe, noscript, ' +
        '.nav, .navigation, .menu, .sidebar, .footer, .header, .ad, .advertisement, ' +
        '.comments, .comment, .social, .share, .related, .recommend'
    ).remove()

    // 주요 내용 영역 찾기 시도
    const mainSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.article',
      '.post',
      '.content',
      '.entry-content',
      '.post-content',
      '.article-content',
      '#content',
      '#main-content'
    ]

    for (const selector of mainSelectors) {
      const element = $(selector).first()
      if (element.length && element.text().trim().length > 200) {
        return element.html() || ''
      }
    }

    // 찾지 못한 경우 body 사용
    return $('body').html() || ''
  }

  /**
   * HTML을 Markdown으로 변환
   */
  htmlToMarkdown(html: string): string {
    try {
      return this.turndown.turndown(html)
    } catch (error) {
      Logger.warn('WebFetchService', 'Failed to convert to Markdown, using plain text:', error)
      return cheerio.load(html).text()
    }
  }

  /**
   * 내용 정리
   */
  private cleanContent(content: string): string {
    return (
      content
        // 불필요한 빈 줄 제거
        .replace(/\n{3,}/g, '\n\n')
        // 줄 앞뒤 공백 제거
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        // 앞뒤 공백 제거
        .trim()
    )
  }

  /**
   * URL 유효성 검사
   */
  isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      return ['http:', 'https:'].includes(parsed.protocol)
    } catch {
      return false
    }
  }
}
