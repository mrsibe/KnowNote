/**
 * IPC 参数验证
 * 使用 Zod 进行运行时类型验证，防止注入攻击和无效数据
 */

import { z } from 'zod'
import { API_PROTOCOLS, MODEL_CAPABILITIES } from '../../shared/types'
import { Result, Err, Ok } from '../../shared/types/result'
import Logger from '../../shared/utils/logger'

/**
 * 设置相关的验证 schemas
 */
export const SettingsSchemas = {
  get: z.object({
    key: z.string().min(1, '设置键不能为空')
  }),

  set: z.object({
    key: z.string().min(1, '设置键不能为空'),
    value: z.any()
  }),

  update: z.object({
    updates: z.record(z.string(), z.any())
  })
}

/**
 * 笔记本相关的验证 schemas
 */
export const NotebookSchemas = {
  createNotebook: z.object({
    title: z.string().min(1, '标题不能为空').max(200, '标题不能超过200个字符'),
    description: z.string().max(1000, '描述不能超过1000个字符').optional()
  }),

  updateNotebook: z.object({
    id: z.string().min(1, 'ID 不能为空'),
    updates: z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).optional()
    })
  }),

  deleteNotebook: z.object({
    id: z.string().min(1, 'ID 不能为空')
  }),

  getNotebook: z.object({
    id: z.string().min(1, 'ID 不能为空')
  })
}

/**
 * 笔记相关的验证 schemas
 */
export const NoteSchemas = {
  createNote: z.object({
    notebookId: z.string().min(1, { message: '笔记本 ID 不能为空' }),
    title: z.string().max(200, { message: '标题不能超过200个字符' }),
    content: z.string()
  }),

  getNotes: z.object({
    notebookId: z.string().min(1, '笔记本 ID 不能为空')
  }),

  getNote: z.object({
    id: z.string().min(1, 'ID 不能为空')
  }),

  updateNote: z.object({
    id: z.string().min(1, 'ID 不能为空'),
    updates: z.object({
      title: z.string().min(1).max(200).optional(),
      content: z.string().optional()
    })
  }),

  deleteNote: z.object({
    id: z.string().min(1, 'ID 不能为空')
  })
}

/**
 * Model Connection 相关的验证 schemas
 */
export const ConnectionSchemas = {
  saveConnection: z.object({
    capability: z.enum(MODEL_CAPABILITIES),
    connection: z.object({
      protocol: z.enum(API_PROTOCOLS),
      baseUrl: z.string().min(1, 'Base URL 不能为空'),
      apiKey: z.string(),
      modelId: z.string().min(1, 'Model ID 不能为空')
    })
  }),

  deleteConnection: z.object({
    capability: z.enum(MODEL_CAPABILITIES)
  }),

  testConnection: z.object({
    connection: z.object({
      protocol: z.enum(API_PROTOCOLS),
      baseUrl: z.string().min(1, 'Base URL 不能为空'),
      apiKey: z.string(),
      modelId: z.string()
    })
  }),

  fetchModels: z.object({
    connection: z.object({
      protocol: z.enum(API_PROTOCOLS),
      baseUrl: z.string().min(1, 'Base URL 不能为空'),
      apiKey: z.string(),
      modelId: z.string()
    })
  })
}

/**
 * 知识库相关的验证 schemas
 */
export const KnowledgeSchemas = {
  addDocument: z.object({
    notebookId: z.string().min(1, '笔记本 ID 不能为空'),
    options: z.object({
      title: z.string().min(1, '标题不能为空'),
      type: z.enum(['file', 'note', 'url', 'text']),
      content: z.string(),
      sourceUri: z.string().optional(),
      sourceNoteId: z.string().optional(),
      mimeType: z.string().optional(),
      fileSize: z.number().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
      chunkOptions: z.any().optional()
    })
  }),

  addDocumentFromFile: z.object({
    notebookId: z.string().min(1, '笔记本 ID 不能为空'),
    filePath: z.string().min(1, '文件路径不能为空')
  }),

  addDocumentFromUrl: z.object({
    notebookId: z.string().min(1, '笔记本 ID 不能为空'),
    url: z.string().min(1, '无效的 URL')
  }),

  addNote: z.object({
    notebookId: z.string().min(1, '笔记本 ID 不能为空'),
    noteId: z.string().min(1, '笔记 ID 不能为空')
  }),

  getDocuments: z.object({
    notebookId: z.string().min(1, '笔记本 ID 不能为空')
  }),

  getDocument: z.object({
    documentId: z.string().min(1, '文档 ID 不能为空')
  }),

  getDocumentChunks: z.object({
    documentId: z.string().min(1, '文档 ID 不能为空')
  }),

  deleteDocument: z.object({
    documentId: z.string().min(1, '文档 ID 不能为空')
  }),

  reindexDocument: z.object({
    documentId: z.string().min(1, '文档 ID 不能为空')
  }),

  getStats: z.object({
    notebookId: z.string().min(1, '笔记本 ID 不能为空')
  }),

  openSource: z.object({
    documentId: z.string().min(1, '文档 ID 不能为空')
  }),

  search: z.object({
    notebookId: z.string().min(1, '笔记本 ID 不能为空'),
    query: z.string().min(1, '搜索查询不能为空').max(1000, '搜索查询不能超过1000个字符'),
    options: z
      .object({
        topK: z.number().int().min(1).max(100).optional(),
        threshold: z.number().min(0).max(1).optional(),
        includeContent: z.boolean().optional()
      })
      .optional()
  })
}

/**
 * 聊天相关的验证 schemas
 */
export const ChatSchemas = {
  sendMessage: z.object({
    sessionId: z.string().min(1, '会话 ID 不能为空'),
    content: z.string().min(1, '消息内容不能为空').max(10000, '消息内容不能超过10000个字符')
  }),

  createSession: z.object({
    notebookId: z.string().min(1, '笔记本 ID 不能为空'),
    title: z.string().max(200, '标题不能超过200个字符')
  }),

  getChatSessions: z.object({
    notebookId: z.string().min(1, '笔记本 ID 不能为空')
  }),

  getActiveSession: z.object({
    notebookId: z.string().min(1, '笔记本 ID 不能为空')
  }),

  updateSessionTitle: z.object({
    sessionId: z.string().min(1, '会话 ID 不能为空'),
    title: z.string().min(1, '标题不能为空').max(200, '标题不能超过200个字符')
  }),

  deleteSession: z.object({
    sessionId: z.string().min(1, '会话 ID 不能为空')
  }),

  getMessages: z.object({
    sessionId: z.string().min(1, '会话 ID 不能为空')
  }),

  abortMessage: z.object({
    messageId: z.string().min(1, '消息 ID 不能为空')
  })
}

/**
 * 验证函数包装器
 * 将 IPC handler 包装为自动验证参数的函数
 *
 * @param schema Zod schema
 * @param handler IPC handler 函数
 * @returns 包装后的 handler
 *
 * @example
 * ```ts
 * ipcMain.handle('create-notebook',
 *   validate(NotebookSchemas.createNotebook, async (args) => {
 *     return createNotebook(args.title, args.description)
 *   })
 * )
 * ```
 */
export function validate<TSchema extends z.ZodType, TResult>(
  schema: TSchema,
  handler: (args: z.infer<TSchema>) => Promise<TResult>
): (_event: Electron.IpcMainInvokeEvent, ...args: any[]) => Promise<TResult> {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: any[]): Promise<TResult> => {
    try {
      // 验证输入参数
      // IPC 调用应该传递单个对象参数，而不是多个独立参数
      if (args.length === 0) {
        throw new Error('IPC 调用缺少参数')
      }

      if (args.length > 1) {
        throw new Error(
          `IPC 调用参数错误: 期望传递单个对象参数，但收到 ${args.length} 个参数。请使用对象形式调用，例如: api.createNotebook({title, description})`
        )
      }

      // 使用第一个参数进行验证
      const validatedArgs = schema.parse(args[0])

      // 调用实际的 handler
      return await handler(validatedArgs)
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessage = `验证失败: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        Logger.error('IPC Validation', errorMessage)
        throw new Error(errorMessage)
      }
      throw error
    }
  }
}

/**
 * 验证单个参数
 * 适用于只有一个参数的简单 handler
 *
 * @param schema Zod schema
 * @param value 要验证的值
 * @returns Result 对象
 *
 * @example
 * ```ts
 * const result = validateParam(z.string().min(1), userId)
 * if (!result.success) {
 *   throw new Error(result.error.message)
 * }
 * ```
 */
export function validateParam<T>(schema: z.ZodType<T>, value: unknown): Result<T> {
  try {
    const validated = schema.parse(value)
    return Ok(validated)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
      return Err(new Error(`验证失败: ${errorMessage}`))
    }
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}
