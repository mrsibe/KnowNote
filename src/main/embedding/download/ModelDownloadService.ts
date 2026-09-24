/**
 * ModelDownloadService
 *
 * 编排内置本地模型的按需下载：可达性探测 → 磁盘空间检查 → 逐文件校验下载（Range 续传、
 * 重试、失败换源）→ 进度上报 → 取消清理。
 *
 * 触发点是用户第一次真正使用知识库的动作，而不是进程启动。
 */

import type { EmbeddingDownloadProgress, EmbeddingSourceInfo } from '../../../shared/types'
import {
  LOCAL_EMBEDDING_FILES,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_TOTAL_BYTES,
  buildResolveUrl
} from '../localModel'
import { ensureRevisionlessAliases, getModelFilePath, isModelInstalled } from '../ModelRegistry'
import { downloadFileWithResume, hasDiskSpace, probeSources } from './HttpDownloader'
import type { FetchLike } from './HttpDownloader'
import { EmbeddingDownloadError, classifyDownloadError } from './errors'

export interface ModelDownloadServiceOptions {
  /** userData/models */
  cacheDir: string
  /** 按顺序探测的下载源 */
  sources: readonly string[]
  fetchImpl?: FetchLike
  onProgress?: (progress: EmbeddingDownloadProgress) => void
}

const PROBE_TIMEOUT_MS = 8000

export class ModelDownloadService {
  private readonly cacheDir: string
  private readonly sources: readonly string[]
  private readonly fetchImpl?: FetchLike
  private readonly onProgress?: (progress: EmbeddingDownloadProgress) => void

  private abortController: AbortController | null = null

  constructor(options: ModelDownloadServiceOptions) {
    this.cacheDir = options.cacheDir
    this.sources = options.sources
    this.fetchImpl = options.fetchImpl
    this.onProgress = options.onProgress
  }

  isDownloading(): boolean {
    return this.abortController !== null
  }

  /**
   * 取消正在进行的下载；临时文件会被清理。
   */
  cancel(): void {
    this.abortController?.abort()
  }

  /**
   * 逐源探测可达性，返回全部可达源（按配置顺序）。
   */
  async probeAllSources(): Promise<EmbeddingSourceInfo[]> {
    const results: EmbeddingSourceInfo[] = []
    for (const url of this.sources) {
      const best = await probeSources(
        [url],
        (base) => buildResolveUrl(base, LOCAL_EMBEDDING_MODEL.revision, 'config.json'),
        {
          fetchImpl: this.fetchImpl,
          timeoutMs: PROBE_TIMEOUT_MS
        }
      )
      results.push({ url, reachable: best !== null })
    }
    return results
  }

  /**
   * 下载并校验全部清单文件。已安装时直接返回。
   */
  async downloadAll(): Promise<void> {
    if (await isModelInstalled(this.cacheDir)) {
      await ensureRevisionlessAliases(this.cacheDir)
      this.emit({
        phase: 'done',
        progress: 1,
        downloadedBytes: LOCAL_EMBEDDING_TOTAL_BYTES,
        totalBytes: LOCAL_EMBEDDING_TOTAL_BYTES
      })
      return
    }

    if (this.abortController) {
      throw new EmbeddingDownloadError(
        'UNKNOWN',
        'A download is already in progress',
        'Wait for the current download to finish or cancel it.'
      )
    }

    this.abortController = new AbortController()
    const signal = this.abortController.signal

    try {
      if (!(await hasDiskSpace(this.cacheDir, LOCAL_EMBEDDING_TOTAL_BYTES))) {
        throw new EmbeddingDownloadError(
          'DISK_FULL',
          'Not enough disk space to download the local search model (~140 MB)',
          'Free up disk space and retry the download.'
        )
      }

      this.emit({
        phase: 'probing',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: LOCAL_EMBEDDING_TOTAL_BYTES
      })

      const reachable = (await this.probeAllSources()).filter((source) => source.reachable)
      if (reachable.length === 0) {
        throw new EmbeddingDownloadError(
          'SOURCE_UNAVAILABLE',
          'No download source is reachable',
          'Import the model manually from a local folder, or configure a reachable source in Settings.'
        )
      }

      let completedBytes = 0

      for (let index = 0; index < LOCAL_EMBEDDING_FILES.length; index++) {
        const file = LOCAL_EMBEDDING_FILES[index]
        const targetPath = getModelFilePath(this.cacheDir, file.path)

        let lastError: EmbeddingDownloadError | null = null

        for (const source of reachable) {
          try {
            await downloadFileWithResume({
              getUrl: () => buildResolveUrl(source.url, LOCAL_EMBEDDING_MODEL.revision, file.path),
              targetPath,
              expectedSize: file.size,
              expectedSha256: file.sha256,
              signal,
              fetchImpl: this.fetchImpl,
              onProgress: (downloaded, total) => {
                const overallDownloaded = completedBytes + Math.min(downloaded, total)
                this.emit({
                  phase: 'downloading',
                  file: file.path,
                  fileIndex: index + 1,
                  fileCount: LOCAL_EMBEDDING_FILES.length,
                  fileProgress: total > 0 ? downloaded / total : 0,
                  progress: Math.min(overallDownloaded / LOCAL_EMBEDDING_TOTAL_BYTES, 1),
                  downloadedBytes: overallDownloaded,
                  totalBytes: LOCAL_EMBEDDING_TOTAL_BYTES
                })
              }
            })
            lastError = null
            break
          } catch (error) {
            lastError = classifyDownloadError(error)
            if (lastError.code === 'CANCELLED') {
              throw lastError
            }
          }
        }

        if (lastError) {
          throw lastError
        }

        completedBytes += file.size
      }

      // 探测步骤读不带 revision 的路径，补齐硬链接别名
      await ensureRevisionlessAliases(this.cacheDir)

      this.emit({
        phase: 'done',
        progress: 1,
        downloadedBytes: LOCAL_EMBEDDING_TOTAL_BYTES,
        totalBytes: LOCAL_EMBEDDING_TOTAL_BYTES
      })
    } catch (error) {
      const failure = classifyDownloadError(error)
      this.emit({
        phase: failure.code === 'CANCELLED' ? 'cancelled' : 'error',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: LOCAL_EMBEDDING_TOTAL_BYTES,
        errorCode: failure.code,
        message: failure.message,
        suggestion: failure.suggestion
      })
      throw failure
    } finally {
      this.abortController = null
    }
  }

  private emit(progress: EmbeddingDownloadProgress): void {
    this.onProgress?.(progress)
  }
}
