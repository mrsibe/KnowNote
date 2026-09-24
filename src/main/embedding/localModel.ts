/**
 * 内置本地 embedding 模型的 pin 与文件清单。
 *
 * 模型版本必须 pin 死：一个 KnowNote 版本对应一个确定的 embedding space。不要每次启动去
 * 仓库取 latest，否则模型静默更新后新旧向量会被混进同一张向量表。
 *
 * 清单里的 SHA256 是真实数据（LFS 文件的 oid 即 SHA256，小文件为本地实算）。模型升级时
 * 必须同步更新 revision、文件大小与 SHA256，否则下载会因为校验失败而拒绝写入缓存。
 */

/**
 * 内置本地 embedding 模型
 */
export const LOCAL_EMBEDDING_MODEL = {
  id: 'Xenova/multilingual-e5-small',
  label: 'multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  dtype: 'q8',
  dimensions: 384,
  pooling: 'mean',
  normalize: true,
  queryPrefix: 'query: ',
  documentPrefix: 'passage: ',
  /** XLM-R sentencepiece 的 512 token 上限 */
  maxLength: 512,
  baseModel: 'intfloat/multilingual-e5-small',
  license: 'MIT'
} as const

/**
 * 清单中的一个文件
 */
export interface EmbeddingModelFile {
  /** 相对仓库根目录的路径，也是缓存目录内的相对路径 */
  path: string
  size: number
  sha256: string
}

/**
 * 下载必需文件。dq8 映射到 `_quantized` 后缀的 ONNX 文件。
 */
export const LOCAL_EMBEDDING_FILES: readonly EmbeddingModelFile[] = [
  {
    path: 'onnx/model_quantized.onnx',
    size: 118308185,
    sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193'
  },
  {
    path: 'tokenizer.json',
    size: 17082730,
    sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39'
  },
  {
    path: 'sentencepiece.bpe.model',
    size: 5069051,
    sha256: 'cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865'
  },
  {
    path: 'config.json',
    size: 658,
    sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1'
  },
  {
    path: 'tokenizer_config.json',
    size: 443,
    sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b'
  },
  {
    path: 'quant_config.json',
    size: 674,
    sha256: '59d175f15264115f18c698d76e443b5d49fc6c8c599911c421405ef4f236e87d'
  },
  {
    path: 'special_tokens_map.json',
    size: 167,
    sha256: 'd05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7'
  }
]

/** 清单内全部文件的总字节数（≈ 140.5 MB） */
export const LOCAL_EMBEDDING_TOTAL_BYTES = LOCAL_EMBEDDING_FILES.reduce(
  (sum, file) => sum + file.size,
  0
)

/**
 * 远端 `resolve` URL。镜像对小文件返回 307（相对路径），对 Xet 权重返回 302 到绝对 URL
 * （带一小时有效期签名），因此续传时必须重新请求这个 URL 拿新签名，不能缓存 302 目标。
 */
export function buildResolveUrl(baseUrl: string, revision: string, filePath: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const encodedPath = filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${base}/${LOCAL_EMBEDDING_MODEL.id}/resolve/${revision}/${encodedPath}`
}
