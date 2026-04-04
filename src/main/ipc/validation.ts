/**
 * IPC 매개변수 검증
 * Zod를 사용한 런타임 타입 검증, 인젝션 공격 및 유효하지 않은 데이터 방지
 */

import { z } from 'zod'
import { Result, Err, Ok } from '../../shared/types/result'
import Logger from '../../shared/utils/logger'

/**
 * 설정 관련 검증 schemas
 */
export const SettingsSchemas = {
  get: z.object({
    key: z.string().min(1, '설정 키는 비어 있을 수 없습니다')
  }),

  set: z.object({
    key: z.string().min(1, '설정 키는 비어 있을 수 없습니다'),
    value: z.any()
  }),

  update: z.object({
    updates: z.record(z.string(), z.any())
  })
}

/**
 * 노트북 관련 검증 schemas
 */
export const NotebookSchemas = {
  createNotebook: z.object({
    title: z.string().min(1, '제목은 비어 있을 수 없습니다').max(200, '제목은 200자를 초과할 수 없습니다'),
    description: z.string().max(1000, '설명은 1000자를 초과할 수 없습니다').optional()
  }),

  updateNotebook: z.object({
    id: z.string().min(1, 'ID는 비어 있을 수 없습니다'),
    updates: z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).optional()
    })
  }),

  deleteNotebook: z.object({
    id: z.string().min(1, 'ID는 비어 있을 수 없습니다')
  }),

  getNotebook: z.object({
    id: z.string().min(1, 'ID는 비어 있을 수 없습니다')
  })
}

/**
 * 노트 관련 검증 schemas
 */
export const NoteSchemas = {
  createNote: z.object({
    notebookId: z.string().min(1, { message: '노트북 ID는 비어 있을 수 없습니다' }),
    title: z.string().max(200, { message: '제목은 200자를 초과할 수 없습니다' }),
    content: z.string()
  }),

  getNotes: z.object({
    notebookId: z.string().min(1, '노트북 ID는 비어 있을 수 없습니다')
  }),

  getNote: z.object({
    id: z.string().min(1, 'ID는 비어 있을 수 없습니다')
  }),

  updateNote: z.object({
    id: z.string().min(1, 'ID는 비어 있을 수 없습니다'),
    updates: z.object({
      title: z.string().min(1).max(200).optional(),
      content: z.string().optional()
    })
  }),

  deleteNote: z.object({
    id: z.string().min(1, 'ID는 비어 있을 수 없습니다')
  })
}

/**
 * Provider 관련 검증 schemas
 */
export const ProviderSchemas = {
  saveProviderConfig: z.object({
    providerName: z.string().min(1, { message: 'Provider 이름은 비어 있을 수 없습니다' }),
    config: z.record(z.string(), z.any()),
    enabled: z.boolean()
  }),

  getProviderConfig: z.object({
    providerName: z.string().min(1, 'Provider 이름은 비어 있을 수 없습니다')
  }),

  deleteProviderConfig: z.object({
    providerName: z.string().min(1, 'Provider 이름은 비어 있을 수 없습니다')
  }),

  validateProviderConfig: z.object({
    providerName: z.string().min(1, 'Provider 이름은 비어 있을 수 없습니다'),
    config: z.record(z.string(), z.any())
  }),

  fetchModels: z.object({
    providerName: z.string().min(1, 'Provider 이름은 비어 있을 수 없습니다'),
    apiKey: z.string().min(1, 'API Key는 비어 있을 수 없습니다')
  }),

  getProviderModels: z.object({
    providerName: z.string().min(1, 'Provider 이름은 비어 있을 수 없습니다')
  })
}

/**
 * 지식 베이스 관련 검증 schemas
 */
export const KnowledgeSchemas = {
  addDocument: z.object({
    notebookId: z.string().min(1, '노트북 ID는 비어 있을 수 없습니다'),
    options: z.object({
      title: z.string().min(1, '제목은 비어 있을 수 없습니다'),
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
    notebookId: z.string().min(1, '노트북 ID는 비어 있을 수 없습니다'),
    filePath: z.string().min(1, '파일 경로는 비어 있을 수 없습니다')
  }),

  addDocumentFromUrl: z.object({
    notebookId: z.string().min(1, '노트북 ID는 비어 있을 수 없습니다'),
    url: z.string().min(1, '유효하지 않은 URL')
  }),

  addNote: z.object({
    notebookId: z.string().min(1, '노트북 ID는 비어 있을 수 없습니다'),
    noteId: z.string().min(1, '노트 ID는 비어 있을 수 없습니다')
  }),

  getDocuments: z.object({
    notebookId: z.string().min(1, '노트북 ID는 비어 있을 수 없습니다')
  }),

  getDocument: z.object({
    documentId: z.string().min(1, '문서 ID는 비어 있을 수 없습니다')
  }),

  getDocumentChunks: z.object({
    documentId: z.string().min(1, '문서 ID는 비어 있을 수 없습니다')
  }),

  deleteDocument: z.object({
    documentId: z.string().min(1, '문서 ID는 비어 있을 수 없습니다')
  }),

  reindexDocument: z.object({
    documentId: z.string().min(1, '문서 ID는 비어 있을 수 없습니다')
  }),

  getStats: z.object({
    notebookId: z.string().min(1, '노트북 ID는 비어 있을 수 없습니다')
  }),

  openSource: z.object({
    documentId: z.string().min(1, '문서 ID는 비어 있을 수 없습니다')
  }),

  search: z.object({
    notebookId: z.string().min(1, '노트북 ID는 비어 있을 수 없습니다'),
    query: z.string().min(1, '검색 쿼리는 비어 있을 수 없습니다').max(1000, '검색 쿼리는 1000자를 초과할 수 없습니다'),
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
 * 채팅 관련 검증 schemas
 */
export const ChatSchemas = {
  sendMessage: z.object({
    sessionId: z.string().min(1, '세션 ID는 비어 있을 수 없습니다'),
    content: z.string().min(1, '메시지 내용은 비어 있을 수 없습니다').max(10000, '메시지 내용은 10000자를 초과할 수 없습니다')
  }),

  createSession: z.object({
    notebookId: z.string().min(1, '노트북 ID는 비어 있을 수 없습니다'),
    title: z.string().max(200, '제목은 200자를 초과할 수 없습니다')
  }),

  getChatSessions: z.object({
    notebookId: z.string().min(1, '노트북 ID는 비어 있을 수 없습니다')
  }),

  getActiveSession: z.object({
    notebookId: z.string().min(1, '노트북 ID는 비어 있을 수 없습니다')
  }),

  updateSessionTitle: z.object({
    sessionId: z.string().min(1, '세션 ID는 비어 있을 수 없습니다'),
    title: z.string().min(1, '제목은 비어 있을 수 없습니다').max(200, '제목은 200자를 초과할 수 없습니다')
  }),

  deleteSession: z.object({
    sessionId: z.string().min(1, '세션 ID는 비어 있을 수 없습니다')
  }),

  getMessages: z.object({
    sessionId: z.string().min(1, '세션 ID는 비어 있을 수 없습니다')
  }),

  abortMessage: z.object({
    messageId: z.string().min(1, '메시지 ID는 비어 있을 수 없습니다')
  })
}

/**
 * 검증 함수 래퍼
 * IPC handler를 래핑하여 자동으로 매개변수를 검증하는 함수
 *
 * @param schema Zod schema
 * @param handler IPC handler 함수
 * @returns 래핑된 handler
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
      // 입력 매개변수 검증
      // IPC 호출은 단일 객체 매개변수를 전달해야 하며, 여러 개의 독립적인 매개변수가 아닙니다
      if (args.length === 0) {
        throw new Error('IPC 호출에 매개변수 누락')
      }

      if (args.length > 1) {
        throw new Error(
          `IPC 호출 매개변수 오류: 단일 객체 매개변수 전달이 예상되었으나 ${args.length}개의 매개변수를 수신. 객체 형식으로 호출하세요. 예: api.createNotebook({title, description})`
        )
      }

      // 첫 번째 매개변수를 사용하여 검증 수행
      const validatedArgs = schema.parse(args[0])

      // 실제 handler 호출
      return await handler(validatedArgs)
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessage = `검증 실패: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        Logger.error('IPC Validation', errorMessage)
        throw new Error(errorMessage)
      }
      throw error
    }
  }
}

/**
 * 단일 매개변수 검증
 * 단일 매개변수만 있는 간단한 handler에 적합
 *
 * @param schema Zod schema
 * @param value 검증할 값
 * @returns Result 객체
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
      return Err(new Error(`검증 실패: ${errorMessage}`))
    }
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}
