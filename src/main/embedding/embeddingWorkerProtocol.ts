/**
 * embeddingWorker 的线程间协议（#176）。
 *
 * 主进程与服务层只通过这里定义的消息形状说话，worker 文件本身不导出实现细节。
 * 本地 ONNX 推理必须有这个边界：`LocalEmbeddingBackend` 的 tokenize + 前向是同步
 * 原生调用，跑在 Electron 主进程里会把事件循环按住，窗口拖拽、切页、输入全部跟着卡。
 */

import type { EmbeddingPurpose } from '../../shared/types'

/** worker 启动参数（workerData） */
export interface EmbeddingWorkerInit {
  /** userData/models */
  cacheDir: string
  /** 一次前向送进 pipeline 的文本数 */
  batchSize: number
  /** 单个 batch 失败后的重试上限（与 EmbeddingService 的远程路径一致） */
  maxRetries: number
  /** 重试基础退避（毫秒） */
  retryDelay: number
}

/** 一条文本的向量结果（structured-clone 可传） */
export interface EmbeddingWorkerSnapshot {
  embedding: Float32Array
  model: string
  dimensions: number
}

export interface EmbeddingWorkerEmbedRequest {
  type: 'embed'
  id: number
  texts: string[]
  purpose: EmbeddingPurpose
}

export interface EmbeddingWorkerDisposeRequest {
  type: 'dispose'
  id: number
}

export type EmbeddingWorkerRequest = EmbeddingWorkerEmbedRequest | EmbeddingWorkerDisposeRequest

export interface EmbeddingWorkerProgressResponse {
  type: 'progress'
  id: number
  completed: number
  total: number
}

/** pipeline 首次加载进度（0-1），与下载进度分开 */
export interface EmbeddingWorkerLoadProgressResponse {
  type: 'load-progress'
  progress: number
}

export interface EmbeddingWorkerResultResponse {
  type: 'result'
  id: number
  results: EmbeddingWorkerSnapshot[]
}

export interface EmbeddingWorkerErrorResponse {
  type: 'error'
  id: number
  message: string
}

export interface EmbeddingWorkerDisposedResponse {
  type: 'disposed'
  id: number
}

export type EmbeddingWorkerResponse =
  | EmbeddingWorkerProgressResponse
  | EmbeddingWorkerLoadProgressResponse
  | EmbeddingWorkerResultResponse
  | EmbeddingWorkerErrorResponse
  | EmbeddingWorkerDisposedResponse
