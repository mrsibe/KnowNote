import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import type { QuizQuestion } from '../../shared/types/quiz'

/**
 * 笔记本表
 * 用于存储用户创建的笔记本
 */
export const notebooks = sqliteTable(
  'notebooks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // 优化按更新时间查询笔记本的性能
    updatedIdx: index('idx_notebooks_updated').on(table.updatedAt)
  })
)

/**
 * 聊天会话表
 * 用于存储每个笔记本下的聊天会话
 */
export const chatSessions = sqliteTable(
  'chat_sessions',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // 自动切换 session 相关字段
    summary: text('summary'), // 之前会话的摘要（如果是自动切换生成的）
    totalTokens: integer('total_tokens').notNull().default(0), // 当前会话累计 token 数
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'), // 会话状态
    parentSessionId: text('parent_session_id').references(() => chatSessions.id, {
      onDelete: 'set null'
    }), // 指向上一个被切换的 session
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // 优化按笔记本查询会话的性能
    notebookIdx: index('idx_sessions_notebook').on(table.notebookId, table.updatedAt)
  })
)

/**
 * 聊天消息表
 * 存储每个会话中的所有消息（用户消息和AI回复）
 */
export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    reasoningContent: text('reasoning_content'), // DeepSeek Reasoner 推理过程内容
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // 优化按会话查询消息的性能
    sessionIdx: index('idx_messages_session').on(table.sessionId, table.createdAt)
  })
)

/**
 * TypeScript 类型导出（从 Drizzle Schema 推导）
 */
export type Notebook = typeof notebooks.$inferSelect
export type NewNotebook = typeof notebooks.$inferInsert

export type ChatSession = typeof chatSessions.$inferSelect
export type NewChatSession = typeof chatSessions.$inferInsert

export type ChatMessage = typeof chatMessages.$inferSelect
export type NewChatMessage = typeof chatMessages.$inferInsert

/**
 * 笔记表
 * 存储每个笔记本下的笔记
 */
export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // 优化按笔记本查询笔记的性能
    notebookIdx: index('idx_notes_notebook').on(table.notebookId, table.updatedAt)
  })
)

export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert

// ==================== RAG 相关表 ====================

/**
 * 知识库文档表
 * 存储上传的文档元信息（知识来源）
 */
export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    type: text('type', { enum: ['file', 'note', 'url', 'text'] }).notNull(),
    sourceUri: text('source_uri'), // 原始文件路径或 URL
    localFilePath: text('local_file_path'), // 本地拷贝文件路径
    sourceNoteId: text('source_note_id').references(() => notes.id, { onDelete: 'set null' }),
    content: text('content'), // 原始内容（可选存储）
    contentHash: text('content_hash'), // 内容哈希，用于检测变更
    mimeType: text('mime_type'), // 文件类型
    fileSize: integer('file_size'), // 文件大小（字节）
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    status: text('status', { enum: ['pending', 'processing', 'indexed', 'failed'] })
      .notNull()
      .default('pending'),
    errorMessage: text('error_message'),
    chunkCount: integer('chunk_count').default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    notebookIdx: index('idx_documents_notebook').on(table.notebookId, table.updatedAt),
    statusIdx: index('idx_documents_status').on(table.status)
  })
)

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert

/**
 * 文档分块表
 * 存储分块后的文本内容（RAG 的最小知识单元）
 */
export const chunks = sqliteTable(
  'chunks',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    chunkIndex: integer('chunk_index').notNull(), // 在文档中的顺序
    startOffset: integer('start_offset'), // 原文起始位置
    endOffset: integer('end_offset'), // 原文结束位置
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    tokenCount: integer('token_count'), // token 估算值
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    documentIdx: index('idx_chunks_document').on(table.documentId),
    notebookIdx: index('idx_chunks_notebook').on(table.notebookId)
  })
)

export type Chunk = typeof chunks.$inferSelect
export type NewChunk = typeof chunks.$inferInsert

/**
 * 向量嵌入表（元数据）
 * 存储 chunk 的向量元信息，实际向量存储在 vec0 虚拟表中
 */
export const embeddings = sqliteTable(
  'embeddings',
  {
    id: text('id').primaryKey(),
    chunkId: text('chunk_id')
      .notNull()
      .references(() => chunks.id, { onDelete: 'cascade' }),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    model: text('model').notNull(), // embedding 模型名称
    dimensions: integer('dimensions').notNull(), // 向量维度
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    chunkIdx: index('idx_embeddings_chunk').on(table.chunkId),
    notebookIdx: index('idx_embeddings_notebook').on(table.notebookId),
    modelIdx: index('idx_embeddings_model').on(table.model)
  })
)

export type Embedding = typeof embeddings.$inferSelect
export type NewEmbedding = typeof embeddings.$inferInsert

/**
 * 思维导图表
 * 存储笔记本的派生知识结构
 */
export const mindMaps = sqliteTable(
  'mind_maps',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    version: integer('version').notNull().default(1), // 版本号
    treeData: text('tree_data', { mode: 'json' }).notNull(), // 树结构
    chunkMapping: text('chunk_mapping', { mode: 'json' }).notNull(), // 节点ID -> chunk IDs映射
    metadata: text('metadata', { mode: 'json' }).$type<{
      model: string
      totalNodes: number
      maxDepth: number
      generationTime: number
    }>(),
    status: text('status', { enum: ['generating', 'completed', 'failed'] })
      .notNull()
      .default('generating'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    notebookIdx: index('idx_mindmaps_notebook').on(table.notebookId, table.updatedAt),
    versionIdx: index('idx_mindmaps_version').on(table.notebookId, table.version)
  })
)

export type MindMap = typeof mindMaps.$inferSelect
export type NewMindMap = typeof mindMaps.$inferInsert

/**
 * 题库表
 * 存储笔记本的答题题库
 */
export const quizzes = sqliteTable(
  'quizzes',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    version: integer('version').notNull().default(1), // 版本号
    questionsData: text('questions_data', { mode: 'json' }).$type<QuizQuestion[]>().notNull(), // 题目数组
    chunkMapping: text('chunk_mapping', { mode: 'json' }).notNull(), // questionId -> chunkIds映射
    metadata: text('metadata', { mode: 'json' }).$type<{
      model: string
      totalQuestions: number
      generationTime: number
    }>(),
    status: text('status', { enum: ['generating', 'completed', 'failed'] })
      .notNull()
      .default('generating'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    notebookIdx: index('idx_quizzes_notebook').on(table.notebookId, table.updatedAt),
    versionIdx: index('idx_quizzes_version').on(table.notebookId, table.version)
  })
)

export type Quiz = typeof quizzes.$inferSelect
export type NewQuiz = typeof quizzes.$inferInsert

/**
 * 答题会话表
 * 存储用户的答题记录
 */
export const quizSessions = sqliteTable(
  'quiz_sessions',
  {
    id: text('id').primaryKey(),
    quizId: text('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    answers: text('answers', { mode: 'json' }).$type<Record<string, number>>(), // questionId -> answerIndex
    score: integer('score'),
    totalQuestions: integer('total_questions').notNull(),
    correctCount: integer('correct_count'),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    quizIdx: index('idx_quiz_sessions_quiz').on(table.quizId, table.createdAt),
    notebookIdx: index('idx_quiz_sessions_notebook').on(table.notebookId, table.createdAt)
  })
)

export type QuizSession = typeof quizSessions.$inferSelect
export type NewQuizSession = typeof quizSessions.$inferInsert

/**
 * Anki卡片表
 * 存储笔记本的Anki卡片集
 */
export const ankiCards = sqliteTable(
  'anki_cards',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    version: integer('version').notNull().default(1), // 版本号
    cardsData: text('cards_data', { mode: 'json' }).notNull(), // 卡片数组
    chunkMapping: text('chunk_mapping', { mode: 'json' }).notNull(), // cardId -> chunkIds映射
    metadata: text('metadata', { mode: 'json' }).$type<{
      model: string
      totalCards: number
      cardTypes: string[]
      generationTime: number
    }>(),
    status: text('status', { enum: ['generating', 'completed', 'failed'] })
      .notNull()
      .default('generating'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    notebookIdx: index('idx_ankicards_notebook').on(table.notebookId, table.updatedAt),
    versionIdx: index('idx_ankicards_version').on(table.notebookId, table.version)
  })
)

export type AnkiCard = typeof ankiCards.$inferSelect
export type NewAnkiCard = typeof ankiCards.$inferInsert

/**
 * Items 表
 * 统一管理笔记本下的所有内容项（笔记、思维导图、PPT、音频等）
 */
export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    type: text('type', {
      enum: ['note', 'mindmap', 'quiz', 'anki', 'ppt', 'audio', 'video']
    }).notNull(),
    resourceId: text('resource_id').notNull(), // 指向实际资源的 ID (notes.id, mindMaps.id 等)
    order: integer('order').notNull().default(0), // 排序，数值越小越靠前
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // 优化按笔记本查询并排序的性能
    notebookOrderIdx: index('idx_items_notebook_order').on(table.notebookId, table.order),
    // 优化按类型查询的性能
    typeIdx: index('idx_items_type').on(table.type),
    // 优化按资源 ID 查找对应 item 的性能
    resourceIdx: index('idx_items_resource').on(table.type, table.resourceId)
  })
)

export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert
