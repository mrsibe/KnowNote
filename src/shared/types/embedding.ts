/**
 * Embedding 相关类型
 *
 * Embedding 对 KnowNote 是基础设施，不是用户必须完成的配置步骤：
 * 没有配置远程 embedding connection 时，默认使用内置的本地模型（RAG 与设置页都以此为准）。
 */

/**
 * 一次 embedding 的用途。
 *
 * E5 系列的检索任务要求 query 与 document 使用不同的前缀，二者不能混用；
 * 索引时传 `document`，检索时传 `query`。
 */
export type EmbeddingPurpose = 'query' | 'document'

/**
 * 一个 embedding space 的身份。
 *
 * 向量只有在同一个 space 内才可比。维度相同但模型/revision 不同时，旧向量与新查询
 * 向量已经不可比，所以这里把决定输出空间的全部参数都放进 `id` 的哈希输入。
 */
export interface EmbeddingSpace {
  /** hash(model + revision + dtype + pooling + normalize + prefix + dimensions) */
  id: string
  backend: 'local' | 'remote'
  model: string
  revision: string
  dimensions: number
  dtype?: string
  pooling: 'mean' | 'cls' | 'last_token'
  normalize: boolean
  queryPrefix?: string
  documentPrefix?: string
}

/**
 * 本地 embedding 模型在磁盘上的状态
 */
export type EmbeddingModelState = 'not-installed' | 'installed'

/**
 * 内置本地模型的静态信息 + 当前安装状态
 */
export interface LocalEmbeddingModelInfo {
  id: string
  label: string
  revision: string
  dtype: string
  dimensions: number
  /** 清单里全部文件的总字节数 */
  totalBytes: number
  state: EmbeddingModelState
  /** 模型缓存目录 */
  path: string
  /** 已安装时占用的磁盘字节数 */
  installedBytes?: number
}

/**
 * 下载器的错误分类。错误信息必须可操作，不能回落成笼统的 "failed to embed"。
 */
export type EmbeddingErrorCode =
  | 'DNS_FAILURE'
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_TIMEOUT'
  | 'HTTP_STATUS'
  | 'CHECKSUM_MISMATCH'
  | 'DISK_FULL'
  | 'CANCELLED'
  | 'SOURCE_UNAVAILABLE'
  | 'UNKNOWN'

/**
 * 下载阶段。renderer 只需要把 progress 画成进度条，把 message/suggestion 展示出来。
 */
export type EmbeddingDownloadPhase =
  'probing' | 'downloading' | 'verifying' | 'done' | 'error' | 'cancelled'

/**
 * 下载进度事件
 */
export interface EmbeddingDownloadProgress {
  phase: EmbeddingDownloadPhase
  /** 当前文件名 */
  file?: string
  fileIndex?: number
  fileCount?: number
  /** 单文件进度 0-1 */
  fileProgress?: number
  /** 整体进度 0-1 */
  progress: number
  downloadedBytes: number
  totalBytes: number
  errorCode?: EmbeddingErrorCode
  message?: string
  suggestion?: string
}

/**
 * 下载源探测结果
 */
export interface EmbeddingSourceInfo {
  url: string
  reachable: boolean
}

/**
 * 内置本地 embedding 模型的默认下载源（按顺序探测）。
 *
 * `huggingface.co` 在部分网络下不可达，`hf-mirror.com` 已实测可完整下载并通过 SHA256
 * 校验。用户可在设置里覆盖。
 */
export const DEFAULT_EMBEDDING_SOURCES: readonly string[] = [
  'https://huggingface.co',
  'https://hf-mirror.com'
]
