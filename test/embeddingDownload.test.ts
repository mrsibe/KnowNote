import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  downloadFileWithResume,
  probeSources,
  type FetchLike
} from '../src/main/embedding/download/HttpDownloader.ts'
import {
  EmbeddingDownloadError,
  classifyDownloadError
} from '../src/main/embedding/download/errors.ts'

/**
 * 下载器必须自己保证：SHA256 校验后才原子落盘、中断可续传、按文件重试、取消清理临时
 * 文件。这些是 transformers.js 自带下载器给不了的，也是 #53 的核心。
 */

function bodyFromChunks(chunks: Uint8Array[]) {
  let index = 0
  return {
    getReader: () => ({
      read: async (): Promise<{ done: boolean; value?: Uint8Array }> =>
        index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }
    })
  }
}

function fakeResponse(
  status: number,
  body: ReturnType<typeof bodyFromChunks> | null,
  headers: Record<string, string> = {}
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body
  }
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

async function tempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'knownote-dl-'))
}

test('下载成功：校验通过后原子落盘，临时文件清理干净', async () => {
  const dir = await tempDir()
  const target = join(dir, 'model.bin')
  const content = Buffer.from('hello world, this is a test payload')

  const fetchImpl: FetchLike = async () =>
    fakeResponse(200, bodyFromChunks([content.subarray(0, 5), content.subarray(5)]))

  await downloadFileWithResume({
    getUrl: () => 'https://example.test/file',
    targetPath: target,
    expectedSize: content.length,
    expectedSha256: sha256(content),
    fetchImpl,
    maxAttempts: 1
  })

  assert.deepEqual(await readFile(target), content)
  await assert.rejects(stat(`${target}.part`))
  await rm(dir, { recursive: true, force: true })
})

test('断点续传：带 Range 头请求，只追加剩余字节', async () => {
  const dir = await tempDir()
  const target = join(dir, 'model.bin')
  const content = Buffer.from('0123456789abcdefghij')
  await writeFile(`${target}.part`, content.subarray(0, 7))

  let seenRange: string | undefined
  const fetchImpl: FetchLike = async (_url, init) => {
    seenRange = init?.headers?.Range
    return fakeResponse(206, bodyFromChunks([content.subarray(7)]))
  }

  await downloadFileWithResume({
    getUrl: () => 'https://example.test/file',
    targetPath: target,
    expectedSize: content.length,
    expectedSha256: sha256(content),
    fetchImpl,
    maxAttempts: 1
  })

  assert.equal(seenRange, 'bytes=7-')
  assert.deepEqual(await readFile(target), content)
  await rm(dir, { recursive: true, force: true })
})

test('校验失败：拒绝写入并删除临时文件', async () => {
  const dir = await tempDir()
  const target = join(dir, 'model.bin')
  const content = Buffer.from('corrupted payload')

  const fetchImpl: FetchLike = async () => fakeResponse(200, bodyFromChunks([content]))

  await assert.rejects(
    downloadFileWithResume({
      getUrl: () => 'https://example.test/file',
      targetPath: target,
      expectedSize: content.length,
      expectedSha256: 'deadbeef',
      fetchImpl,
      maxAttempts: 1
    }),
    (error: unknown) =>
      error instanceof EmbeddingDownloadError && error.code === 'CHECKSUM_MISMATCH'
  )

  await assert.rejects(stat(target))
  await assert.rejects(stat(`${target}.part`))
  await rm(dir, { recursive: true, force: true })
})

test('连接中断后重试成功', async () => {
  const dir = await tempDir()
  const target = join(dir, 'model.bin')
  const content = Buffer.from('retry me')
  let attempts = 0

  const fetchImpl: FetchLike = async () => {
    attempts += 1
    if (attempts === 1) {
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    }
    return fakeResponse(200, bodyFromChunks([content]))
  }

  await downloadFileWithResume({
    getUrl: () => 'https://example.test/file',
    targetPath: target,
    expectedSize: content.length,
    expectedSha256: sha256(content),
    fetchImpl,
    maxAttempts: 2,
    retryDelayMs: 1
  })

  assert.equal(attempts, 2)
  assert.deepEqual(await readFile(target), content)
  await rm(dir, { recursive: true, force: true })
})

test('取消：抛 CANCELLED 且不留下临时文件', async () => {
  const dir = await tempDir()
  const target = join(dir, 'model.bin')
  const controller = new AbortController()
  controller.abort()

  const fetchImpl: FetchLike = async () => fakeResponse(200, bodyFromChunks([Buffer.from('x')]))

  await assert.rejects(
    downloadFileWithResume({
      getUrl: () => 'https://example.test/file',
      targetPath: target,
      expectedSize: 1,
      expectedSha256: sha256(Buffer.from('x')),
      fetchImpl,
      signal: controller.signal,
      maxAttempts: 3,
      retryDelayMs: 1
    }),
    (error: unknown) => error instanceof EmbeddingDownloadError && error.code === 'CANCELLED'
  )

  await assert.rejects(stat(`${target}.part`))
  await rm(dir, { recursive: true, force: true })
})

test('可达性探测跳过失败源，返回第一个可用源', async () => {
  const fetchImpl: FetchLike = async (url) => {
    if (url.startsWith('https://a.test')) {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
    }
    return fakeResponse(200, bodyFromChunks([Buffer.from('{}')]))
  }

  const best = await probeSources(['https://a.test', 'https://b.test'], (base) => `${base}/probe`, {
    fetchImpl,
    timeoutMs: 500
  })

  assert.equal(best, 'https://b.test')
})

test('全部源不可达时返回 null', async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error('offline')
  }
  const best = await probeSources(['https://a.test'], (base) => `${base}/probe`, {
    fetchImpl,
    timeoutMs: 500
  })
  assert.equal(best, null)
})

test('错误分类覆盖 DNS / 超时 / 断流 / 磁盘 / 校验', () => {
  assert.equal(classifyDownloadError({ code: 'ENOTFOUND' }).code, 'DNS_FAILURE')
  assert.equal(classifyDownloadError({ code: 'ETIMEDOUT' }).code, 'CONNECTION_TIMEOUT')
  assert.equal(
    classifyDownloadError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })).code,
    'CONNECTION_TIMEOUT'
  )
  assert.equal(
    classifyDownloadError(Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }))
      .code,
    'DISK_FULL'
  )
  assert.equal(
    classifyDownloadError(new EmbeddingDownloadError('CHECKSUM_MISMATCH', 'bad', 'retry')).code,
    'CHECKSUM_MISMATCH'
  )
})

test('分类错误始终带可操作建议', () => {
  const failure = classifyDownloadError({ code: 'ENOTFOUND' })
  assert.ok(failure.suggestion.length > 0)
  assert.notEqual(failure.suggestion, '')
})
