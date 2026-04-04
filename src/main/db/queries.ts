import { eq, desc, and } from 'drizzle-orm'
import { getDatabase, executeCheckpoint } from './index'
import { chatSessions, chatMessages, notebooks, notes, documents, items } from './schema'

// ==================== Chat Sessions ====================

/**
 * 새 채팅 세션 생성
 */
export function createSession(notebookId: string, title: string, parentSessionId?: string) {
  const db = getDatabase()
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const now = new Date()

  const session = db
    .insert(chatSessions)
    .values({
      id,
      notebookId,
      title,
      parentSessionId,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()

  return session
}

/**
 * 지정된 노트북의 활성 세션 조회 (스택 최상위)
 * 각 노트북에는 하나의 active 세션만 존재
 */
export function getActiveSessionByNotebook(notebookId: string) {
  const db = getDatabase()

  return db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.notebookId, notebookId), eq(chatSessions.status, 'active')))
    .get()
}

/**
 * 지정된 노트북의 모든 세션 조회
 * 업데이트 시간 역순으로 정렬
 */
export function getSessionsByNotebook(notebookId: string) {
  const db = getDatabase()

  return db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.notebookId, notebookId))
    .orderBy(desc(chatSessions.updatedAt))
    .all()
}

/**
 * 세션 제목 업데이트
 */
export function updateSessionTitle(sessionId: string, title: string) {
  const db = getDatabase()

  db.update(chatSessions)
    .set({
      title,
      updatedAt: new Date()
    })
    .where(eq(chatSessions.id, sessionId))
    .run()
}

/**
 * 세션 삭제
 * 외래 키 캐스케이드로 해당 세션의 모든 메시지가 자동 삭제됨
 */
export function deleteSession(sessionId: string) {
  const db = getDatabase()

  try {
    db.delete(chatSessions).where(eq(chatSessions.id, sessionId)).run()

    // 세션 삭제 후 checkpoint 실행하여 데이터 적시 영구 저장 보장
    executeCheckpoint('PASSIVE')
  } catch (error) {
    console.error('[Database] Error deleting session:', error)
    throw error
  }
}

/**
 * 단일 세션 정보 조회
 */
export function getSessionById(sessionId: string) {
  const db = getDatabase()

  return db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).get()
}

/**
 * 세션 토큰 카운트 업데이트
 */
export function updateSessionTokens(sessionId: string, tokensToAdd: number) {
  const db = getDatabase()

  // 현재 토큰 수 조회
  const session = getSessionById(sessionId)
  if (!session) return

  const newTotal = (session.totalTokens || 0) + tokensToAdd

  db.update(chatSessions)
    .set({
      totalTokens: newTotal,
      updatedAt: new Date()
    })
    .where(eq(chatSessions.id, sessionId))
    .run()

  return newTotal
}

/**
 * 세션 요약 및 상태 업데이트
 */
export function updateSessionSummary(
  sessionId: string,
  summary: string,
  status: 'active' | 'archived' = 'archived'
) {
  const db = getDatabase()

  db.update(chatSessions)
    .set({
      summary,
      status,
      updatedAt: new Date()
    })
    .where(eq(chatSessions.id, sessionId))
    .run()
}

// ==================== Chat Messages ====================

/**
 * 새 메시지 생성
 */
export function createMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  metadata?: Record<string, any>
) {
  const db = getDatabase()
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const now = new Date()

  const message = db
    .insert(chatMessages)
    .values({
      id,
      sessionId,
      role,
      content,
      metadata,
      createdAt: now
    })
    .returning()
    .get()

  // 세션의 updatedAt 업데이트
  db.update(chatSessions).set({ updatedAt: now }).where(eq(chatSessions.id, sessionId)).run()

  return message
}

/**
 * 지정된 세션의 모든 메시지 조회
 * 생성 시간 순서로 정렬
 */
export function getMessagesBySession(sessionId: string) {
  const db = getDatabase()

  return db.select().from(chatMessages).where(eq(chatMessages.sessionId, sessionId)).all()
}

/**
 * 메시지 내용 업데이트
 * 주로 스트리밍 메시지의 전체 내용 업데이트에 사용
 */
export function updateMessageContent(
  messageId: string,
  content: string,
  reasoningContent?: string
) {
  const db = getDatabase()

  const updateData: any = { content }
  if (reasoningContent !== undefined) {
    updateData.reasoningContent = reasoningContent
  }

  db.update(chatMessages).set(updateData).where(eq(chatMessages.id, messageId)).run()
}

// ==================== Notebooks ====================

/**
 * 새 노트북 생성
 */
export function createNotebook(title: string, description?: string) {
  const db = getDatabase()
  const id = `notebook_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const now = new Date()

  const notebook = db
    .insert(notebooks)
    .values({
      id,
      title,
      description,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()

  console.log(`[Database] Created notebook: ${id}`)
  return notebook
}

/**
 * 모든 노트북 조회
 * 업데이트 시간 역순으로 정렬
 */
export function getAllNotebooks() {
  const db = getDatabase()
  return db.select().from(notebooks).orderBy(desc(notebooks.updatedAt)).all()
}

/**
 * ID로 노트북 조회
 */
export function getNotebookById(id: string) {
  const db = getDatabase()
  return db.select().from(notebooks).where(eq(notebooks.id, id)).get()
}

/**
 * 노트북 업데이트
 */
export function updateNotebook(
  id: string,
  updates: Partial<{ title: string; description: string | null }>
) {
  const db = getDatabase()

  db.update(notebooks)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(notebooks.id, id))
    .run()

  console.log(`[Database] Updated notebook: ${id}`)
}

/**
 * 노트북 삭제
 * 외래 키 캐스케이드 삭제로 해당 노트북의 모든 세션과 메시지가 자동 삭제됨
 */
export async function deleteNotebook(id: string) {
  const db = getDatabase()

  try {
    // 먼저 해당 노트북의 로컬 파일이 있는 모든 문서를 조회
    const docsWithLocalFiles = db
      .select({ localFilePath: documents.localFilePath })
      .from(documents)
      .where(eq(documents.notebookId, id))
      .all()

    // 노트북 삭제 (외래 키 캐스케이드로 모든 관련 세션, 메시지, 문서가 자동 삭제됨)
    db.delete(notebooks).where(eq(notebooks.id, id)).run()

    // 로컬 파일 삭제 (비동기 실행, 데이터베이스 작업을 차단하지 않음)
    if (docsWithLocalFiles.length > 0) {
      const { unlink } = await import('fs/promises')
      for (const doc of docsWithLocalFiles) {
        if (doc.localFilePath) {
          try {
            await unlink(doc.localFilePath)
            console.log(`[Database] Deleted local file: ${doc.localFilePath}`)
          } catch (error) {
            console.error(`[Database] Failed to delete local file: ${doc.localFilePath}`, error)
          }
        }
      }
    }

    // 데이터 영구 저장을 위한 checkpoint 실행
    executeCheckpoint('PASSIVE')
    console.log(`[Database] Deleted notebook: ${id}`)
  } catch (error) {
    console.error('[Database] Error deleting notebook:', error)
    throw error
  }
}

// ==================== Notes ====================

/**
 * 새 노트 생성
 */
export function createNote(notebookId: string, title: string, content: string) {
  const db = getDatabase()
  const id = `note_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const now = new Date()

  const note = db
    .insert(notes)
    .values({
      id,
      notebookId,
      title,
      content,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()

  console.log(`[Database] Created note: ${id}`)

  // item 동기 생성 (목록 맨 끝에 추가)
  // 현재 노트북의 최대 order 값 조회
  const existingItems = db.select().from(items).where(eq(items.notebookId, notebookId)).all()
  const maxOrder = existingItems.reduce((max, item) => Math.max(max, item.order), -1)
  const newOrder = maxOrder + 1

  const itemId = `item-note-${id}`
  db.insert(items)
    .values({
      id: itemId,
      notebookId,
      type: 'note',
      resourceId: id,
      order: newOrder,
      createdAt: now,
      updatedAt: now
    })
    .run()

  console.log(`[Database] Created item for note: ${itemId} with order: ${newOrder}`)

  return note
}

/**
 * 지정된 노트북의 모든 노트 조회
 * 업데이트 시간 역순으로 정렬
 */
export function getNotesByNotebook(notebookId: string) {
  const db = getDatabase()
  return db
    .select()
    .from(notes)
    .where(eq(notes.notebookId, notebookId))
    .orderBy(desc(notes.updatedAt))
    .all()
}

/**
 * ID로 단일 노트 조회
 */
export function getNoteById(id: string) {
  const db = getDatabase()
  return db.select().from(notes).where(eq(notes.id, id)).get()
}

/**
 * 노트 내용 업데이트
 */
export function updateNote(id: string, updates: Partial<{ title: string; content: string }>) {
  const db = getDatabase()
  db.update(notes)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(notes.id, id))
    .run()
  console.log(`[Database] Updated note: ${id}`)
}

/**
 * 노트 삭제
 */
export function deleteNote(id: string) {
  const db = getDatabase()

  // 먼저 관련된 item 삭제
  db.delete(items)
    .where(and(eq(items.type, 'note'), eq(items.resourceId, id)))
    .run()
  console.log(`[Database] Deleted item for note: ${id}`)

  // 노트 자체 삭제
  db.delete(notes).where(eq(notes.id, id)).run()
  console.log(`[Database] Deleted note: ${id}`)
}
