/**
 * IPC 매개변수검증
 * 사용 Zod 행실행행시타입 검증，방지주입공격클릭및유효하지 않음데이터
 */

import { z } from 'zod'
import { Result, Err, Ok } from '../../shared/types/result'
import Logger from '../../shared/utils/logger'

/**
 * 설정관련의검증 schemas
 */
export const SettingsSchemas = {
  get: z.object({
    key: z.string().min(1, '설정키비어 있을 수 없습니다')
  }),

  set: z.object({
    key: z.string().min(1, '설정키비어 있을 수 없습니다'),
    value: z.any()
  }),

  update: z.object({
    updates: z.record(z.string(), z.any())
  })
}

/**
 * 노트북관련의검증 schemas
 */
export const NotebookSchemas = {
  createNotebook: z.object({
    title: z.string().min(1, '제목비어 있을 수 없습니다').max(200, '제목아닌초과통과200개문자'),
    description: z.string().max(1000, '설명아닌초과통과1000개문자').optional()
  }),

  updateNotebook: z.object({
    id: z.string().min(1, 'ID 비어 있을 수 없습니다'),
    updates: z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).optional()
    })
  }),

  deleteNotebook: z.object({
    id: z.string().min(1, 'ID 비어 있을 수 없습니다')
  }),

  getNotebook: z.object({
    id: z.string().min(1, 'ID 비어 있을 수 없습니다')
  })
}

/**
 * 노트관련의검증 schemas
 */
export const NoteSchemas = {
  createNote: z.object({
    notebookId: z.string().min(1, { message: '노트북 ID 비어 있을 수 없습니다' }),
    title: z.string().max(200, { message: '제목아닌초과통과200개문자' }),
    content: z.string()
  }),

  getNotes: z.object({
    notebookId: z.string().min(1, '노트북 ID 비어 있을 수 없습니다')
  }),

  getNote: z.object({
    id: z.string().min(1, 'ID 비어 있을 수 없습니다')
  }),

  updateNote: z.object({
    id: z.string().min(1, 'ID 비어 있을 수 없습니다'),
    updates: z.object({
      title: z.string().min(1).max(200).optional(),
      content: z.string().optional()
    })
  }),

  deleteNote: z.object({
    id: z.string().min(1, 'ID 비어 있을 수 없습니다')
  })
}

/**
 * Provider 관련의검증 schemas
 */
export const ProviderSchemas = {
  saveProviderConfig: z.object({
    providerName: z.string().min(1, { message: 'Provider 이름비어 있을 수 없습니다' }),
    config: z.record(z.string(), z.any()),
    enabled: z.boolean()
  }),

  getProviderConfig: z.object({
    providerName: z.string().min(1, 'Provider 이름비어 있을 수 없습니다')
  }),

  deleteProviderConfig: z.object({
    providerName: z.string().min(1, 'Provider 이름비어 있을 수 없습니다')
  }),

  validateProviderConfig: z.object({
    providerName: z.string().min(1, 'Provider 이름비어 있을 수 없습니다'),
    config: z.record(z.string(), z.any())
  }),

  fetchModels: z.object({
    providerName: z.string().min(1, 'Provider 이름비어 있을 수 없습니다'),
    apiKey: z.string().min(1, 'API Key 비어 있을 수 없습니다')
  }),

  getProviderModels: z.object({
    providerName: z.string().min(1, 'Provider 이름비어 있을 수 없습니다')
  })
}

/**
 * 지식 베이스관련의검증 schemas
 */
export const KnowledgeSchemas = {
  addDocument: z.object({
    notebookId: z.string().min(1, '노트북 ID 비어 있을 수 없습니다'),
    options: z.object({
      title: z.string().min(1, '제목비어 있을 수 없습니다'),
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
    notebookId: z.string().min(1, '노트북 ID 비어 있을 수 없습니다'),
    filePath: z.string().min(1, '파일 경로비어 있을 수 없습니다')
  }),

  addDocumentFromUrl: z.object({
    notebookId: z.string().min(1, '노트북 ID 비어 있을 수 없습니다'),
    url: z.string().min(1, '유효하지 않음의 URL')
  }),

  addNote: z.object({
    notebookId: z.string().min(1, '노트북 ID 비어 있을 수 없습니다'),
    noteId: z.string().min(1, '노트 ID 비어 있을 수 없습니다')
  }),

  getDocuments: z.object({
    notebookId: z.string().min(1, '노트북 ID 비어 있을 수 없습니다')
  }),

  getDocument: z.object({
    documentId: z.string().min(1, '문서 ID 비어 있을 수 없습니다')
  }),

  getDocumentChunks: z.object({
    documentId: z.string().min(1, '문서 ID 비어 있을 수 없습니다')
  }),

  deleteDocument: z.object({
    documentId: z.string().min(1, '문서 ID 비어 있을 수 없습니다')
  }),

  reindexDocument: z.object({
    documentId: z.string().min(1, '문서 ID 비어 있을 수 없습니다')
  }),

  getStats: z.object({
    notebookId: z.string().min(1, '노트북 ID 비어 있을 수 없습니다')
  }),

  openSource: z.object({
    documentId: z.string().min(1, '문서 ID 비어 있을 수 없습니다')
  }),

  search: z.object({
    notebookId: z.string().min(1, '노트북 ID 비어 있을 수 없습니다'),
    query: z.string().min(1, '검색쿼리비어 있을 수 없습니다').max(1000, '검색쿼리아닌초과통과1000개문자'),
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
 * 채팅관련의검증 schemas
 */
export const ChatSchemas = {
  sendMessage: z.object({
    sessionId: z.string().min(1, '세션 ID 비어 있을 수 없습니다'),
    content: z.string().min(1, '메시지내용비어 있을 수 없습니다').max(10000, '메시지내용아닌초과통과10000개문자')
  }),

  createSession: z.object({
    notebookId: z.string().min(1, '노트북 ID 비어 있을 수 없습니다'),
    title: z.string().max(200, '제목아닌초과통과200개문자')
  }),

  getChatSessions: z.object({
    notebookId: z.string().min(1, '노트북 ID 비어 있을 수 없습니다')
  }),

  getActiveSession: z.object({
    notebookId: z.string().min(1, '노트북 ID 비어 있을 수 없습니다')
  }),

  updateSessionTitle: z.object({
    sessionId: z.string().min(1, '세션 ID 비어 있을 수 없습니다'),
    title: z.string().min(1, '제목비어 있을 수 없습니다').max(200, '제목아닌초과통과200개문자')
  }),

  deleteSession: z.object({
    sessionId: z.string().min(1, '세션 ID 비어 있을 수 없습니다')
  }),

  getMessages: z.object({
    sessionId: z.string().min(1, '세션 ID 비어 있을 수 없습니다')
  }),

  abortMessage: z.object({
    messageId: z.string().min(1, '메시지 ID 비어 있을 수 없습니다')
  })
}

/**
 * 검증함수패키지장
 *  IPC handler 패키지장자동검증매개변수의함수
 *
 * @param schema Zod schema
 * @param handler IPC handler 함수
 * @returns 패키지장후의 handler
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
      // 검증입력매개변수
      // IPC 호출전달재귀단일개객체매개변수，아닌예많은개독립즉시매개변수
      if (args.length === 0) {
        throw new Error('IPC 호출에 매개변수 누락')
      }

      if (args.length > 1) {
        throw new Error(
          `IPC 호출 매개변수 오류: 단일 객체 매개변수 전달이 예상되었으나 ${args.length} 개의 매개변수를 수신。요청사용객체형형식호출，예만약: api.createNotebook({title, description})`
        )
      }

      // 사용첫 번째개의 매개변수를 수신행검증
      const validatedArgs = schema.parse(args[0])

      // 호출실제의 handler
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
 * 검증단일개의 매개변수를 수신
 * 적합용도:있는하나개의 매개변수를 수신의간단일 handler
 *
 * @param schema Zod schema
 * @param value 검증의값
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
