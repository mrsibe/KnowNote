/**
 * Protocol adapter 接口
 *
 * 业务代码只依赖这个接口和 ModelConnection，不感知任何厂商。
 * 新增一个 API 协议只需实现一个 adapter。
 */

import type { EmbeddingModel, LanguageModel } from 'ai'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { APIProtocol, ModelConnection } from '../../../shared/types/connection'

export interface ProtocolAdapter {
  readonly protocol: APIProtocol

  /**
   * 构造该协议下的语言模型。协议不支持对话时抛错。
   */
  createLanguageModel(connection: ModelConnection): LanguageModel

  /**
   * 构造该协议下的 embedding 模型。协议不支持 embedding 时抛错。
   */
  createEmbeddingModel(connection: ModelConnection): EmbeddingModel

  /**
   * 把用户声明的向量维度翻译成该协议的 providerOptions。
   * 协议/模型不支持时返回 undefined（由服务端忽略该参数）。
   */
  embeddingProviderOptions?(
    connection: ModelConnection,
    dimensions?: number
  ): SharedV2ProviderOptions | undefined

  /**
   * 该协议是否支持从端点拉取模型列表（/v1/models 等）。
   */
  supportsModelListing: boolean

  /**
   * 拉取可选模型 ID 列表。协议不支持时抛错。
   */
  listModels?(connection: ModelConnection): Promise<string[]>
}
