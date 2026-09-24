import { app } from 'electron'
import { join } from 'path'
import { stat } from 'fs/promises'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as sqliteVec from 'sqlite-vec'
import * as schema from './schema'
import {
  copyVectorsSql,
  createVectorTableSql,
  dropVectorTableSql
} from '../vectorstore/vectorTableSql'

let sqlite: Database.Database | null = null
let db: ReturnType<typeof drizzle> | null = null
let checkpointTimer: NodeJS.Timeout | null = null
let truncateTimer: NodeJS.Timeout | null = null
let isClosing = false // 防止重复关闭

/**
 * 初始化数据库连接
 * 在 Electron 主进程的 app.whenReady() 中调用
 */
export function initDatabase() {
  // 数据库文件存放在用户数据目录
  const dbPath = join(app.getPath('userData'), 'knownote.db')

  console.log('[Database] Initializing database at:', dbPath)

  try {
    // 创建 SQLite 数据库实例
    sqlite = new Database(dbPath)

    // 加载 sqlite-vec 扩展
    if (app.isPackaged) {
      // 打包环境：手动构建到 .asar.unpacked 的路径
      const platform = process.platform
      const arch = process.arch

      // 映射平台和架构名称
      const platformName = platform === 'win32' ? 'windows' : platform
      const packageName = `sqlite-vec-${platformName}-${arch}`
      const extension = platform === 'win32' ? 'dll' : platform === 'darwin' ? 'dylib' : 'so'

      // 构建到解包目录的路径
      const vecPath = join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        packageName,
        `vec0.${extension}`
      )

      console.log('[Database] Loading sqlite-vec from:', vecPath)
      sqlite.loadExtension(vecPath)
    } else {
      // 开发环境：使用 sqlite-vec 默认加载
      sqliteVec.load(sqlite)
    }
    console.log('[Database] sqlite-vec extension loaded')

    // 验证 sqlite-vec 版本
    const vecVersion = sqlite.prepare('SELECT vec_version() as version').get() as {
      version: string
    }
    console.log('[Database] sqlite-vec version:', vecVersion?.version)

    // 启用 WAL 模式以提高性能
    sqlite.pragma('journal_mode = WAL')

    // 优化 WAL 配置
    sqlite.pragma('wal_autocheckpoint = 100') // 每 100 页自动 checkpoint（降低默认值）
    sqlite.pragma('synchronous = NORMAL') // WAL 模式推荐设置
    sqlite.pragma('busy_timeout = 5000') // 5 秒超时，防止并发冲突

    // 记录当前配置
    const journalMode = sqlite.pragma('journal_mode', { simple: true })
    const walCheckpoint = sqlite.pragma('wal_autocheckpoint', { simple: true })
    const syncMode = sqlite.pragma('synchronous', { simple: true })
    console.log('[Database] Configuration:', {
      journal_mode: journalMode,
      wal_autocheckpoint: walCheckpoint,
      synchronous: syncMode
    })

    // 创建 Drizzle 实例
    db = drizzle(sqlite, { schema })

    // 数据库完整性检查
    const integrityCheck = sqlite.pragma('integrity_check', { simple: true })
    if (integrityCheck !== 'ok') {
      console.error('[Database] Integrity check failed:', integrityCheck)
    } else {
      console.log('[Database] Integrity check passed')
    }

    // 启动定期 checkpoint 机制
    startPeriodicCheckpoint(dbPath)

    console.log('[Database] Database initialized successfully')
    return db
  } catch (error) {
    console.error('[Database] Failed to initialize database:', error)
    throw error
  }
}

/**
 * 启动定期 checkpoint 机制
 */
function startPeriodicCheckpoint(dbPath: string) {
  const walPath = `${dbPath}-wal`

  // 每 30 秒检查 WAL 文件大小并执行 PASSIVE checkpoint
  checkpointTimer = setInterval(async () => {
    try {
      if (!sqlite || isClosing) return

      const stats = await stat(walPath).catch(() => null)
      if (stats && stats.size > 1024 * 1024) {
        // 1MB
        console.log(
          `[Database] WAL file size: ${(stats.size / 1024 / 1024).toFixed(2)}MB, executing PASSIVE checkpoint...`
        )
        const result = sqlite.pragma('wal_checkpoint(PASSIVE)')
        console.log('[Database] PASSIVE checkpoint result:', result)
      }
    } catch (error) {
      console.error('[Database] Error during periodic checkpoint:', error)
    }
  }, 30000) // 30 秒

  checkpointTimer.unref() // 不阻止进程退出

  // 每 5 分钟执行一次 TRUNCATE checkpoint，清理 WAL 文件
  truncateTimer = setInterval(() => {
    try {
      if (!sqlite || isClosing) return

      console.log('[Database] Executing scheduled TRUNCATE checkpoint...')
      const result = sqlite.pragma('wal_checkpoint(TRUNCATE)')
      console.log('[Database] TRUNCATE checkpoint result:', result)
    } catch (error) {
      console.error('[Database] Error during truncate checkpoint:', error)
    }
  }, 300000) // 5 分钟

  truncateTimer.unref()
}

/**
 * 执行主动 checkpoint（供外部调用）
 */
export function executeCheckpoint(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'PASSIVE') {
  if (!sqlite) return

  try {
    console.log(`[Database] Executing ${mode} checkpoint...`)
    const result = sqlite.pragma(`wal_checkpoint(${mode})`)
    console.log(`[Database] ${mode} checkpoint result:`, result)
  } catch (error) {
    console.error(`[Database] Error executing ${mode} checkpoint:`, error)
  }
}

/**
 * 运行数据库迁移
 * 在初始化数据库后立即调用
 */
export function runMigrations() {
  if (!db) {
    throw new Error('[Database] Database not initialized. Call initDatabase() first.')
  }

  // __dirname 在编译后指向 out/main（所有代码打包到 out/main/index.js）
  // 而 migrations 文件被复制到 out/main/db/migrations
  const migrationsFolder = join(__dirname, 'db', 'migrations')
  console.log('[Database] Running migrations from:', migrationsFolder)

  try {
    migrate(db, { migrationsFolder })
    console.log('[Database] Migrations completed successfully')
  } catch (error) {
    console.error('[Database] Migration failed:', error)
    throw error
  }
}

// ==================== 向量表（每 notebook 一张） ====================
//
// vec0 表的宽度在创建时就固定(embedding MATCH 要求宽度一致),而换 embedding 模型
// 往往就换了维度。所以向量表按 notebook 拆分,宽度记录在 vec_metadata 里 —— 它是维度
// 的唯一权威来源。任何调用点都不能拿“猜”出来的默认维度去建表,更不能因为维度不一致
// 就删表。

/** 旧版本只有一张全局 vec_embeddings,宽度固定 1024(见 migrateLegacyVectorTable)。 */
const LEGACY_VECTOR_DIMENSIONS = 1024

/** 一个 notebook 的向量表和它的向量宽度。 */
export interface NotebookVectorTable {
  tableName: string
  dimensions: number
}

function requireSqlite(): Database.Database {
  if (!sqlite) {
    throw new Error('[Database] Database not initialized. Call initDatabase() first.')
  }
  return sqlite
}

/**
 * notebook id 转 vec0 表名。notebook id 是 `notebook_<timestamp>_<base36>`,只含
 * 字母、数字和下划线,所以这个映射目前是恒等的;替换仍然保留,免得意外字符把表名
 * 拼进 SQL。
 */
function notebookVectorTableName(notebookId: string): string {
  return `vec_${notebookId.replace(/[^a-zA-Z0-9]/g, '_')}`
}

function readNotebookVectorTableRow(notebookId: string): NotebookVectorTable | undefined {
  const row = requireSqlite()
    .prepare('SELECT table_name, dimensions FROM vec_metadata WHERE notebook_id = ?')
    .get(notebookId) as { table_name: string; dimensions: number } | undefined

  return row ? { tableName: row.table_name, dimensions: row.dimensions } : undefined
}

/**
 * 读取 notebook 的向量表信息。这个 notebook 还没有索引过向量时返回 undefined。
 */
export function getNotebookVectorTable(notebookId: string): NotebookVectorTable | undefined {
  return readNotebookVectorTableRow(notebookId)
}

/**
 * 为 notebook 建向量表。表已存在且宽度一致时幂等;宽度不一致时抛错而不是重建 ——
 * 重建会丢掉全部向量,只能由索引链路显式调用 rebuildNotebookVectorTable()。
 */
export function createNotebookVectorTable(
  notebookId: string,
  dimensions: number
): NotebookVectorTable {
  const db = requireSqlite()

  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`[Database] Invalid embedding dimensions: ${dimensions}`)
  }

  const existing = readNotebookVectorTableRow(notebookId)
  if (existing) {
    if (existing.dimensions !== dimensions) {
      throw new Error(
        `[Database] Vector table ${existing.tableName} holds ${existing.dimensions}-dimensional vectors, ` +
          `but ${dimensions} was requested. Changing the embedding model must go through ` +
          `rebuildNotebookVectorTable() so the documents are marked for re-indexing.`
      )
    }
    return existing
  }

  const tableName = notebookVectorTableName(notebookId)
  const claimed = db
    .prepare('SELECT notebook_id FROM vec_metadata WHERE table_name = ?')
    .get(tableName) as { notebook_id: string } | undefined
  if (claimed) {
    throw new Error(
      `[Database] Vector table name ${tableName} is already used by notebook ${claimed.notebook_id}`
    )
  }

  // 上一次创建可能在 CREATE 之后、写元数据之前中断,留下一张没人认领的表:它不可能
  // 写过向量(表名只来自元数据),清掉重来比沿用一张宽度未知的表安全。
  db.exec(dropVectorTableSql(tableName))
  db.exec(createVectorTableSql(tableName, dimensions))
  db.prepare('INSERT INTO vec_metadata (notebook_id, table_name, dimensions) VALUES (?, ?, ?)').run(
    notebookId,
    tableName,
    dimensions
  )

  console.log(`[Database] Created vector table ${tableName} with ${dimensions} dimensions`)
  return { tableName, dimensions }
}

/**
 * 用新的维度重建 notebook 的向量表,旧向量随之丢弃。只有索引链路在量到真实的
 * embedding 维度、发现与既有表不一致时才应该调用,并且要负责把文档标回待索引。
 */
export function rebuildNotebookVectorTable(
  notebookId: string,
  dimensions: number
): NotebookVectorTable {
  dropNotebookVectorTable(notebookId)
  return createNotebookVectorTable(notebookId, dimensions)
}

/**
 * 删除 notebook 的向量表和元数据。没有索引过的 notebook 是 no-op。
 */
export function dropNotebookVectorTable(notebookId: string): void {
  const db = requireSqlite()
  const existing = readNotebookVectorTableRow(notebookId)
  if (!existing) return

  db.exec(dropVectorTableSql(existing.tableName))
  db.prepare('DELETE FROM vec_metadata WHERE notebook_id = ?').run(notebookId)
  console.log(`[Database] Dropped vector table ${existing.tableName}`)
}

/**
 * 初始化向量存储
 * 创建 vec_metadata 并把旧版本的全局向量表迁移成每 notebook 一张表
 * 在 runMigrations 后调用
 */
export function initVectorStore() {
  if (!sqlite) {
    throw new Error('[Database] Database not initialized. Call initDatabase() first.')
  }

  console.log('[Database] Initializing vector store...')

  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS vec_metadata (
        notebook_id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)

    migrateLegacyVectorTable()

    console.log('[Database] Vector store initialized successfully')
  } catch (error) {
    console.error('[Database] Failed to initialize vector store:', error)
    throw error
  }
}

/**
 * 把旧版本的全局 vec_embeddings 搬到每 notebook 一张的向量表,然后删掉旧表。
 *
 * 旧表是 initVectorStore() 用 FLOAT[1024] 建的,宽度不可变,所以整张表都是 1024 维。
 * sqlite-vec 支持 vec0 到 vec0 的 INSERT..SELECT,一个 notebook 一条语句即可。元数据
 * 已存在就跳过,所以迁移中途失败后重跑是幂等的。
 */
function migrateLegacyVectorTable(): void {
  const db = requireSqlite()
  const legacy = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vec_embeddings'")
    .get()
  if (!legacy) return

  // 关联 notebooks 是为了丢掉已经被删掉的笔记本留下的孤儿向量
  const notebooks = db
    .prepare(
      'SELECT DISTINCT v.notebook_id AS notebook_id FROM vec_embeddings v ' +
        'JOIN notebooks n ON n.id = v.notebook_id'
    )
    .all() as Array<{ notebook_id: string }>

  for (const { notebook_id: notebookId } of notebooks) {
    if (readNotebookVectorTableRow(notebookId)) continue

    const { tableName } = createNotebookVectorTable(notebookId, LEGACY_VECTOR_DIMENSIONS)
    db.prepare(copyVectorsSql(tableName, 'vec_embeddings')).run(notebookId)
    console.log(`[Database] Migrated vectors of ${notebookId} into ${tableName}`)
  }

  db.exec('DROP TABLE IF EXISTS vec_embeddings')
  console.log('[Database] Replaced legacy vec_embeddings with per-notebook vector tables')
}

/**
 * 获取数据库实例
 * 在需要执行数据库操作时调用
 */
export function getDatabase() {
  if (!db) {
    throw new Error('[Database] Database not initialized. Call initDatabase() first.')
  }
  return db
}

/**
 * 优雅关闭数据库连接
 * 在 Electron app.on('before-quit') 中调用
 */
export function closeDatabase() {
  if (isClosing || !sqlite) {
    console.log('[Database] Database already closed or closing')
    return
  }

  isClosing = true
  console.log('[Database] Starting graceful database closure...')

  try {
    // 清除定时器
    if (checkpointTimer) {
      clearInterval(checkpointTimer)
      checkpointTimer = null
    }
    if (truncateTimer) {
      clearInterval(truncateTimer)
      truncateTimer = null
    }

    // 执行最终 checkpoint，强制合并所有 WAL 数据到主数据库
    console.log('[Database] Executing final RESTART checkpoint before closing...')
    const checkpointResult = sqlite.pragma('wal_checkpoint(RESTART)')
    console.log('[Database] Final checkpoint result:', checkpointResult)

    // 关闭数据库连接
    sqlite.close()
    console.log('[Database] Database connection closed successfully')

    sqlite = null
    db = null
  } catch (error) {
    console.error('[Database] Error during database closure:', error)
    // 即使出错也要清理引用
    sqlite = null
    db = null
  } finally {
    isClosing = false
  }
}

/**
 * 获取原始 SQLite 实例（用于 pragma 等操作）
 */
export function getSqlite(): Database.Database | null {
  return sqlite
}

// 导出类型供其他模块使用
export type Database = NonNullable<typeof db>
