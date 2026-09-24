import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, truncate, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  deleteLocalModel,
  ensureRevisionlessAliases,
  getInstalledBytes,
  getLocalModelInfo,
  getModelAliasPath,
  getModelDir,
  getModelFilePath,
  importLocalModel,
  isModelInstalled
} from '../src/main/embedding/ModelRegistry.ts'
import {
  LOCAL_EMBEDDING_FILES,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_TOTAL_BYTES
} from '../src/main/embedding/localModel.ts'

/**
 * 缓存路径必须与 transformers.js 的约定一致（pin 死 revision 时
 * cacheKey = <model_id>/<revision>/<filename>），且"已安装"只看清单文件是否齐全。
 */

async function tempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'knownote-registry-'))
}

async function createSparseFile(path: string, size: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '')
  await truncate(path, size)
}

test('缓存路径按 model_id/revision/filename 约定', () => {
  const dir = getModelDir('/models')
  assert.equal(dir, join('/models', LOCAL_EMBEDDING_MODEL.id, LOCAL_EMBEDDING_MODEL.revision))
  assert.equal(
    getModelFilePath('/models', 'onnx/model_quantized.onnx'),
    join(dir, 'onnx', 'model_quantized.onnx')
  )
})

test('空目录视为未安装', async () => {
  const cacheDir = await tempDir()
  assert.equal(await isModelInstalled(cacheDir), false)
  assert.equal((await getLocalModelInfo(cacheDir)).state, 'not-installed')
  await rm(cacheDir, { recursive: true, force: true })
})

test('清单文件齐全且大小正确时视为已安装', async () => {
  const cacheDir = await tempDir()
  for (const file of LOCAL_EMBEDDING_FILES) {
    await createSparseFile(getModelFilePath(cacheDir, file.path), file.size)
  }

  assert.equal(await isModelInstalled(cacheDir), true)
  assert.equal(await getInstalledBytes(cacheDir), LOCAL_EMBEDDING_TOTAL_BYTES)

  const info = await getLocalModelInfo(cacheDir)
  assert.equal(info.state, 'installed')
  assert.equal(info.installedBytes, LOCAL_EMBEDDING_TOTAL_BYTES)
  assert.equal(info.dimensions, 384)

  await deleteLocalModel(cacheDir)
  assert.equal(await isModelInstalled(cacheDir), false)
  await rm(cacheDir, { recursive: true, force: true })
})

test('大小不符（半截缓存）视为未安装', async () => {
  const cacheDir = await tempDir()
  for (const file of LOCAL_EMBEDDING_FILES) {
    await createSparseFile(getModelFilePath(cacheDir, file.path), Math.max(0, file.size - 1))
  }
  assert.equal(await isModelInstalled(cacheDir), false)
  await rm(cacheDir, { recursive: true, force: true })
})

test('别名：为发现步骤补齐不带 revision 的硬链接', async () => {
  const cacheDir = await tempDir()
  for (const file of LOCAL_EMBEDDING_FILES) {
    await createSparseFile(getModelFilePath(cacheDir, file.path), file.size)
  }

  await ensureRevisionlessAliases(cacheDir)

  // transformers.js v4.3.0 的发现步骤按不带 revision 的 cacheKey 读 config.json / tokenizer_config.json
  const source = await stat(getModelFilePath(cacheDir, 'config.json'))
  const alias = await stat(getModelAliasPath(cacheDir, 'config.json'))
  assert.equal(alias.ino, source.ino, 'alias should share the inode (hardlink)')
  assert.equal(alias.size, source.size)

  // 幂等：重复调用不报错
  await ensureRevisionlessAliases(cacheDir)
  await rm(cacheDir, { recursive: true, force: true })
})

test('手动导入：源目录缺文件时返回缺失清单且不写入缓存', async () => {
  const cacheDir = await tempDir()
  const sourceDir = await tempDir()

  const problems = await importLocalModel(cacheDir, sourceDir, { verifyChecksums: false })

  assert.equal(problems.length, LOCAL_EMBEDDING_FILES.length)
  assert.deepEqual(
    problems,
    LOCAL_EMBEDDING_FILES.map((file) => file.path)
  )
  assert.equal(await isModelInstalled(cacheDir), false)
  await rm(cacheDir, { recursive: true, force: true })
  await rm(sourceDir, { recursive: true, force: true })
})

test('手动导入：校验不通过的文件会被报告', async () => {
  const cacheDir = await tempDir()
  const sourceDir = await tempDir()

  // 只放一个内容错误的文件，其余缺失
  await createSparseFile(join(sourceDir, 'config.json'), 658)

  const problems = await importLocalModel(cacheDir, sourceDir, { verifyChecksums: true })
  assert.ok(problems.includes('config.json'))
  assert.equal(await isModelInstalled(cacheDir), false)
  await rm(cacheDir, { recursive: true, force: true })
  await rm(sourceDir, { recursive: true, force: true })
})
