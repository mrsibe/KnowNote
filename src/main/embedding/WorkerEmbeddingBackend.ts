/**
 * WorkerEmbeddingBackend（#176）
 *
 * `EmbeddingBackend` 的本地实现，但推理不在主线程：它把文本交给 `embeddingWorker`
 * 线程，ONNX 的 tokenize + 前向在那里跑。主进程事件循环只剩消息收发。
 *
 * 批次与进度由 worker 负责（见 embeddingWorkerProtocol.ts），所以这个后端声明
 * `batchesInternally = true`，EmbeddingService 不会在外面再切一遍。
 */

import { Worker } from 'worker_threads'
import { join } from 'path'
import type { EmbeddingPurpose, EmbeddingSpace } from '../../shared/types'
import Logger from '../../shared/utils/logger'
import { getLocalSpace } from './space'
import type { BackendEmbeddingResult, EmbeddingBackend } from './types'
import type {
  EmbeddingWorkerInit,
  EmbeddingWorkerResponse,
  EmbeddingWorkerSnapshot
} from './embeddingWorkerProtocol'

export interface WorkerEmbeddingBackendOptions {
  /** userData/models */
  cacheDir: string
  /** 一次 ONNX 前向的文本数 */
  batchSize: number
  /** 单个 batch 失败后的重试上限（worker 内部执行） */
  maxRetries?: number
  /** 重试基础退避（毫秒） */
  retryDelay?: number
  /** 覆盖 worker 入口，测试注入用 */
  workerPath?: string
  /** pipeline 首次加载进度（0-1） */
  onLoadProgress?: (progress: number) => void
}

interface PendingRequest {
  resolve: (results: BackendEmbeddingResult[]) => void
  reject: (error: Error) => void
  onProgress?: (completed: number, total: number) => void
}

export class WorkerEmbeddingBackend implements EmbeddingBackend {
  readonly kind = 'local' as const
  /** 批处理在 worker 内完成，外层不要再切 */
  readonly batchesInternally = true

  private readonly cacheDir: string
  private readonly batchSize: number
  private readonly maxRetries: number
  private readonly retryDelay: number
  private readonly explicitWorkerPath?: string
  private readonly onLoadProgress?: (progress: number) => void
  private readonly space: EmbeddingSpace = getLocalSpace()

  private worker: Worker | null = null
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingRequest>()

  constructor(options: WorkerEmbeddingBackendOptions) {
    this.cacheDir = options.cacheDir
    this.batchSize = Math.max(1, options.batchSize)
    this.maxRetries = Math.max(1, options.maxRetries ?? 3)
    this.retryDelay = options.retryDelay ?? 1000
    this.explicitWorkerPath = options.workerPath
    this.onLoadProgress = options.onLoadProgress
  }

  getSpace(): EmbeddingSpace {
    return this.space
  }

  async isReady(): Promise<boolean> {
    return this.worker !== null
  }

  async embed(text: string, purpose: EmbeddingPurpose): Promise<BackendEmbeddingResult> {
    const [result] = await this.embedBatch([text], purpose)
    return result
  }

  async embedBatch(
    texts: string[],
    purpose: EmbeddingPurpose,
    onProgress?: (completed: number, total: number) => void
  ): Promise<BackendEmbeddingResult[]> {
    if (texts.length === 0) {
      return []
    }

    const worker = this.ensureWorker()
    const id = this.nextRequestId++

    return await new Promise<BackendEmbeddingResult[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress })
      worker.postMessage({ type: 'embed', id, texts, purpose })
    })
  }

  /**
   * 结束 worker 线程并释放 ONNX session。之后再调用会重新拉起一个 worker。
   */
  async dispose(): Promise<void> {
    const worker = this.worker
    this.worker = null
    this.failPending(new Error('Embedding worker disposed'))

    if (!worker) return

    const disposed = new Promise<void>((resolve) => {
      worker.once('exit', () => resolve())
      worker.once('error', () => resolve())
    })
    try {
      worker.postMessage({ type: 'dispose', id: this.nextRequestId++ })
    } catch {
      // worker 已经不在了，terminate 兜底
    }
    worker.removeAllListeners('message')
    await Promise.race([disposed, worker.terminate().then(() => undefined)])
  }

  private resolveWorkerPath(): string {
    if (this.explicitWorkerPath) {
      return this.explicitWorkerPath
    }
    // 主进程 bundle 与 worker 产物同在 out/main（electron.vite.config.ts 的第二个入口）。
    return join(__dirname, 'embeddingWorker.js')
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker
    }

    const init: EmbeddingWorkerInit = {
      cacheDir: this.cacheDir,
      batchSize: this.batchSize,
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay
    }
    const worker = new Worker(this.resolveWorkerPath(), { workerData: init })

    worker.on('message', (message: EmbeddingWorkerResponse) => this.handleMessage(message))
    worker.on('error', (error) => {
      Logger.error('WorkerEmbeddingBackend', 'Embedding worker failed:', error)
      this.worker = null
      this.failPending(error instanceof Error ? error : new Error(String(error)))
    })
    worker.on('exit', (code) => {
      if (this.worker === worker) {
        this.worker = null
      }
      if (code !== 0) {
        this.failPending(new Error(`Embedding worker exited with code ${code}`))
      }
    })

    this.worker = worker
    return worker
  }

  private handleMessage(message: EmbeddingWorkerResponse): void {
    if (message.type === 'load-progress') {
      this.onLoadProgress?.(message.progress)
      return
    }

    const pending = this.pending.get(message.id)
    if (!pending) return

    if (message.type === 'progress') {
      pending.onProgress?.(message.completed, message.total)
      return
    }

    this.pending.delete(message.id)

    if (message.type === 'result') {
      pending.resolve(message.results.map(toBackendResult))
    } else if (message.type === 'error') {
      pending.reject(new Error(message.message))
    } else if (message.type === 'disposed') {
      // dispose 请求没有调用方等待；正常路径由 dispose() 自己结算
    }
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function toBackendResult(snapshot: EmbeddingWorkerSnapshot): BackendEmbeddingResult {
  return {
    embedding: snapshot.embedding,
    model: snapshot.model,
    dimensions: snapshot.dimensions
  }
}
