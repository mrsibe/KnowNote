// 简化版本的模型配置导出
// 暂时只导出基础功能，复杂的检测函数后续完善

// 暂时注释掉所有复杂的模型配置文件，避免编译错误
// 这些文件依赖了大量 cherry-studio 特有的类型和功能
// export * from './logo'
// export * from './default'
// export * from './embedding'
// export * from './openai'
// export * from './qwen'
// export * from './reasoning'
// export * from './tooluse'
// export * from './utils'
// export * from './vision'
// export * from './websearch'

// 临时导出空的 SYSTEM_MODELS 对象
// 后续可以根据需要逐步完善
export const SYSTEM_MODELS: Record<string, any[]> = {}

// 临时导出空的 Logo 函数
export function getModelLogo(_model: any): string | undefined {
  return undefined
}

export function getModelLogoById(_modelId: string): string | undefined {
  return undefined
}
