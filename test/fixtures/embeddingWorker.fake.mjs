/**
 * embeddingWorker 协议的假 worker（#176 测试用）。
 *
 * 真实 worker 会加载 transformers.js，那需要下载模型；这里只验证主进程侧的协议：
 * 分批、进度、结果回填、错误传播与线程生命周期。故障由文本内容触发（`fail*` / `crash*`），
 * 这样不必往生产协议里塞测试开关。
 *
 * 这是纯 JS 的测试替身，不参与类型检查，因此关掉需要标注返回类型的规则。
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { parentPort, workerData } from 'worker_threads'

const port = parentPort
if (!port) {
  throw new Error('fake embedding worker must run as a worker thread')
}

const { batchSize = 16 } = workerData ?? {}

function embed(texts, purpose) {
  return texts.map((text) => {
    const size = purpose === 'query' ? 2 : 3
    return {
      embedding: new Float32Array(size).fill(text.length),
      model: 'fake-model',
      dimensions: size
    }
  })
}

port.on('message', (message) => {
  if (message.type === 'dispose') {
    port.postMessage({ type: 'disposed', id: message.id })
    port.close()
    return
  }

  if (message.texts.some((text) => text.startsWith('crash'))) {
    process.exit(7)
    return
  }

  if (message.texts.some((text) => text.startsWith('fail'))) {
    port.postMessage({ type: 'error', id: message.id, message: 'fake inference failure' })
    return
  }
  const batches = []
  for (let index = 0; index < message.texts.length; index += batchSize) {
    batches.push(message.texts.slice(index, index + batchSize))
  }

  const results = []
  for (const batch of batches) {
    results.push(...embed(batch, message.purpose))
    port.postMessage({
      type: 'progress',
      id: message.id,
      completed: results.length,
      total: message.texts.length
    })
  }

  port.postMessage({ type: 'result', id: message.id, results })
})
