/**
 * EmbeddingSpace 身份计算。
 *
 * 向量只有在同一个 space 内才可比。仅用维度判断是不够的：换了模型但维度恰好相同
 * （例如 768 → 768）时，旧向量与新查询向量已经不可比却检测不到。所以把决定输出空间的
 * 全部参数都放进哈希输入，revision 参与哈希正好覆盖"模型升级"场景。
 */

import { createHash } from 'crypto'
import type { EmbeddingSpace } from '../../shared/types'
import type { ModelConnection } from '../../shared/types/connection'
import { LOCAL_EMBEDDING_MODEL } from './localModel'

/**
 * space 的身份字段（不含 id）
 */
export type EmbeddingSpaceIdentity = Omit<EmbeddingSpace, 'id'>

/**
 * 对身份字段做稳定哈希，字段顺序固定。
 */
export function computeSpaceId(identity: EmbeddingSpaceIdentity): string {
  const canonical = [
    identity.backend,
    identity.model,
    identity.revision,
    identity.dtype ?? '',
    identity.pooling,
    identity.normalize ? '1' : '0',
    identity.queryPrefix ?? '',
    identity.documentPrefix ?? '',
    String(identity.dimensions)
  ].join('\u0000')

  return `space_${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}`
}

/**
 * 内置本地模型的 space
 */
export function getLocalSpace(): EmbeddingSpace {
  const identity: EmbeddingSpaceIdentity = {
    backend: 'local',
    model: LOCAL_EMBEDDING_MODEL.id,
    revision: LOCAL_EMBEDDING_MODEL.revision,
    dtype: LOCAL_EMBEDDING_MODEL.dtype,
    pooling: LOCAL_EMBEDDING_MODEL.pooling,
    normalize: LOCAL_EMBEDDING_MODEL.normalize,
    queryPrefix: LOCAL_EMBEDDING_MODEL.queryPrefix,
    documentPrefix: LOCAL_EMBEDDING_MODEL.documentPrefix,
    dimensions: LOCAL_EMBEDDING_MODEL.dimensions
  }
  return { id: computeSpaceId(identity), ...identity }
}

/**
 * 远程 embedding connection 的 space。
 *
 * 远程模型没有本地 revision，用 protocol + baseUrl + modelId 作为身份；维度在未知时记 0，
 * 首次 embedding 量到真实维度后由调用方回填。查询/文档前缀为空（AI SDK 的 provider 负责
 * 各自模型的前缀语义）。
 */
export function getRemoteSpace(connection: ModelConnection, dimensions = 0): EmbeddingSpace {
  const identity: EmbeddingSpaceIdentity = {
    backend: 'remote',
    model: `${connection.protocol}:${connection.baseUrl}:${connection.modelId}`,
    revision: '',
    pooling: 'mean',
    normalize: true,
    dimensions
  }
  return { id: computeSpaceId(identity), ...identity }
}
