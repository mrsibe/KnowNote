/**
 * 工具函数 - 简化版本
 */

/**
 * 获取模型名称的小写基础版本
 * 支持两种调用方式：
 * 1. getLowerBaseModelName(modelId)
 * 2. getLowerBaseModelName(modelId, providerId) - providerId 会被忽略
 */
export function getLowerBaseModelName(modelId: string, _providerId?: string): string {
  if (!modelId) return ''
  return modelId.toLowerCase().trim()
}

/**
 * 检查是否为用户选择的模型类型
 * 返回 undefined 表示未设置，true/false 表示用户明确选择
 */
export function isUserSelectedModelType(_model: any, _type?: string): boolean | undefined {
  // 简化实现：暂时返回 undefined，表示未设置
  // 后续可以根据 model 的元数据来判断
  return undefined
}

/**
 * 检查是否为 OpenAI 提供商
 */
export function isOpenAIProvider(providerId: string): boolean {
  return providerId === 'openai'
}

/**
 * 检查是否为 Azure OpenAI 提供商
 */
export function isAzureOpenAIProvider(providerId: string): boolean {
  return providerId === 'azure' || providerId === 'azure-openai'
}

/**
 * 检查是否为 Gemini 提供商
 */
export function isGeminiProvider(providerId: string): boolean {
  return providerId === 'gemini' || providerId === 'google'
}

/**
 * 检查是否为 VertexAI 提供商
 */
export function isVertexProvider(providerId: string): boolean {
  return providerId === 'vertexai'
}

/**
 * 检查是否为 NewAPI 提供商
 */
export function isNewApiProvider(providerId: string): boolean {
  return providerId === 'new-api' || providerId === 'newapi'
}

/**
 * 检查是否为 OpenAI 兼容提供商
 */
export function isOpenAICompatibleProvider(providerId: string): boolean {
  // 大多数提供商都是 OpenAI 兼容的
  return !['anthropic', 'gemini', 'vertexai', 'aws-bedrock'].includes(providerId)
}
