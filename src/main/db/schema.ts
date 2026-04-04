import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

/**
 * 노트북 테이블
 * 사용자가 생성한 노트북을 저장
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
    // 업데이트 시간별 노트북 조회 성능 최적화
    updatedIdx: index('idx_notebooks_updated').on(table.updatedAt)
  })
)

/**
 * 채팅 세션 테이블
 * 각 노트북 하위의 채팅 세션을 저장
 */
export const chatSessions = sqliteTable(
  'chat_sessions',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // 자동 세션 전환 관련 필드
    summary: text('summary'), // 이전 세션의 요약 (자동 전환으로 생성된 경우)
    totalTokens: integer('total_tokens').notNull().default(0), // 현재 세션 누적 토큰 수
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'), // 세션 상태
    parentSessionId: text('parent_session_id').references(() => chatSessions.id, {
      onDelete: 'set null'
    }), // 이전에 전환된 세션을 가리킴
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // 노트북별 세션 조회 성능 최적화
    notebookIdx: index('idx_sessions_notebook').on(table.notebookId, table.updatedAt)
  })
)

/**
 * 채팅 메시지 테이블
 * 각 세션의 모든 메시지를 저장 (사용자 메시지 및 AI 응답)
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
    reasoningContent: text('reasoning_content'), // DeepSeek Reasoner 추론 과정 내용
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // 세션별 메시지 조회 성능 최적화
    sessionIdx: index('idx_messages_session').on(table.sessionId, table.createdAt)
  })
)

/**
 * TypeScript 타입 내보내기 (Drizzle 스키마에서 추론)
 */
export type Notebook = typeof notebooks.$inferSelect
export type NewNotebook = typeof notebooks.$inferInsert

export type ChatSession = typeof chatSessions.$inferSelect
export type NewChatSession = typeof chatSessions.$inferInsert

export type ChatMessage = typeof chatMessages.$inferSelect
export type NewChatMessage = typeof chatMessages.$inferInsert

/**
 * 노트 테이블
 * 각 노트북 하위의 노트를 저장
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
    // 노트북별 노트 조회 성능 최적화
    notebookIdx: index('idx_notes_notebook').on(table.notebookId, table.updatedAt)
  })
)

export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert

// ==================== RAG 관련 테이블 ====================

/**
 * 지식 베이스 문서 테이블
 * 업로드된 문서 메타 정보를 저장 (지식 소스)
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
    sourceUri: text('source_uri'), // 원본 파일 경로 또는 URL
    localFilePath: text('local_file_path'), // 로컬 복사 파일 경로
    sourceNoteId: text('source_note_id').references(() => notes.id, { onDelete: 'set null' }),
    content: text('content'), // 원본 내용 (선택적 저장)
    contentHash: text('content_hash'), // 내용 해시, 변경 감지용
    mimeType: text('mime_type'), // 파일 타입
    fileSize: integer('file_size'), // 파일 크기 (바이트)
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>(),
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
 * 문서 청크 테이블
 * 분할된 텍스트 내용을 저장 (RAG의 최소 지식 단위)
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
    chunkIndex: integer('chunk_index').notNull(), // 문서 내 순서
    startOffset: integer('start_offset'), // 원문 시작 위치
    endOffset: integer('end_offset'), // 원문 종료 위치
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>(),
    tokenCount: integer('token_count'), // 토큰 추정값
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
 * 벡터 임베딩 테이블 (메타데이터)
 * 청크의 벡터 메타 정보를 저장, 실제 벡터는 vec0 가상 테이블에 저장
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
    model: text('model').notNull(), // 임베딩 모델 이름
    dimensions: integer('dimensions').notNull(), // 벡터 차원
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
 * 마인드맵 테이블
 * 노트북의 파생 지식 구조를 저장
 */
export const mindMaps = sqliteTable(
  'mind_maps',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    version: integer('version').notNull().default(1), // 버전 번호
    treeData: text('tree_data', { mode: 'json' }).notNull(), // 트리 구조
    chunkMapping: text('chunk_mapping', { mode: 'json' }).notNull(), // 노드 ID -> 청크 ID 매핑
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
 * 문제은행 테이블
 * 노트북의 퀴즈 문제은행을 저장
 */
export const quizzes = sqliteTable(
  'quizzes',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    version: integer('version').notNull().default(1), // 버전 번호
    questionsData: text('questions_data', { mode: 'json' }).notNull(), // 문제 배열
    chunkMapping: text('chunk_mapping', { mode: 'json' }).notNull(), // questionId -> chunkIds 매핑
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
 * 퀴즈 세션 테이블
 * 사용자의 퀴즈 기록을 저장
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
 * Anki 카드 테이블
 * 노트북의 Anki 카드 세트를 저장
 */
export const ankiCards = sqliteTable(
  'anki_cards',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    version: integer('version').notNull().default(1), // 버전 번호
    cardsData: text('cards_data', { mode: 'json' }).notNull(), // 카드 배열
    chunkMapping: text('chunk_mapping', { mode: 'json' }).notNull(), // cardId -> chunkIds 매핑
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
 * Items 테이블
 * 노트북 하위의 모든 콘텐츠 항목을 통합 관리 (노트, 마인드맵, PPT, 오디오 등)
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
    resourceId: text('resource_id').notNull(), // 실제 리소스 ID를 가리킴 (notes.id, mindMaps.id 등)
    order: integer('order').notNull().default(0), // 정렬, 값이 작을수록 앞에 위치
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // 노트북별 조회 및 정렬 성능 최적화
    notebookOrderIdx: index('idx_items_notebook_order').on(table.notebookId, table.order),
    // 타입별 조회 성능 최적화
    typeIdx: index('idx_items_type').on(table.type),
    // 리소스 ID로 해당 item 찾기 성능 최적화
    resourceIdx: index('idx_items_resource').on(table.type, table.resourceId)
  })
)

export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert
