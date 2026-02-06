/**
 * AI SDK 中间件构建器
 * 完全参考 cherry-studio 的 AiSdkMiddlewareBuilder 实现
 */

import type { LanguageModelMiddleware } from 'ai'
import Logger from '../../shared/utils/logger'

/**
 * 具名中间件（便于调试）
 */
export interface NamedMiddleware {
  name: string
  middleware: LanguageModelMiddleware
}

/**
 * 中间件构建器
 */
export class MiddlewareBuilder {
  private middlewares: NamedMiddleware[] = []

  /**
   * 添加具名中间件
   */
  add(named: NamedMiddleware): this {
    this.middlewares.push(named)
    return this
  }

  /**
   * 条件添加中间件
   */
  addIf(condition: boolean, named: NamedMiddleware): this {
    if (condition) {
      this.middlewares.push(named)
    }
    return this
  }

  /**
   * 在指定位置插入中间件
   */
  insertAfter(targetName: string, middleware: NamedMiddleware): this {
    const index = this.middlewares.findIndex((m) => m.name === targetName)
    if (index !== -1) {
      this.middlewares.splice(index + 1, 0, middleware)
    } else {
      Logger.warn('MiddlewareBuilder', `Middleware named '${targetName}' not found`)
    }
    return this
  }

  /**
   * 检查是否包含指定名称的中间件
   */
  has(name: string): boolean {
    return this.middlewares.some((m) => m.name === name)
  }

  /**
   * 移除指定名称的中间件
   */
  remove(name: string): this {
    this.middlewares = this.middlewares.filter((m) => m.name !== name)
    return this
  }

  /**
   * 构建最终的中间件数组
   */
  build(): LanguageModelMiddleware[] {
    return this.middlewares.map((m) => m.middleware)
  }

  /**
   * 获取具名中间件数组（用于调试）
   */
  buildNamed(): NamedMiddleware[] {
    return [...this.middlewares]
  }

  /**
   * 清空所有中间件
   */
  clear(): this {
    this.middlewares = []
    return this
  }

  /**
   * 获取中间件总数
   */
  get length(): number {
    return this.middlewares.length
  }
}

/**
 * 根据配置构建 AI SDK 中间件
 * 参考 cherry-studio 的 buildAiSdkMiddlewares 实现
 */
export function buildMiddlewares(config: {
  providerName: string
  modelId: string
  enableReasoning?: boolean
}): LanguageModelMiddleware[] {
  const builder = new MiddlewareBuilder()

  // 1. 根据 provider 添加特定中间件
  addProviderSpecificMiddlewares(builder, config)

  // 2. 根据模型类型添加特定中间件
  addModelSpecificMiddlewares(builder, config)

  return builder.build()
}

/**
 * 添加 provider 特定的中间件
 */
function addProviderSpecificMiddlewares(
  _builder: MiddlewareBuilder,
  config: { providerName: string; enableReasoning?: boolean }
) {
  // 根据不同 provider 添加特定中间件
  // 注意：builder 参数保留用于未来添加中间件
  switch (config.providerName) {
    case 'openai':
    case 'deepseek':
      // OpenAI/DeepSeek 推理提取
      if (config.enableReasoning) {
        // 这里可以添加推理相关的中间件
        Logger.debug('MiddlewareBuilder', `Reasoning enabled for ${config.providerName}`)
      }
      break

    case 'anthropic':
      // Anthropic 特定中间件（如缓存）
      Logger.debug('MiddlewareBuilder', 'Anthropic provider detected')
      break

    default:
      // 其他 provider 的通用处理
      break
  }
}

/**
 * 添加模型特定的中间件
 */
function addModelSpecificMiddlewares(_builder: MiddlewareBuilder, config: { modelId: string }) {
  // 根据模型 ID 添加特定中间件
  // 注意：builder 参数保留用于未来添加中间件
  // 例如：Qwen 思考模式、Gemini 特殊处理等
  const modelId = config.modelId.toLowerCase()

  if (modelId.includes('qwen')) {
    Logger.debug('MiddlewareBuilder', 'Qwen model detected')
  } else if (modelId.includes('gemini')) {
    Logger.debug('MiddlewareBuilder', 'Gemini model detected')
  }
}
