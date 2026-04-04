import { app } from 'electron'
import { join } from 'path'
import { stat } from 'fs/promises'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as sqliteVec from 'sqlite-vec'
import * as schema from './schema'

let sqlite: Database.Database | null = null
let db: ReturnType<typeof drizzle> | null = null
let checkpointTimer: NodeJS.Timeout | null = null
let truncateTimer: NodeJS.Timeout | null = null
let isClosing = false // 중복 종료 방지

/**
 * 데이터베이스 연결 초기화
 * Electron 메인 프로세스의 app.whenReady()에서 호출
 */
export function initDatabase() {
  // 데이터베이스 파일은 사용자 데이터 디렉토리에 저장
  const dbPath = join(app.getPath('userData'), 'knownote.db')

  console.log('[Database] Initializing database at:', dbPath)

  try {
    // SQLite 데이터베이스 인스턴스 생성
    sqlite = new Database(dbPath)

    // sqlite-vec 확장 로드
    if (app.isPackaged) {
      // 패키징 환경: .asar.unpacked 경로를 수동으로 구성
      const platform = process.platform
      const arch = process.arch

      // 플랫폼 및 아키텍처 이름 매핑
      const platformName = platform === 'win32' ? 'windows' : platform
      const packageName = `sqlite-vec-${platformName}-${arch}`
      const extension = platform === 'win32' ? 'dll' : platform === 'darwin' ? 'dylib' : 'so'

      // 언팩 디렉토리 경로 구성
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
      // 개발 환경: sqlite-vec 기본 로드 사용
      sqliteVec.load(sqlite)
    }
    console.log('[Database] sqlite-vec extension loaded')

    // sqlite-vec 버전 확인
    const vecVersion = sqlite.prepare('SELECT vec_version() as version').get() as {
      version: string
    }
    console.log('[Database] sqlite-vec version:', vecVersion?.version)

    // 성능 향상을 위해 WAL 모드 활성화
    sqlite.pragma('journal_mode = WAL')

    // WAL 설정 최적화
    sqlite.pragma('wal_autocheckpoint = 100') // 100페이지마다 자동 checkpoint (기본값 축소)
    sqlite.pragma('synchronous = NORMAL') // WAL 모드 권장 설정
    sqlite.pragma('busy_timeout = 5000') // 5초 타임아웃, 동시성 충돌 방지

    // 현재 설정 기록
    const journalMode = sqlite.pragma('journal_mode', { simple: true })
    const walCheckpoint = sqlite.pragma('wal_autocheckpoint', { simple: true })
    const syncMode = sqlite.pragma('synchronous', { simple: true })
    console.log('[Database] Configuration:', {
      journal_mode: journalMode,
      wal_autocheckpoint: walCheckpoint,
      synchronous: syncMode
    })

    // Drizzle 인스턴스 생성
    db = drizzle(sqlite, { schema })

    // 데이터베이스 무결성 검사
    const integrityCheck = sqlite.pragma('integrity_check', { simple: true })
    if (integrityCheck !== 'ok') {
      console.error('[Database] Integrity check failed:', integrityCheck)
    } else {
      console.log('[Database] Integrity check passed')
    }

    // 정기 checkpoint 메커니즘 시작
    startPeriodicCheckpoint(dbPath)

    console.log('[Database] Database initialized successfully')
    return db
  } catch (error) {
    console.error('[Database] Failed to initialize database:', error)
    throw error
  }
}

/**
 * 정기 checkpoint 메커니즘 시작
 */
function startPeriodicCheckpoint(dbPath: string) {
  const walPath = `${dbPath}-wal`

  // 30초마다 WAL 파일 크기를 확인하고 PASSIVE checkpoint 실행
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
  }, 30000) // 30초

  checkpointTimer.unref() // 프로세스 종료를 차단하지 않음

  // 5분마다 TRUNCATE checkpoint를 실행하여 WAL 파일 정리
  truncateTimer = setInterval(() => {
    try {
      if (!sqlite || isClosing) return

      console.log('[Database] Executing scheduled TRUNCATE checkpoint...')
      const result = sqlite.pragma('wal_checkpoint(TRUNCATE)')
      console.log('[Database] TRUNCATE checkpoint result:', result)
    } catch (error) {
      console.error('[Database] Error during truncate checkpoint:', error)
    }
  }, 300000) // 5분

  truncateTimer.unref()
}

/**
 * 능동적 checkpoint 실행 (외부 호출용)
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
 * 데이터베이스 마이그레이션 실행
 * 데이터베이스 초기화 직후 호출
 */
export function runMigrations() {
  if (!db) {
    throw new Error('[Database] Database not initialized. Call initDatabase() first.')
  }

  // __dirname은 컴파일 후 out/main을 가리킴 (모든 코드가 out/main/index.js에 번들링됨)
  // migrations 파일은 out/main/db/migrations로 복사됨
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

/**
 * 벡터 저장소 테이블 초기화
 * 벡터 검색을 위한 sqlite-vec의 vec0 가상 테이블 생성
 * runMigrations 이후 호출
 */
export function initVectorStore() {
  if (!sqlite) {
    throw new Error('[Database] Database not initialized. Call initDatabase() first.')
  }

  console.log('[Database] Initializing vector store...')

  try {
    // 벡터 인덱스 가상 테이블 생성 (존재하지 않는 경우)
    // 코사인 거리 측정 사용, 1024 차원 (BAAI/bge-m3 기본 차원)
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
        embedding_id TEXT PRIMARY KEY,
        chunk_id TEXT,
        notebook_id TEXT,
        embedding FLOAT[1024] distance_metric=cosine
      );
    `)

    console.log('[Database] Vector store initialized successfully')
  } catch (error) {
    console.error('[Database] Failed to initialize vector store:', error)
    throw error
  }
}

/**
 * 데이터베이스 인스턴스 조회
 * 데이터베이스 작업 실행 시 호출
 */
export function getDatabase() {
  if (!db) {
    throw new Error('[Database] Database not initialized. Call initDatabase() first.')
  }
  return db
}

/**
 * 데이터베이스 연결 정상 종료
 * Electron app.on('before-quit')에서 호출
 */
export function closeDatabase() {
  if (isClosing || !sqlite) {
    console.log('[Database] Database already closed or closing')
    return
  }

  isClosing = true
  console.log('[Database] Starting graceful database closure...')

  try {
    // 타이머 정리
    if (checkpointTimer) {
      clearInterval(checkpointTimer)
      checkpointTimer = null
    }
    if (truncateTimer) {
      clearInterval(truncateTimer)
      truncateTimer = null
    }

    // 최종 checkpoint 실행, 모든 WAL 데이터를 메인 데이터베이스에 강제 병합
    console.log('[Database] Executing final RESTART checkpoint before closing...')
    const checkpointResult = sqlite.pragma('wal_checkpoint(RESTART)')
    console.log('[Database] Final checkpoint result:', checkpointResult)

    // 데이터베이스 연결 종료
    sqlite.close()
    console.log('[Database] Database connection closed successfully')

    sqlite = null
    db = null
  } catch (error) {
    console.error('[Database] Error during database closure:', error)
    // 오류가 발생해도 참조 정리
    sqlite = null
    db = null
  } finally {
    isClosing = false
  }
}

/**
 * 원시 SQLite 인스턴스 조회 (pragma 등의 작업용)
 */
export function getSqlite() {
  return sqlite
}

// 다른 모듈에서 사용할 타입 내보내기
export type Database = NonNullable<typeof db>
