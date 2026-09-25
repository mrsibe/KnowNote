import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EmbeddingService,
  type EmbeddingServiceOptions
} from '../src/main/services/EmbeddingService.ts'
import type { ConnectionManager } from '../src/main/models/ConnectionManager.ts'
import type {
  FeatureExtractionPipeline,
  TransformersModuleLoader
} from '../src/main/embedding/LocalEmbeddingBackend.ts'

/**
 * 本地 embedding 必须分批。
 *
 * 不分批时，整份文档的 chunk 会被一次性 tokenize 并送进一个 ONNX 前向：一本几百 chunk
 * 的书会长时间无响应、内存峰值失控，而 `onProgress` 只在最后被调用一次，索引进度一直
 * 停在起点。远程路径早就有 batch，本地这条没有。
 */

// SAFETY: EmbeddingService only reaches `getEmbeddingClient` and `getConnection` on its
// ConnectionManager, and this stub answers "no remote connection" for both so the service
// takes the built-in local path. Any new call site would fail loudly instead of silently
// reading a fake field.
const localOnlyConnectionManager = (): ConnectionManager =>
  ({
    getEmbeddingClient: async () => null,
    getConnection: async () => null
  }) as unknown as ConnectionManager

/** Records the size of every array that reaches the ONNX pipeline. */
function localService(batchSizes: number[], options: Partial<EmbeddingServiceOptions> = {}) {
  const loader: TransformersModuleLoader = async () => ({
    env: { cacheDir: null, allowRemoteModels: false, allowLocalModels: true, useFSCache: true },
    pipeline: async () => {
      const extractor: FeatureExtractionPipeline = async (texts) => {
        batchSizes.push(texts.length)
        return { tolist: () => texts.map(() => [0.1, 0.2]) }
      }
      return extractor
    }
  })

  return new EmbeddingService(localOnlyConnectionManager(), {
    cacheDir: '/tmp/knownote-embedding-test',
    loadTransformers: loader,
    ...options
  })
}

test('local embeddings run in bounded batches, not one inference over everything', async () => {
  const batchSizes: number[] = []
  const service = localService(batchSizes, { localBatchSize: 16 })

  const texts = Array.from({ length: 40 }, (_, index) => `chunk ${index}`)
  const progress: Array<[number, number]> = []
  const results = await service.embedBatch(texts, 'document', (completed, total) =>
    progress.push([completed, total])
  )

  assert.deepEqual(batchSizes, [16, 16, 8], 'the whole array must not reach the pipeline at once')
  assert.equal(results.length, 40)
  // Progress advances per batch instead of jumping 0 -> total once at the end.
  assert.deepEqual(progress, [
    [16, 40],
    [32, 40],
    [40, 40]
  ])
})

test('the local batch size defaults to 16', async () => {
  const batchSizes: number[] = []
  const service = localService(batchSizes)

  await service.embedBatch(
    Array.from({ length: 33 }, (_, index) => `c${index}`),
    'document'
  )

  assert.deepEqual(batchSizes, [16, 16, 1])
})

test('a single local embed still goes through the same pipeline', async () => {
  const batchSizes: number[] = []
  const service = localService(batchSizes)

  const result = await service.embed('only', 'query')

  assert.deepEqual(batchSizes, [1])
  assert.equal(result.dimensions, 2)
})
