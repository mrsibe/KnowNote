/**
 * 下载错误分类。
 *
 * 从 #33 的教训：笼统的 "failed to embed" 让用户无法判断是没配模型、连不上、下到一半
 * 断了还是文件损坏。这里把网络/校验/磁盘错误分类，并附带首个可操作的建议。
 */

import type { EmbeddingErrorCode } from '../../../shared/types'

export interface EmbeddingFailure {
  code: EmbeddingErrorCode
  message: string
  suggestion: string
}

/**
 * 带分类信息的下载错误
 */
export class EmbeddingDownloadError extends Error {
  readonly code: EmbeddingErrorCode
  readonly suggestion: string

  constructor(code: EmbeddingErrorCode, message: string, suggestion: string) {
    super(message)
    this.name = 'EmbeddingDownloadError'
    this.code = code
    this.suggestion = suggestion
  }

  toFailure(): EmbeddingFailure {
    return { code: this.code, message: this.message, suggestion: this.suggestion }
  }
}

const SUGGESTIONS: Record<EmbeddingErrorCode, string> = {
  DNS_FAILURE:
    'Check your network connection or configure a different download source in Settings.',
  CONNECTION_REFUSED: 'The source refused the connection. Try another source or a proxy.',
  CONNECTION_TIMEOUT: 'The download timed out. Retry, or switch to a faster source.',
  HTTP_STATUS: 'The source returned an error. Retry, or switch to another download source.',
  CHECKSUM_MISMATCH:
    'The downloaded file was corrupted or tampered with. Retry the download; if it keeps failing, import the model files manually.',
  DISK_FULL: 'Free up disk space and retry the download.',
  CANCELLED: 'Download cancelled. You can start it again at any time.',
  SOURCE_UNAVAILABLE:
    'No download source is reachable. Import the model manually from a local folder.',
  UNKNOWN: 'Retry the download, or switch to another source in Settings.'
}

function collectErrorChain(error: unknown): Array<{ code?: string; message: string }> {
  const chain: Array<{ code?: string; message: string }> = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === 'object' && current !== null) {
      const record = current as { code?: unknown; message?: unknown; cause?: unknown }
      chain.push({
        code: typeof record.code === 'string' ? record.code : undefined,
        message: typeof record.message === 'string' ? record.message : String(current)
      })
      current = record.cause
    } else {
      chain.push({ message: String(current) })
      break
    }
  }
  return chain
}

/**
 * 把任意异常归一化成可分类、可操作的可下载错误。
 */
export function classifyDownloadError(error: unknown): EmbeddingDownloadError {
  if (error instanceof EmbeddingDownloadError) {
    return error
  }

  const chain = collectErrorChain(error)
  const codes = chain.map((entry) => entry.code ?? '')
  const text = chain
    .map((entry) => entry.message)
    .join(' | ')
    .toLowerCase()

  if (codes.includes('CANCELLED') || text.includes('aborted')) {
    return new EmbeddingDownloadError('CANCELLED', 'Download cancelled', SUGGESTIONS.CANCELLED)
  }
  if (codes.includes('ENOSPC') || text.includes('no space left') || text.includes('disk full')) {
    return new EmbeddingDownloadError(
      'DISK_FULL',
      'Not enough disk space to download the model',
      SUGGESTIONS.DISK_FULL
    )
  }
  if (
    codes.includes('ENOTFOUND') ||
    codes.includes('EAI_AGAIN') ||
    text.includes('getaddrinfo') ||
    text.includes('name or service not known') ||
    text.includes('dns')
  ) {
    return new EmbeddingDownloadError(
      'DNS_FAILURE',
      'Could not resolve the download source hostname',
      SUGGESTIONS.DNS_FAILURE
    )
  }
  if (codes.includes('ECONNREFUSED') || text.includes('connection refused')) {
    return new EmbeddingDownloadError(
      'CONNECTION_REFUSED',
      'The download source refused the connection',
      SUGGESTIONS.CONNECTION_REFUSED
    )
  }
  if (
    codes.includes('ETIMEDOUT') ||
    codes.includes('UND_ERR_CONNECT_TIMEOUT') ||
    codes.includes('UND_ERR_HEADERS_TIMEOUT') ||
    codes.includes('UND_ERR_BODY_TIMEOUT') ||
    text.includes('timeout') ||
    text.includes('timed out')
  ) {
    return new EmbeddingDownloadError(
      'CONNECTION_TIMEOUT',
      'The download timed out',
      SUGGESTIONS.CONNECTION_TIMEOUT
    )
  }
  if (
    codes.includes('ECONNRESET') ||
    codes.includes('EPIPE') ||
    text.includes('socket hang up') ||
    text.includes('terminated') ||
    text.includes('fetch failed')
  ) {
    return new EmbeddingDownloadError(
      'CONNECTION_TIMEOUT',
      'The connection dropped during the download',
      SUGGESTIONS.CONNECTION_TIMEOUT
    )
  }

  return new EmbeddingDownloadError(
    'UNKNOWN',
    chain[0]?.message || 'The download failed',
    SUGGESTIONS.UNKNOWN
  )
}
