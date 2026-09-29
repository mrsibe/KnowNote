/**
 * IngestionQueue（#176）
 *
 * 导入不再是一条长 IPC：handler 先把文档登记成 `pending` 并返回，解析 / 分块 / 嵌入
 * 在这里排队后台执行，进度经 `knowledge:index-progress` 继续推进。
 *
 * 串行是有意的：本地 ONNX 只有一个 session，并发只会互相抢内存；而且一次导入的
 * 进度叙事只有一条线时用户才读得懂。
 */

import Logger from '../../../shared/utils/logger'

/** 一个排队中的索引任务。`run` 收到的是这个任务的进度回调。 */
export interface IngestionJob {
  documentId: string
  run: (onProgress: (stage: string, progress: number) => void) => Promise<void>
  onProgress?: (stage: string, progress: number) => void
}

export class IngestionQueue {
  private readonly jobs: IngestionJob[] = []
  /** 排队中或正在跑的 documentId；去重用，单看 jobs 会漏掉当前正在跑的那个。 */
  private readonly known = new Set<string>()
  private draining = false
  private idleResolvers: Array<() => void> = []

  /** 是否还有排队或正在跑的任务 */
  isBusy(): boolean {
    return this.draining || this.jobs.length > 0
  }

  /** 排入一个任务；重复 documentId 会被忽略，避免同一份来源被索引两次。 */
  enqueue(job: IngestionJob): void {
    if (this.known.has(job.documentId)) {
      return
    }
    this.known.add(job.documentId)
    this.jobs.push(job)
    void this.drain()
  }

  /** 队列清空后 resolve；测试与优雅退出用。 */
  whenIdle(): Promise<void> {
    if (!this.isBusy()) {
      return Promise.resolve()
    }
    return new Promise((resolve) => this.idleResolvers.push(resolve))
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true

    try {
      while (this.jobs.length > 0) {
        const job = this.jobs.shift()!
        try {
          await job.run((stage, progress) => job.onProgress?.(stage, progress))
        } catch (error) {
          // 失败已经写在 documents.status / ingestion run 上（#95）；队列继续跑下一个，
          // 不能让一份坏文件把整批导入卡死。
          Logger.error('IngestionQueue', `Background indexing failed for ${job.documentId}:`, error)
        } finally {
          this.known.delete(job.documentId)
        }
      }
    } finally {
      this.draining = false
      const resolvers = this.idleResolvers
      this.idleResolvers = []
      for (const resolve of resolvers) resolve()
    }
  }
}
