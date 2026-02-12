/**
 * Assistant Service - 简化版本
 * 提供模型和供应商相关的辅助功能
 */

/**
 * 根据模型获取供应商信息
 */
export function getProviderByModel(model: any): string | null {
  if (!model) return null

  // 如果模型对象包含 provider 字段，直接返回
  if (model.provider) {
    return model.provider
  }

  // 根据模型 ID 推断供应商
  const modelId = model.id?.toLowerCase() || ''

  if (modelId.includes('gpt') || modelId.includes('o1') || modelId.includes('dall-e')) {
    return 'openai'
  }
  if (modelId.includes('claude')) {
    return 'anthropic'
  }
  if (modelId.includes('gemini')) {
    return 'gemini'
  }
  if (modelId.includes('deepseek')) {
    return 'deepseek'
  }
  if (modelId.includes('qwen')) {
    return 'qwen'
  }
  if (modelId.includes('glm')) {
    return 'zhipu'
  }

  return null
}
