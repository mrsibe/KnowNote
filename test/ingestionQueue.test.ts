import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IngestionQueue } from '../src/main/services/ingestion/IngestionQueue.ts'

/**
 * #176：批量导入的后台队列。
 *
 * handler 登记完 `pending` 行就返回，解析/嵌入在这里排队。这些用例钉住队列的三条
 * 语义：串行、进度转发、单份失败不拖垮整批。
 */

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('任务串行执行，且进度转发给入队方', async () => {
  const queue = new IngestionQueue()
  const order: string[] = []
  const progress: Array<[string, string, number]> = []

  queue.enqueue({
    documentId: 'a',
    onProgress: (stage, value) => progress.push(['a', stage, value]),
    run: async (onProgress) => {
      order.push('a:start')
      onProgress('parsing', 5)
      await tick()
      order.push('a:end')
    }
  })
  queue.enqueue({
    documentId: 'b',
    onProgress: (stage, value) => progress.push(['b', stage, value]),
    run: async () => {
      order.push('b:start')
      await tick()
      order.push('b:end')
    }
  })

  await queue.whenIdle()

  // a 必须整体结束之后 b 才开始，不能交错。
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end'])
  assert.deepEqual(progress, [['a', 'parsing', 5]])
  assert.equal(queue.isBusy(), false)
})

test('一份失败不中止后面的任务', async () => {
  const queue = new IngestionQueue()
  const completed: string[] = []

  queue.enqueue({ documentId: 'bad', run: async () => Promise.reject(new Error('boom')) })
  queue.enqueue({
    documentId: 'good',
    run: async () => {
      completed.push('good')
    }
  })

  await queue.whenIdle()
  assert.deepEqual(completed, ['good'])
})

test('同一个 documentId 不会重复入队', async () => {
  const queue = new IngestionQueue()
  let runs = 0

  const job = {
    documentId: 'same',
    run: async () => {
      runs += 1
      await tick()
    }
  }
  queue.enqueue(job)
  queue.enqueue(job)

  await queue.whenIdle()
  assert.equal(runs, 1)
})

test('whenIdle 在空队列上立即 resolve', async () => {
  const queue = new IngestionQueue()
  await queue.whenIdle()
  assert.equal(queue.isBusy(), false)
})
