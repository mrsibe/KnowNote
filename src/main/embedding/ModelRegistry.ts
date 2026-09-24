/**
 * ModelRegistry
 *
 * 内置本地模型的磁盘布局与安装状态。
 *
 * 缓存路径约定（transformers.js `buildResourcePaths`：`revision !== 'main'` 且使用
 * FileCache 时 cacheKey = pathJoin(path_or_repo_id, revision, filename)）：
 *
 *   <cacheDir>/<model_id>/<revision>/<filename>
 *
 * 例：<userData>/models/Xenova/multilingual-e5-small/761b726.../onnx/model_quantized.onnx
 *
 * 因为 revision 是 pin 死的，路径可预测、可预置，transformers.js 只需读本地文件。
 *
 * 例外：transformers.js v4.3.0 的 pipeline() 在做“这个模型需要哪些文件”的探测时
 * （get_pipeline_files -> get_files -> config.json / tokenizer_config.json）没有把
 * revision 传下去，于是按不带 revision 的 cacheKey 找文件。为了让 allowRemoteModels =
 * false 时探测也能命中缓存，同一批文件会在 <cacheDir>/<model_id>/<filename> 再放一份
 * 硬链接别名（同一文件系统内不占额外空间）。revision 变化会换新的 revision 目录，
 * 别名随之重建，所以升级语义不受影响。
 */

import { join } from 'path'
import { mkdir, rm, stat, readdir, copyFile, rename, link, lstat } from 'fs/promises'
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import {
  LOCAL_EMBEDDING_FILES,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_TOTAL_BYTES
} from './localModel'
import type { LocalEmbeddingModelInfo } from '../../shared/types'

/**
 * 模型缓存目录：<cacheDir>/<modelId>/<revision>
 */
export function getModelDir(cacheDir: string): string {
  return join(cacheDir, LOCAL_EMBEDDING_MODEL.id, LOCAL_EMBEDDING_MODEL.revision)
}

/**
 * 某个清单文件在缓存里的绝对路径
 */
export function getModelFilePath(cacheDir: string, relativePath: string): string {
  return join(getModelDir(cacheDir), ...relativePath.split('/'))
}

/**
 * 不带 revision 的别名路径（见文件头注释）
 */
export function getModelAliasPath(cacheDir: string, relativePath: string): string {
  return join(cacheDir, LOCAL_EMBEDDING_MODEL.id, ...relativePath.split('/'))
}

/**
 * 为清单文件补齐不带 revision 的硬链接别名，供 transformers.js 的发现步骤读取。
 *
 * 源文件不存在（模型未安装）时直接跳过；别名已指向同一 inode 时不动。硬链接失败
 * （跨文件系统等）时退化为拷贝。
 */
export async function ensureRevisionlessAliases(cacheDir: string): Promise<void> {
  for (const file of LOCAL_EMBEDDING_FILES) {
    const source = getModelFilePath(cacheDir, file.path)
    const alias = getModelAliasPath(cacheDir, file.path)

    const sourceInfo = await stat(source).catch(() => null)
    if (!sourceInfo?.isFile()) {
      continue
    }

    const aliasInfo = await lstat(alias).catch(() => null)
    if (aliasInfo && aliasInfo.ino === sourceInfo.ino && aliasInfo.dev === sourceInfo.dev) {
      continue
    }

    await mkdir(join(alias, '..'), { recursive: true })
    await rm(alias, { force: true })
    try {
      await link(source, alias)
    } catch {
      await copyFile(source, alias)
    }
  }
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}

/**
 * 校验文件的 SHA256
 */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  return new Promise<string>((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * 逐个文件检查存在且大小正确。
 *
 * 状态查询会被 UI 频繁调用，所以只查存在性与大小；完整 SHA256 校验只在下载/导入结束
 * 时做一次。
 */
export async function isModelInstalled(cacheDir: string): Promise<boolean> {
  for (const file of LOCAL_EMBEDDING_FILES) {
    const size = await fileSize(getModelFilePath(cacheDir, file.path))
    if (size !== file.size) {
      return false
    }
  }
  return true
}

/**
 * 已安装文件占用的字节数（目录不存在时返回 0）
 */
export async function getInstalledBytes(cacheDir: string): Promise<number> {
  let total = 0
  for (const file of LOCAL_EMBEDDING_FILES) {
    const size = await fileSize(getModelFilePath(cacheDir, file.path))
    if (size) {
      total += size
    }
  }
  return total
}

/**
 * UI 需要的模型状态
 */
export async function getLocalModelInfo(cacheDir: string): Promise<LocalEmbeddingModelInfo> {
  const installed = await isModelInstalled(cacheDir)
  const info: LocalEmbeddingModelInfo = {
    id: LOCAL_EMBEDDING_MODEL.id,
    label: LOCAL_EMBEDDING_MODEL.label,
    revision: LOCAL_EMBEDDING_MODEL.revision,
    dtype: LOCAL_EMBEDDING_MODEL.dtype,
    dimensions: LOCAL_EMBEDDING_MODEL.dimensions,
    totalBytes: LOCAL_EMBEDDING_TOTAL_BYTES,
    state: installed ? 'installed' : 'not-installed',
    path: getModelDir(cacheDir)
  }
  if (installed) {
    info.installedBytes = await getInstalledBytes(cacheDir)
  }
  return info
}

/**
 * 删除本地模型缓存（磁盘占用透明、可回收）
 */
export async function deleteLocalModel(cacheDir: string): Promise<void> {
  await rm(join(cacheDir, LOCAL_EMBEDDING_MODEL.id), { recursive: true, force: true })
}

/**
 * 手动导入：把用户指定的目录作为模型目录来源，逐文件拷贝并校验后落盘。
 *
 * 目录布局应与缓存目录一致（即 `<source>/onnx/model_quantized.onnx` 等）。这是唯一
 * 不依赖任何第三方可用性的安装路径。
 *
 * @returns 缺失或校验失败的文件列表；为空表示导入成功。
 */
export async function importLocalModel(
  cacheDir: string,
  sourceDir: string,
  options?: { verifyChecksums?: boolean }
): Promise<string[]> {
  const verify = options?.verifyChecksums ?? true

  // 先把必需文件全部校验一遍，再开始拷贝，避免拷到一半才发现缺文件
  const problems: string[] = []
  for (const file of LOCAL_EMBEDDING_FILES) {
    const source = join(sourceDir, ...file.path.split('/'))
    const size = await fileSize(source)
    if (size === null) {
      problems.push(file.path)
      continue
    }
    if (verify) {
      const digest = await sha256File(source)
      if (digest !== file.sha256) {
        problems.push(file.path)
      }
    }
  }

  if (problems.length > 0) {
    return problems
  }

  for (const file of LOCAL_EMBEDDING_FILES) {
    const source = join(sourceDir, ...file.path.split('/'))
    const target = getModelFilePath(cacheDir, file.path)
    const staging = `${target}.importing`
    await mkdir(join(target, '..'), { recursive: true })
    await copyFile(source, staging)
    await rm(target, { force: true })
    await rename(staging, target)
  }

  await ensureRevisionlessAliases(cacheDir)

  return []
}

/**
 * 列出缓存目录里可能残留的临时文件（用于清理）
 */
export async function listTemporaryFiles(cacheDir: string): Promise<string[]> {
  const modelDir = getModelDir(cacheDir)
  try {
    const entries = await readdir(modelDir, { recursive: true, withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.includes('.tmp.'))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}
