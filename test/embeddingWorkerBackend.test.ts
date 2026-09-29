import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { WorkerEmbeddingBackend } from '../src/main/embedding/WorkerEmbeddingBackend.ts'

/**
 * #176：本地推理必须在 worker 线程里跑。
 *
 * 这里用假 worker 钉住主进程侧的协议：整批文本交给 worker、批次在 worker 内切、进度按批
 * 回报、错误与线程崩溃都能传播给调用方，而不是把主进程挂死。
 */

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'embeddingWorker.fake.mjs'
)

test('worker 后端把整批文本交给 worker，并按批回报进度', async () => {
  const service = new WorkerEmbeddingBackend({
    cacheDir: '/tmp/knownote-embedding-test',
    batchSize: 16,
    workerPath: fixture
  })

  const texts = Array.from({ length: 40 }, (_, index) => `chunk-${index}`)
  const progress: Array<[number, number]> = []
  const results = await service.embedBatch(texts, 'document', (completed, total) =>
    progress.push([completed, total])
  )

  assert.equal(results.length, 40)
  // 批次由 worker 按 batchSize 切：进度是 16 → 32 → 40，而不是 40 一次跳到底。
  assert.deepEqual(progress, [
    [16, 40],
    [32, 40],
    [40, 40]
  ])
  assert.ok(results[0].embedding instanceof Float32Array)
  assert.equal(results[0].dimensions, 3)

  await service.dispose()
})

test('worker 的 inference 错误传播给调用方', async () => {
  const service = new WorkerEmbeddingBackend({
    cacheDir: '/tmp/knownote-embedding-test',
    batchSize: 2,
    workerPath: fixture
  })

  await assert.rejects(
    () => service.embedBatch(['fail-here'], 'document'),
    /fake inference failure/
  )
  await service.dispose()
})

test('worker 崩溃时拒绝挂起的请求，且可以重新拉起', async () => {
  const service = new WorkerEmbeddingBackend({
    cacheDir: '/tmp/knownote-embedding-test',
    batchSize: 1,
    workerPath: fixture
  })

  await assert.rejects(() => service.embedBatch(['crash-now'], 'document'))

  // 崩溃后 worker 被丢弃；下一次调用重新创建一个，而不是永远卡死。
  const results = await service.embedBatch(['ok'], 'document')
  assert.equal(results.length, 1)

  await service.dispose()
})
