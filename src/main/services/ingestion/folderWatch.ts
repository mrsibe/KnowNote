import { watch, type FSWatcher } from 'fs'
import { eq } from 'drizzle-orm'
import { getDatabase } from '../../db'
import { folderWatches } from '../../db/schema'
import type { KnowledgeService } from '../KnowledgeService'
import { scanFolder, type ScannedFile } from './folderScan'
import { diffFolder } from './folderDiff'

// Re-exported so the rest of the app keeps importing the watcher from one place;
// the pure decision table lives in `folderDiff.ts` so it is testable without Electron.
export { diffFolder, type FolderDiff, type WatchedDocument } from './folderDiff'

/**
 * Watched folders (#158).
 *
 * A folder import (#98) is a snapshot; this is what keeps a folder current. The
 * two are deliberately separate code paths: the snapshot never runs on a timer,
 * and the watcher never re-implements parsing.
 *
 * The division of labour:
 *
 *   filesystem event      → (debounced) reconcile that one folder
 *   new file              → enqueue an import run (#95)
 *   changed file          → re-parse + re-index the SAME documentId
 *   deleted file          → mark the source `missing`; never delete the row,
 *                           its notes, its excerpts or its citations
 *
 * Reconciliation is a *diff*, not a re-import: an unchanged file costs one stat
 * and nothing else.
 */

export interface FolderWatchRecord {
  id: string
  notebookId: string
  path: string
}

export function listFolderWatches(): FolderWatchRecord[] {
  return getDatabase()
    .select({
      id: folderWatches.id,
      notebookId: folderWatches.notebookId,
      path: folderWatches.path
    })
    .from(folderWatches)
    .all()
}

export function listFolderWatchesForNotebook(notebookId: string): FolderWatchRecord[] {
  return getDatabase()
    .select({
      id: folderWatches.id,
      notebookId: folderWatches.notebookId,
      path: folderWatches.path
    })
    .from(folderWatches)
    .where(eq(folderWatches.notebookId, notebookId))
    .all()
}

/** Add a watch. Adding the same folder twice is a no-op, not a second row. */
export function addFolderWatch(notebookId: string, path: string): FolderWatchRecord {
  const existing = listFolderWatchesForNotebook(notebookId).find((entry) => entry.path === path)
  if (existing) return existing

  const now = new Date()
  const id = `watch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  getDatabase()
    .insert(folderWatches)
    .values({ id, notebookId, path, createdAt: now, updatedAt: now })
    .run()

  return { id, notebookId, path }
}

export function removeFolderWatch(watchId: string): void {
  getDatabase().delete(folderWatches).where(eq(folderWatches.id, watchId)).run()
}

export interface ReconcileResult {
  notebookId: string
  path: string
  added: number
  changed: number
  missing: number
  restored: number
}

/**
 * Keeps watched folders current.
 *
 * `reconcileAll()` runs on launch, so a change made while the app was closed is
 * not missed; `start()` adds live watchers on top of that. Both funnel through
 * `reconcileFolder()`, which is the only place that decides what changed.
 */
export class FolderWatchService {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private stopped = false

  constructor(private readonly knowledgeService: KnowledgeService) {}

  async reconcileAll(): Promise<ReconcileResult[]> {
    const results: ReconcileResult[] = []
    for (const watch of listFolderWatches()) {
      results.push(await this.reconcileFolder(watch.notebookId, watch.path))
    }
    return results
  }

  async reconcileFolder(notebookId: string, folderPath: string): Promise<ReconcileResult> {
    const extensions = this.knowledgeService.supportedExtensions()
    let scanned: ScannedFile[]
    try {
      scanned = await scanFolder(folderPath, extensions)
    } catch {
      // A watched folder can disappear (unmounted drive, deleted folder). Every
      // source under it becomes `missing`; nothing is deleted.
      scanned = []
    }

    const existing = this.knowledgeService.getWatchedDocuments(notebookId, folderPath)
    const diff = diffFolder(scanned, existing)

    for (const document of diff.missing) {
      this.knowledgeService.markSourceState(document.documentId, 'missing')
    }
    for (const document of diff.restored) {
      this.knowledgeService.markSourceState(document.documentId, 'available')
    }
    for (const file of diff.changed) {
      const document = existing.find((entry) => entry.sourceUri === file.path)
      if (!document) continue
      try {
        await this.knowledgeService.refreshDocumentFromFile(document.documentId, file.path)
      } catch {
        // A refresh failure is recorded on the ingestion run and leaves the old
        // index in place (#95); reconciliation itself must not throw.
      }
    }

    if (diff.added.length > 0) {
      await this.knowledgeService.addDocumentsFromPaths(
        notebookId,
        diff.added.map((file) => file.path)
      )
    }

    return {
      notebookId,
      path: folderPath,
      added: diff.added.length,
      changed: diff.changed.length,
      missing: diff.missing.length,
      restored: diff.restored.length
    }
  }

  /** Live watchers over the persisted watches. Safe to call once at startup. */
  start(): void {
    for (const record of listFolderWatches()) {
      this.watchFolder(record)
    }
  }

  stop(): void {
    this.stopped = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }

  /** 停止监听单个文件夹（取消监听时）；行还在时下次 `start()` 不会把它加回来。 */
  stopWatch(watchId: string): void {
    const timer = this.timers.get(watchId)
    if (timer) clearTimeout(timer)
    this.timers.delete(watchId)

    const watcher = this.watchers.get(watchId)
    if (watcher) watcher.close()
    this.watchers.delete(watchId)
  }

  private watchFolder(record: FolderWatchRecord): void {
    if (this.watchers.has(record.id)) return

    try {
      // `recursive` is supported on macOS/Windows and on Linux since Node 20. If a
      // platform refuses it, the launch-time reconcile still keeps the folder
      // current — only live updates are lost, and that is not silent: it is this catch.
      const watcher = watch(record.path, { recursive: true }, () => this.debounce(record))
      watcher.on('error', () => {
        watcher.close()
        this.watchers.delete(record.id)
      })
      this.watchers.set(record.id, watcher)
    } catch {
      // Folder gone or recursive unsupported: reconcile-on-launch remains the fallback.
    }
  }

  /** One folder's burst of events becomes one reconcile. */
  private debounce(watch: FolderWatchRecord): void {
    if (this.stopped) return
    const pending = this.timers.get(watch.id)
    if (pending) clearTimeout(pending)

    this.timers.set(
      watch.id,
      setTimeout(() => {
        this.timers.delete(watch.id)
        void this.reconcileFolder(watch.notebookId, watch.path)
      }, 800)
    )
  }
}
