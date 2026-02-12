/**
 * Provider 相关工具函数
 */

export function isOpenAIProvider(providerId: string): boolean {
  return providerId === 'openai'
}

export function isAzureOpenAIProvider(providerId: string): boolean {
  return providerId === 'azure' || providerId === 'azure-openai'
}

export function isGeminiProvider(providerId: string): boolean {
  return providerId === 'gemini' || providerId === 'google'
}

export function isVertexProvider(providerId: string): boolean {
  return providerId === 'vertexai'
}

export function isNewApiProvider(providerId: string): boolean {
  return providerId === 'new-api' || providerId === 'newapi'
}

export function isOpenAICompatibleProvider(providerId: string): boolean {
  return !['anthropic', 'gemini', 'vertexai', 'aws-bedrock'].includes(providerId)
}
