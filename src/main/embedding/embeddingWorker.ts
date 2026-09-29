/**
 * embeddingWorker（#176）
 *
 * 本地 embedding 的 tokenize + ONNX 前向在 `worker_threads` 里跑，不在 Electron 主进程。
 * 主进程只负责发文本、收向量、转发进度；事件循环因此不再被一个 batch 的原生调用按住。
 *
 * 批次与进度都在这里：worker 收到整批文本后自己按 `batchSize` 切开，每完成一批回一次
 * `progress`。这样「批大小」只有一处定义，主进程不会把一本书一次性推给 ONNX。
 */

import { parentPort, workerData } from 'worker_threads'
import { LocalEmbeddingBackend } from './LocalEmbeddingBackend'
import Logger from '../../shared/utils/logger'
import type {
  EmbeddingWorkerInit,
  EmbeddingWorkerRequest,
  EmbeddingWorkerSnapshot
} from './embeddingWorkerProtocol'

if (!parentPort) {
  throw new Error('embeddingWorker must be started as a worker thread')
}

/** 非空断言集中在这里：上面的检查之后，闭包里用到的就是这个常量。 */
const port = parentPort

const init = workerData as EmbeddingWorkerInit

const backend = new LocalEmbeddingBackend({
  cacheDir: init.cacheDir,
  onLoadProgress: (progress) => port.postMessage({ type: 'load-progress', progress })
})

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

async function handleEmbed(
  id: number,
  texts: string[],
  purpose: 'query' | 'document'
): Promise<void> {
  const batches = chunk(texts, Math.max(1, init.batchSize))
  const results: EmbeddingWorkerSnapshot[] = []

  for (const batch of batches) {
    const batchResults = await embedBatchWithRetry(batch, purpose, id)
    for (const result of batchResults) {
      results.push({
        embedding: result.embedding,
        model: result.model,
        dimensions: result.dimensions
      })
    }
    port.postMessage({
      type: 'progress',
      id,
      completed: results.length,
      total: texts.length
    })
  }

  port.postMessage({ type: 'result', id, results })
}

/**
 * 逐 batch 重试（而不是整批重来）：一次 book-sized 导入里某个 batch 抖一下，不应该让
 * 已经算好的几百条向量白做。重试策略跟 EmbeddingService 的远程路径同源。
 */
async function embedBatchWithRetry(
  batch: string[],
  purpose: 'query' | 'document',
  id: number
): Promise<Array<{ embedding: Float32Array; model: string; dimensions: number }>> {
  let lastError: Error = new Error('Embedding failed')

  for (let attempt = 1; attempt <= Math.max(1, init.maxRetries); attempt++) {
    try {
      return await backend.embedBatch(batch, purpose)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      Logger.warn(
        'EmbeddingWorker',
        `attempt ${attempt} failed for request ${id}: ${lastError.message}`
      )
      if (attempt < Math.max(1, init.maxRetries)) {
        await new Promise((resolve) => setTimeout(resolve, init.retryDelay * 2 ** (attempt - 1)))
      }
    }
  }

  throw lastError
}

async function handle(message: EmbeddingWorkerRequest): Promise<void> {
  if (message.type === 'dispose') {
    await backend.dispose()
    port.postMessage({ type: 'disposed', id: message.id })
    return
  }

  try {
    await handleEmbed(message.id, message.texts, message.purpose)
  } catch (error) {
    port.postMessage({
      type: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

// 串行处理：ONNX session 不并发，排队也避免多个 inference 同时抢内存。
let queue: Promise<void> = Promise.resolve()
port.on('message', (message: EmbeddingWorkerRequest) => {
  queue = queue.then(() => handle(message)).catch(() => undefined)
})
