import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSpaceId, getLocalSpace, getRemoteSpace } from '../src/main/embedding/space.ts'
import {
  LOCAL_EMBEDDING_FILES,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_TOTAL_BYTES,
  buildResolveUrl
} from '../src/main/embedding/localModel.ts'

/**
 * 向量只有在同一个 embedding space 内才可比。这里盯住 space 身份计算：决定输出空间的
 * 任何参数变化都必须改变 id，否则换了模型但维度恰好相同时旧向量会被误用。
 */

const BASE = {
  backend: 'local' as const,
  model: 'Xenova/multilingual-e5-small',
  revision: 'rev-a',
  dtype: 'q8',
  pooling: 'mean' as const,
  normalize: true,
  queryPrefix: 'query: ',
  documentPrefix: 'passage: ',
  dimensions: 384
}

test('computeSpaceId 稳定且以 space_ 前缀', () => {
  const first = computeSpaceId(BASE)
  const second = computeSpaceId({ ...BASE })
  assert.equal(first, second)
  assert.match(first, /^space_[0-9a-f]{32}$/)
})

test('computeSpaceId 随任一空间参数变化', () => {
  const id = computeSpaceId(BASE)
  const variants = [
    { ...BASE, revision: 'rev-b' },
    { ...BASE, dtype: 'fp32' },
    { ...BASE, pooling: 'cls' as const },
    { ...BASE, normalize: false },
    { ...BASE, queryPrefix: '' },
    { ...BASE, documentPrefix: '' },
    { ...BASE, dimensions: 768 },
    { ...BASE, model: 'other/model' }
  ]

  for (const variant of variants) {
    assert.notEqual(computeSpaceId(variant), id)
  }
})

test('getLocalSpace 使用 pin 死的 revision 与 384 维', () => {
  const space = getLocalSpace()
  assert.equal(space.backend, 'local')
  assert.equal(space.model, LOCAL_EMBEDDING_MODEL.id)
  assert.equal(space.revision, LOCAL_EMBEDDING_MODEL.revision)
  assert.equal(space.dimensions, 384)
  assert.equal(space.queryPrefix, 'query: ')
  assert.equal(space.documentPrefix, 'passage: ')
})

test('getRemoteSpace 按 connection 区分，维度回填会改变 id', () => {
  const base = {
    protocol: 'openai-completions' as const,
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'k',
    modelId: 'text-embedding-3-small'
  }
  const other = { ...base, modelId: 'text-embedding-3-large' }

  assert.notEqual(getRemoteSpace(base).id, getRemoteSpace(other).id)
  assert.notEqual(getRemoteSpace(base).id, getRemoteSpace(base, 1536).id)
})

test('清单包含 7 个文件，总字节数与 PIN 的模型一致', () => {
  assert.equal(LOCAL_EMBEDDING_FILES.length, 7)
  const sum = LOCAL_EMBEDDING_FILES.reduce((total, file) => total + file.size, 0)
  assert.equal(LOCAL_EMBEDDING_TOTAL_BYTES, sum)
  assert.ok(LOCAL_EMBEDDING_TOTAL_BYTES > 140 * 1000 * 1000)
  assert.ok(LOCAL_EMBEDDING_TOTAL_BYTES < 141 * 1000 * 1000)
})

test('buildResolveUrl 带 revision 且对子路径逐段编码', () => {
  const url = buildResolveUrl('https://hf-mirror.com/', 'rev-1', 'onnx/model_quantized.onnx')
  assert.equal(
    url,
    'https://hf-mirror.com/Xenova/multilingual-e5-small/resolve/rev-1/onnx/model_quantized.onnx'
  )
})
