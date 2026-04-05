/**
 * ChunkingService
 * 지능형 문서 청킹 서비스, 의미적 완전성 유지
 */

import Logger from '../../shared/utils/logger'

/**
 * 청킹 옵션
 */
export interface ChunkOptions {
  chunkSize?: number // 각 청크의 목표 문자 수, 기본값 800
  chunkOverlap?: number // 청크 간 겹치는 문자 수, 기본값 100
  separators?: string[] // 구분자 우선순위 목록
  minChunkSize?: number // 최소 청크 크기, 기본값 100
}

/**
 * 청킹 결과
 */
export interface ChunkResult {
  content: string // 청크 내용
  index: number // 청크 인덱스
  startOffset: number // 원문 시작 위치
  endOffset: number // 원문 끝 위치
  tokenCount: number // 추정 토큰 수
}

/**
 * 문서 청킹 서비스
 * 지능형 청킹 지원, 의미적 완전성 유지
 */
export class ChunkingService {
  private defaultOptions: Required<ChunkOptions> = {
    chunkSize: 800,
    chunkOverlap: 100,
    minChunkSize: 100,
    separators: [
      '\n# ', // Markdown H1 헤더
      '\n## ', // Markdown H2 헤더
      '\n### ', // Markdown H3 헤더
      '\n\n\n', // 여러 빈 줄 (장 구분)
      '\n\n', // 단락 구분
      '\n', // 줄 구분
      '。', // 중국어 마침표
      '.', // 영어 마침표
      '！',
      '!',
      '？',
      '?',
      '；',
      ';',
      '，',
      ',',
      ' ' // 공백 (최후의 수단)
    ]
  }

  /**
   * 텍스트 청킹 수행
   */
  chunk(text: string, options?: ChunkOptions): ChunkResult[] {
    const opts = { ...this.defaultOptions, ...options }
    const { chunkSize, chunkOverlap, separators, minChunkSize } = opts

    // 전처리: 불필요한 공백 제거
    const cleanedText = this.preprocessText(text)

    if (!cleanedText || cleanedText.length === 0) {
      return []
    }

    // 텍스트가 최소 청크 크기보다 작으면 전체 텍스트를 바로 반환
    if (cleanedText.length <= minChunkSize) {
      return [
        {
          content: cleanedText,
          index: 0,
          startOffset: 0,
          endOffset: cleanedText.length,
          tokenCount: this.estimateTokens(cleanedText)
        }
      ]
    }

    const chunks: ChunkResult[] = []
    let currentStart = 0

    while (currentStart < cleanedText.length) {
      let currentEnd = Math.min(currentStart + chunkSize, cleanedText.length)

      // 텍스트 끝이 아니면 구분자에서 분리 시도
      if (currentEnd < cleanedText.length) {
        const searchEnd = currentEnd
        const searchStart = Math.max(currentStart + Math.floor(chunkSize * 0.5), currentStart)

        let bestSplitPos = -1
        let bestSeparatorPriority = separators.length

        // 범위 내에서 최적의 분할 지점 찾기
        for (let i = searchEnd; i >= searchStart; i--) {
          for (let j = 0; j < separators.length; j++) {
            const sep = separators[j]
            if (cleanedText.slice(i, i + sep.length) === sep) {
              if (j < bestSeparatorPriority) {
                bestSplitPos = i + sep.length
                bestSeparatorPriority = j
              }
              break
            }
          }
          // 높은 우선순위 구분자를 찾으면 중지
          if (bestSeparatorPriority <= 2) break
        }

        if (bestSplitPos > currentStart) {
          currentEnd = bestSplitPos
        }
      }

      const content = cleanedText.slice(currentStart, currentEnd).trim()

      if (content.length >= minChunkSize) {
        chunks.push({
          content,
          index: chunks.length,
          startOffset: currentStart,
          endOffset: currentEnd,
          tokenCount: this.estimateTokens(content)
        })
      }

      // 다음 청크의 시작 위치 계산 (겹침 고려)
      currentStart = Math.max(currentEnd - chunkOverlap, currentStart + 1)
    }

    Logger.debug('ChunkingService', `Split text into ${chunks.length} chunks`)
    return chunks
  }

  /**
   * 문장 단위 청킹 (더 보수적인 청킹 전략)
   */
  chunkBySentence(text: string, options?: ChunkOptions): ChunkResult[] {
    const opts = { ...this.defaultOptions, ...options }

    // 문장 분리
    const sentences = this.splitIntoSentences(text)
    const chunks: ChunkResult[] = []
    let currentChunk: string[] = []
    let currentLength = 0
    let currentStartOffset = 0

    for (const sentence of sentences) {
      const sentenceLength = sentence.length

      if (currentLength + sentenceLength > opts.chunkSize && currentChunk.length > 0) {
        // 현재 청크 저장
        const content = currentChunk.join('')
        chunks.push({
          content,
          index: chunks.length,
          startOffset: currentStartOffset,
          endOffset: currentStartOffset + content.length,
          tokenCount: this.estimateTokens(content)
        })

        // 새 청크 시작 (겹침 고려 가능)
        currentStartOffset += content.length
        currentChunk = []
        currentLength = 0
      }

      currentChunk.push(sentence)
      currentLength += sentenceLength
    }

    // 마지막 청크 처리
    if (currentChunk.length > 0) {
      const content = currentChunk.join('')
      chunks.push({
        content,
        index: chunks.length,
        startOffset: currentStartOffset,
        endOffset: currentStartOffset + content.length,
        tokenCount: this.estimateTokens(content)
      })
    }

    return chunks
  }

  /**
   * 텍스트 전처리
   */
  private preprocessText(text: string): string {
    return (
      text
        // 줄 바꿈 통일
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // 연속된 불필요한 빈 줄 제거 (최대 두 개의 줄 바꿈 유지)
        .replace(/\n{4,}/g, '\n\n\n')
        // 줄 앞뒤 공백 제거
        .trim()
    )
  }

  /**
   * 문장 분리
   */
  private splitIntoSentences(text: string): string[] {
    // 정규식으로 문장 종결 부호 매칭
    const sentenceEndings = /([。！？.!?]+)/g
    const parts = text.split(sentenceEndings)
    const sentences: string[] = []

    for (let i = 0; i < parts.length; i += 2) {
      const sentence = parts[i] + (parts[i + 1] || '')
      if (sentence.trim()) {
        sentences.push(sentence)
      }
    }

    return sentences
  }

  /**
   * 토큰 수 추정
   * 중국어/영어 혼합 텍스트의 경험적 공식 기반
   */
  estimateTokens(text: string): number {
    if (!text || text.length === 0) return 0

    let chineseChars = 0
    let otherChars = 0

    for (const char of text) {
      const code = char.charCodeAt(0)
      // CJK 통합 한자 및 확장
      if (
        (code >= 0x4e00 && code <= 0x9fff) || // CJK 기본
        (code >= 0x3400 && code <= 0x4dbf) || // CJK 확장 A
        (code >= 0xf900 && code <= 0xfaff) || // CJK 호환
        (code >= 0x3040 && code <= 0x309f) || // 히라가나
        (code >= 0x30a0 && code <= 0x30ff) || // 가타카나
        (code >= 0xac00 && code <= 0xd7af) // 한글
      ) {
        chineseChars++
      } else {
        otherChars++
      }
    }

    // 중국어 약 1.5 문자/토큰, 영어 약 4 문자/토큰
    return Math.ceil(chineseChars / 1.5 + otherChars / 4)
  }

  /**
   * 기본 옵션 업데이트
   */
  setDefaultOptions(options: Partial<ChunkOptions>): void {
    this.defaultOptions = { ...this.defaultOptions, ...options }
  }
}
