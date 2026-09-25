/**
 * 共享的类型定义
 * 基于 Drizzle 推导的数据库 schema,确保类型定义的单一数据源
 */

// 导出知识库类型
export * from './knowledge'

// 导出聊天类型
export * from './chat'

// 导出来源阅读器契约类型
export * from './source'

// 导出 Result 错误处理类型
export * from './result'

// 导出答题类型
export * from './quiz'

// 导出 Anki 类型
export * from './anki'

// 导出 Model Connection 类型
export * from './connection'

// 导出 Embedding 类型
export * from './embedding'

/**
 * 笔记本接口
 * 与 Drizzle schema 推导的类型兼容
 */
export interface Notebook {
  id: string
  title: string
  description?: string | null | undefined // 兼容 Drizzle 推导的可选字段
  createdAt: Date
  updatedAt: Date
}

/**
 * 笔记接口
 * 与 Drizzle schema 推导的类型兼容
 */
export interface Note {
  id: string
  notebookId: string
  title: string
  content: string
  createdAt: Date
  updatedAt: Date
}

/**
 * 应用设置接口
 */
export interface AppSettings {
  theme: 'light' | 'dark'
  language: 'zh-CN' | 'en-US'
  autoLaunch: boolean
  hasCompletedOnboarding: boolean
  prompts?: {
    mindMap?: {
      'zh-CN'?: string // 中文思维导图生成提示词
      'en-US'?: string // 英文思维导图生成提示词
    }
    quiz?: {
      'zh-CN'?: string // 中文答题生成提示词
      'en-US'?: string // 英文答题生成提示词
    }
    anki?: {
      'zh-CN'?: string // 中文Anki卡片生成提示词
      'en-US'?: string // 英文Anki卡片生成提示词
    }
  }
}

/**
 * 快捷键动作枚举
 */
export enum ShortcutAction {
  // 笔记本管理
  CREATE_NOTEBOOK = 'create_notebook',
  CLOSE_NOTEBOOK = 'close_notebook',

  // 面板切换
  TOGGLE_KNOWLEDGE_BASE = 'toggle_knowledge_base', // 知识库
  TOGGLE_CREATIVE_SPACE = 'toggle_creative_space', // 创造空间

  // 编辑器
  SAVE_NOTE = 'save_note'
}

/**
 * 快捷键配置接口
 */
export interface ShortcutConfig {
  action: ShortcutAction
  accelerator: string // 如 "CommandOrControl+N"
  enabled: boolean
  description: string // i18n key
}
