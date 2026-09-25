import { eq, desc, and } from 'drizzle-orm'
import { getDatabase, executeCheckpoint, dropNotebookVectorTable } from './index'
import { chatSessions, chatMessages, notebooks, notes, documents, items } from './schema'
import type { ChatMessageMetadata } from '../../shared/types/chat'

// ==================== Chat Sessions ====================

/**
 * 创建新的聊天会话
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
 * 获取指定笔记本的活跃会话（栈顶）
 * 每个笔记本只有一个 active session
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
 * 获取指定笔记本的所有会话
 * 按更新时间倒序排列
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
 * 更新会话标题
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
 * 删除会话
 * 外键级联会自动删除该会话的所有消息
 */
export function deleteSession(sessionId: string) {
  const db = getDatabase()

  try {
    db.delete(chatSessions).where(eq(chatSessions.id, sessionId)).run()

    // 删除会话后执行 checkpoint，确保数据及时持久化
    executeCheckpoint('PASSIVE')
  } catch (error) {
    console.error('[Database] Error deleting session:', error)
    throw error
  }
}

/**
 * 获取单个会话信息
 */
export function getSessionById(sessionId: string) {
  const db = getDatabase()

  return db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).get()
}

/**
 * 更新会话的 token 计数
 */
export function updateSessionTokens(sessionId: string, tokensToAdd: number) {
  const db = getDatabase()

  // 获取当前 token 数
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
 * 更新会话的摘要和状态
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
 * 创建新消息
 */
export function createMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  metadata?: Record<string, unknown>
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

  // 更新会话的 updatedAt
  db.update(chatSessions).set({ updatedAt: now }).where(eq(chatSessions.id, sessionId)).run()

  return message
}

/**
 * 获取指定会话的所有消息
 * 按创建时间顺序排列
 */
export function getMessagesBySession(sessionId: string) {
  const db = getDatabase()

  return db.select().from(chatMessages).where(eq(chatMessages.sessionId, sessionId)).all()
}

/**
 * 更新消息内容
 * 主要用于更新流式消息的完整内容
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

/**
 * 更新消息的结构化元数据。
 *
 * 目前唯一的用途是把「这条回答基于哪些段落」写到助手消息上，
 * 这样回答交付之后仍然可以回到原文（见 shared/types/chat.ts 的 AnswerSource）。
 */
export function updateMessageMetadata(messageId: string, metadata: ChatMessageMetadata) {
  const db = getDatabase()

  db.update(chatMessages).set({ metadata }).where(eq(chatMessages.id, messageId)).run()
}

// ==================== Notebooks ====================

/**
 * 创建新笔记本
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
 * 获取所有笔记本
 * 按更新时间倒序排列
 */
export function getAllNotebooks() {
  const db = getDatabase()
  return db.select().from(notebooks).orderBy(desc(notebooks.updatedAt)).all()
}

/**
 * 根据 ID 获取笔记本
 */
export function getNotebookById(id: string) {
  const db = getDatabase()
  return db.select().from(notebooks).where(eq(notebooks.id, id)).get()
}

/**
 * 更新笔记本
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
 * 删除笔记本
 * 由于外键级联删除，会自动删除该笔记本下的所有会话和消息
 */
export async function deleteNotebook(id: string) {
  const db = getDatabase()

  try {
    // 先获取该笔记本下所有带本地文件的文档
    const docsWithLocalFiles = db
      .select({ localFilePath: documents.localFilePath })
      .from(documents)
      .where(eq(documents.notebookId, id))
      .all()

    // 删除笔记本（外键级联会自动删除所有关联的 sessions、messages 和 documents）
    db.delete(notebooks).where(eq(notebooks.id, id)).run()

    // 级联删除管不到 vec0 虚拟表,单独把该笔记本的向量表和元数据清掉。笔记本行已经
    // 删掉了,所以这里失败只会多占一点磁盘,不会留下读得到半截数据的笔记本。
    try {
      dropNotebookVectorTable(id)
    } catch (error) {
      console.error(`[Database] Failed to drop vector table of notebook ${id}:`, error)
    }

    // 删除本地文件（异步执行，不阻塞数据库操作）
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

    // 执行 checkpoint 确保数据持久化
    executeCheckpoint('PASSIVE')
    console.log(`[Database] Deleted notebook: ${id}`)
  } catch (error) {
    console.error('[Database] Error deleting notebook:', error)
    throw error
  }
}

// ==================== Notes ====================

/**
 * 创建新笔记
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

  // 同步创建 item（添加到列表末尾）
  // 获取当前笔记本的最大 order 值
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
 * 获取指定笔记本的所有笔记
 * 按更新时间倒序排列
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
 * 根据ID获取单个笔记
 */
export function getNoteById(id: string) {
  const db = getDatabase()
  return db.select().from(notes).where(eq(notes.id, id)).get()
}

/**
 * 更新笔记内容
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
 * 删除笔记
 */
export function deleteNote(id: string) {
  const db = getDatabase()

  // 先删除关联的 item
  db.delete(items)
    .where(and(eq(items.type, 'note'), eq(items.resourceId, id)))
    .run()
  console.log(`[Database] Deleted item for note: ${id}`)

  // 删除笔记本身
  db.delete(notes).where(eq(notes.id, id)).run()
  console.log(`[Database] Deleted note: ${id}`)
}
