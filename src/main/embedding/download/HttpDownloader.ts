/**
 * HttpDownloader
 *
 * 自研下载器：transformers.js 自带的下载器不校验、不续传、不重试，而按需下载把部署
 * 问题变成了运行时网络问题，必须由我们控制。
 *
 * 能力：
 * - SHA256 校验 + 原子 rename，杜绝半截文件被当成有效缓存；
 * - HTTP Range 断点续传（服务端支持 206）；每次尝试都重新解析 resolve URL，以拿到
 *   未过期的 Xet 签名；
 * - 按文件重试 / 退避；
 * - 磁盘空间预检查；
 * - 进度回调，取消后清理临时文件。
 */

import { mkdir, open, rename, rm, stat, statfs } from 'fs/promises'
import { dirname } from 'path'
import { sha256File } from '../ModelRegistry'
import { EmbeddingDownloadError, classifyDownloadError } from './errors'

export type FetchLike = (
  input: string,
  init?: {
    headers?: Record<string, string>
    signal?: AbortSignal
  }
) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null
}>

export interface DownloadFileOptions {
  /** 每次尝试时重新求解的下载 URL（拿新的签名） */
  getUrl: () => string
  targetPath: string
  expectedSize: number
  expectedSha256: string
  signal?: AbortSignal
  onProgress?: (downloadedBytes: number, totalBytes: number) => void
  fetchImpl?: FetchLike
  maxAttempts?: number
  retryDelayMs?: number
}

async function existingPartialSize(path: string): Promise<number> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : 0
  } catch {
    return 0
  }
}

/**
 * 检查目标目录所在文件系统可用空间是否足够
 */
export async function hasDiskSpace(dir: string, requiredBytes: number): Promise<boolean> {
  try {
    const stats = await statfs(dir)
    const available = Number(stats.bavail) * Number(stats.bsize)
    return available >= requiredBytes
  } catch {
    // 查不到就放行，让真正的写入失败去报错
    return true
  }
}

/**
 * 下载一个文件到 targetPath，支持断点续传与校验。
 *
 * 临时文件是 `${targetPath}.part`；校验通过后原子 rename 到 targetPath。
 * 取消或校验失败都会删除临时文件，不污染缓存。
 */
export async function downloadFileWithResume(options: DownloadFileOptions): Promise<void> {
  const {
    getUrl,
    targetPath,
    expectedSize,
    expectedSha256,
    signal,
    onProgress,
    maxAttempts = 3,
    retryDelayMs = 1000
  } = options

  const fetchImpl = options.fetchImpl ?? fetch
  const partPath = `${targetPath}.part`

  await mkdir(dirname(targetPath), { recursive: true })

  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const downloaded = await attemptOnce({
        fetchImpl,
        getUrl,
        partPath,
        expectedSize,
        onProgress,
        signal
      })

      if (downloaded !== expectedSize) {
        throw new EmbeddingDownloadError(
          'CHECKSUM_MISMATCH',
          `File size mismatch for ${targetPath}: expected ${expectedSize}, got ${downloaded}`,
          'Retry the download.'
        )
      }

      const digest = await sha256File(partPath)
      if (digest !== expectedSha256) {
        await rm(partPath, { force: true })
        throw new EmbeddingDownloadError(
          'CHECKSUM_MISMATCH',
          `SHA256 mismatch for ${targetPath}`,
          'The downloaded file was corrupted or tampered with. Retry the download; if it keeps failing, import the model files manually.'
        )
      }

      await rm(targetPath, { force: true })
      await rename(partPath, targetPath)
      return
    } catch (error) {
      lastError = error
      const failure = classifyDownloadError(error)

      if (failure.code === 'CANCELLED') {
        await rm(partPath, { force: true })
        throw failure
      }

      // 校验失败说明内容不对，续传只会重复拿到坏数据；重来一次
      const retryable = failure.code !== 'DISK_FULL' && failure.code !== 'CHECKSUM_MISMATCH'
      if (!retryable || attempt >= maxAttempts) {
        await rm(partPath, { force: true })
        throw failure
      }

      await sleep(retryDelayMs * Math.pow(2, attempt - 1), signal)
    }
  }

  throw classifyDownloadError(lastError)
}

interface AttemptOptions {
  fetchImpl: FetchLike
  getUrl: () => string
  partPath: string
  expectedSize: number
  onProgress?: (downloadedBytes: number, totalBytes: number) => void
  signal?: AbortSignal
}

async function attemptOnce(options: AttemptOptions): Promise<number> {
  const { fetchImpl, getUrl, partPath, expectedSize, onProgress, signal } = options

  if (signal?.aborted) {
    throw new EmbeddingDownloadError('CANCELLED', 'Download cancelled', 'Download cancelled.')
  }

  const existing = await existingPartialSize(partPath)
  if (existing === expectedSize) {
    onProgress?.(existing, expectedSize)
    return existing
  }

  const headers: Record<string, string> = {}
  if (existing > 0) {
    // 每次续传都重新请求 resolve URL，拿新的签名（X-Amz-Expires=3600）
    headers.Range = `bytes=${existing}-`
  }

  const response = await fetchImpl(getUrl(), { headers, signal })

  if (response.status === 416) {
    // 服务端认为范围不合法：本地临时文件可能已经完整，交给上层校验
    return existing
  }

  if (response.status !== 200 && response.status !== 206) {
    throw new EmbeddingDownloadError(
      'HTTP_STATUS',
      `Download failed with HTTP ${response.status}`,
      'Retry, or switch to another download source.'
    )
  }

  if (!response.body) {
    throw new EmbeddingDownloadError(
      'HTTP_STATUS',
      'Download response has no body',
      'Retry, or switch to another download source.'
    )
  }

  // 服务端忽略了 Range 并从头发送，则重写临时文件
  const resumed = response.status === 206 && existing > 0
  let written = resumed ? existing : 0

  const handle = await open(partPath, resumed ? 'r+' : 'w')
  try {
    if (resumed) {
      await handle.truncate(written)
    }

    const reader = response.body.getReader()
    let position = written

    while (true) {
      if (signal?.aborted) {
        throw new EmbeddingDownloadError('CANCELLED', 'Download cancelled', 'Download cancelled.')
      }
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.length === 0) continue

      await handle.write(value, 0, value.length, position)
      position += value.length
      written = position
      onProgress?.(written, expectedSize)
    }

    await handle.sync()
  } finally {
    await handle.close()
  }

  return written
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new EmbeddingDownloadError('CANCELLED', 'Download cancelled', 'Download cancelled.'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 轻量可达性探测：对一个小文件发请求，按顺序选中第一个可用源。
 *
 * @returns 第一个可达的 base URL；全部不可达时返回 null。
 */
export async function probeSources(
  sources: readonly string[],
  probeUrl: (baseUrl: string) => string,
  options?: { fetchImpl?: FetchLike; timeoutMs?: number }
): Promise<string | null> {
  const fetchImpl = options?.fetchImpl ?? fetch

  for (const baseUrl of sources) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 8000)
    try {
      const response = await fetchImpl(probeUrl(baseUrl), { signal: controller.signal })
      if (response.ok || response.status === 206) {
        return baseUrl
      }
    } catch {
      // 该源不可达，试下一个
    } finally {
      clearTimeout(timer)
    }
  }

  return null
}

/**
 * 确保目录存在（供导入/落盘前调用）
 */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}
