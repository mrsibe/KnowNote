import { eq, desc, and, sql, like } from 'drizzle-orm'
import { getDatabase, executeCheckpoint, dropNotebookVectorTable } from './index'
import { chatSessions, chatMessages, notebooks, notes, documents, items } from './schema'
import { deriveSessionTitle } from '../../shared/utils/sessionTitle'
import type {
  ChatMessageMetadata,
  ChatExecutionOutcome,
  ChatExecutionStatus,
  ChatTokenUsage
} from '../../shared/types/chat'
import type { RetrievalScope } from '../../shared/types/scope'
import type { WorkspaceOverview } from '../../shared/types/workspace'

// ==================== Chat Sessions ====================

/**
 * 创建新的聊天会话（#97）。
 *
 * `title` 允许为空：会话先以一个占位标题出现，第一条用户消息到达时由
 * `deriveSessionTitleIfAuto` 推导出真正的标题。`titleIsAuto` 记录「还没被用户
 * 或推导改过」，手动改名会把它置为 false。
 */
export function createSession(
  notebookId: string,
  title: string,
  options: { parentSessionId?: string; titleIsAuto?: boolean } = {}
) {
  const db = getDatabase()
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const now = new Date()

  const session = db
    .insert(chatSessions)
    .values({
      id,
      notebookId,
      title,
      titleIsAuto: options.titleIsAuto ?? false,
      parentSessionId: options.parentSessionId,
      // Newly created is newly opened: it is where the notebook returns to.
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()

  return session
}

/**
 * 打开笔记本时要回到的会话（#97）。
 *
 * 多个会话可以有同一个 `status`，所以「active」不再能唯一定位一个会话；这里按
 * 「最近打开」排序，NULL（旧数据）退回 `updatedAt`。旧笔记本只有一个会话，两条路径
 * 都指向它，迁移因此无感。
 */
export function getMostRecentSessionByNotebook(notebookId: string) {
  const db = getDatabase()

  return db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.notebookId, notebookId))
    .orderBy(desc(sql`coalesce(${chatSessions.lastOpenedAt}, ${chatSessions.updatedAt})`))
    .limit(1)
    .get()
}

/**
 * 获取指定笔记本的所有会话（#97）。
 * 最近打开的在前；旧数据没有 lastOpenedAt，退回更新时间。
 */
export function getSessionsByNotebook(notebookId: string) {
  const db = getDatabase()

  return db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.notebookId, notebookId))
    .orderBy(
      desc(sql`coalesce(${chatSessions.lastOpenedAt}, ${chatSessions.updatedAt})`),
      desc(chatSessions.updatedAt)
    )
    .all()
}

/**
 * 记录用户打开了某个会话（#97）。切换会话本身不写消息，所以要单独记一笔，
 * 否则「上次用的是哪个」只能靠最后一条消息猜。
 */
export function touchSession(sessionId: string) {
  const db = getDatabase()

  db.update(chatSessions)
    .set({ lastOpenedAt: new Date() })
    .where(eq(chatSessions.id, sessionId))
    .run()
}

/**
 * 更新会话标题。用户手动改名后，自动推导不再覆盖（`titleIsAuto` 置 false）。
 */
export function updateSessionTitle(sessionId: string, title: string) {
  const db = getDatabase()

  db.update(chatSessions)
    .set({
      title,
      titleIsAuto: false,
      updatedAt: new Date()
    })
    .where(eq(chatSessions.id, sessionId))
    .run()
}

/**
 * 第一条用户消息到达后，用消息内容给还带着占位标题的会话命名（#97）。
 *
 * 只写一次：`titleIsAuto` 是「还没被命名」，不是「标题是自动生成的」；用户手动
 * 改过名就永远是 false，不会被下一条消息覆盖。
 */
export function deriveSessionTitleIfAuto(sessionId: string, firstMessage: string) {
  const db = getDatabase()
  const session = getSessionById(sessionId)
  if (!session?.titleIsAuto) return session ?? null

  const title = deriveSessionTitle(firstMessage)
  if (!title) return session

  db.update(chatSessions)
    .set({ title, titleIsAuto: false, updatedAt: new Date() })
    .where(eq(chatSessions.id, sessionId))
    .run()

  return { ...session, title, titleIsAuto: false }
}

/**
 * 在笔记本内按消息内容搜索（#97）。
 *
 * 搜的是消息正文而不是会话标题：标题只是一个标签，真正要找的是「我在哪次对话里
 * 问过这件事」。返回消息连同它属于哪个会话，列表才能显示每一条命中来自哪里。
 */
export function searchMessagesInNotebook(notebookId: string, query: string, limit = 20) {
  const db = getDatabase()
  // `%` / `_` in the query act as LIKE wildcards: a search box may be loose, and
  // SQLite has no ESCAPE clause here to make an escaped backslash mean anything.
  const pattern = `%${query}%`

  return db
    .select({
      id: chatMessages.id,
      sessionId: chatMessages.sessionId,
      sessionTitle: chatSessions.title,
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt
    })
    .from(chatMessages)
    .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
    .where(and(eq(chatSessions.notebookId, notebookId), like(chatMessages.content, pattern)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit)
    .all()
}

/**
 * 更新会话的检索范围（#94）。
 *
 * 存 JSON 而不是拆成列：三种 scope 形状不同，将来还会加（例如按 note 检索）。
 */
export function updateSessionRetrievalScope(sessionId: string, scope: RetrievalScope) {
  const db = getDatabase()

  db.update(chatSessions)
    .set({ retrievalScope: scope, updatedAt: new Date() })
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
 * 笔记本里有多少个会话（#97）。自动切换用它给续接会话编号。
 */
export function countSessionsByNotebook(notebookId: string): number {
  const db = getDatabase()
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(chatSessions)
    .where(eq(chatSessions.notebookId, notebookId))
    .get()
  return row?.count ?? 0
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
 *
 * `status` 只由 assistant 的一轮对话写入（见 #138）：用户消息没有 execution，
 * 所以保持 NULL，而 NULL 的含义是「没有这个字段」，不是 `completed`。
 */
export function createMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  options: {
    metadata?: Record<string, unknown>
    status?: ChatExecutionStatus
    /** The first attempt at this question, when this row is another one (#151). */
    attemptOf?: string
  } = {}
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
      metadata: options.metadata,
      status: options.status,
      attemptOf: options.attemptOf,
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
/** One message by id, for the turns that answer an existing question again (#151). */
export function getMessageById(messageId: string) {
  const db = getDatabase()

  return db.select().from(chatMessages).where(eq(chatMessages.id, messageId)).get()
}

export function updateMessageMetadata(messageId: string, metadata: ChatMessageMetadata) {
  const db = getDatabase()

  db.update(chatMessages).set({ metadata }).where(eq(chatMessages.id, messageId)).run()
}

/**
 * 写入一轮对话的最终状态（#138 / #139）。
 *
 * 一个回合只能有一个 terminal outcome，写在这里的那一个就是事实：`status` 是
 * KnowNote 的产品语义（对话里怎么显示这一轮），`finishReason` 是 provider 的原话，
 * 两者分开存 —— provider 可以以产品必须解释的方式结束（`length` 是“回答不完整”，
 * 不是失败），一个回合也可以完全没有 provider 的结束语（连接断了）。
 *
 * `error` 只在 `failed` 时写入：其它状态带着一个陈旧的错误比不带更误导。
 *
 * 这里是唯一写 terminal 状态的地方 —— 调用方必须先落库、再告诉 renderer
 * （见 epic #138 的 invariant 4）。
 */
export function finishMessageTurn(
  messageId: string,
  outcome: ChatExecutionOutcome,
  finishReason: string | undefined,
  usage: ChatTokenUsage | undefined
): void {
  const db = getDatabase()

  db.update(chatMessages)
    .set({
      status: outcome.status,
      finishReason: finishReason ?? null,
      error: outcome.status === 'failed' ? outcome.error : null,
      usage: usage ?? null,
      finishedAt: new Date()
    })
    .where(eq(chatMessages.id, messageId))
    .run()
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
    // 删除笔记本（外键级联会自动删除所有关联的 sessions、messages 和 documents）
    db.delete(notebooks).where(eq(notebooks.id, id)).run()

    // 级联删除管不到 vec0 虚拟表,单独把该笔记本的向量表和元数据清掉。笔记本行已经
    // 删掉了,所以这里失败只会多占一点磁盘,不会留下读得到半截数据的笔记本。
    try {
      dropNotebookVectorTable(id)
    } catch (error) {
      console.error(`[Database] Failed to drop vector table of notebook ${id}:`, error)
    }

    // 本地文件归库 snapshot（library_sources）所有，可能还被别的 notebook 复用（#99）。
    // 删除 notebook 只解除挂载，绝不 unlink；库文件的生命周期由显式删除 snapshot 管理。

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

// ==================== Workspace Overview ====================

/**
 * Everything the Home page reads, in one round trip (#65).
 *
 * Three statements rather than a request per notebook: Home is opened constantly
 * and an N+1 over the notebook list grows with the library. The source counts are
 * one `GROUP BY` merged in JS rather than a correlated subquery per notebook, so
 * the number of statements does not depend on how many notebooks exist.
 *
 * `recentDocuments` orders by `created_at`, which no index covers — the only
 * document index is `(notebook_id, updated_at)`. A local SQLite sorting a few
 * thousand rows to take 20 is not worth a migration; if the library ever gets big
 * enough for that to show, the index is the fix, not a rewrite of this query.
 */
export function getWorkspaceOverview(
  options: { notebookLimit?: number; documentLimit?: number; sessionLimit?: number } = {}
): WorkspaceOverview {
  const db = getDatabase()

  const rows = db
    .select()
    .from(notebooks)
    .orderBy(desc(notebooks.updatedAt))
    .limit(options.notebookLimit ?? 200)
    .all()

  const counts = db
    .select({ notebookId: documents.notebookId, count: sql<number>`count(*)` })
    .from(documents)
    .groupBy(documents.notebookId)
    .all()
  const countByNotebook = new Map(counts.map((row) => [row.notebookId, row.count]))

  const recentDocuments = db
    .select({
      id: documents.id,
      notebookId: documents.notebookId,
      notebookTitle: notebooks.title,
      title: documents.title,
      type: documents.type,
      mimeType: documents.mimeType,
      sourceUri: documents.sourceUri,
      localFilePath: documents.localFilePath,
      createdAt: documents.createdAt
    })
    .from(documents)
    .innerJoin(notebooks, eq(documents.notebookId, notebooks.id))
    .orderBy(desc(documents.createdAt))
    .limit(options.documentLimit ?? 20)
    .all()

  const recentSessions = db
    .select({
      id: chatSessions.id,
      notebookId: chatSessions.notebookId,
      notebookTitle: notebooks.title,
      title: chatSessions.title,
      updatedAt: chatSessions.updatedAt
    })
    .from(chatSessions)
    .innerJoin(notebooks, eq(chatSessions.notebookId, notebooks.id))
    .where(eq(chatSessions.status, 'active'))
    .orderBy(desc(chatSessions.updatedAt))
    .limit(options.sessionLimit ?? 5)
    .all()

  return {
    notebooks: rows.map((row) => ({ ...row, sourceCount: countByNotebook.get(row.id) ?? 0 })),
    recentDocuments,
    recentSessions
  }
}
