import type { ScannedFile } from './folderScan'

/**
 * The pure part of folder watching (#158).
 *
 * Kept out of `folderWatch.ts` on purpose: that module opens the database (and so
 * loads Electron), and the decision table below is the part worth unit-testing.
 * "Changed" and "missing" have to be *determined*, not guessed, so they are a pure
 * function of the scan and the rows already imported.
 */

/** A document already imported from a file inside the watched folder. */
export interface WatchedDocument {
  documentId: string
  sourceUri: string
  sourceMtimeMs: number | null
  sourceState: 'available' | 'missing' | 'changed'
}

export interface FolderDiff {
  /** Files on disk with no document yet. */
  added: ScannedFile[]
  /** Files whose mtime differs from what was recorded. */
  changed: ScannedFile[]
  /** Documents whose file is gone. */
  missing: WatchedDocument[]
  /** Documents previously not `available` whose file is back, mtime unchanged. */
  restored: WatchedDocument[]
}

export function diffFolder(
  scanned: readonly ScannedFile[],
  existing: readonly WatchedDocument[]
): FolderDiff {
  const byPath = new Map(existing.map((document) => [document.sourceUri, document]))
  const seen = new Set<string>()

  const added: ScannedFile[] = []
  const changed: ScannedFile[] = []
  const restored: WatchedDocument[] = []

  for (const file of scanned) {
    seen.add(file.path)
    const document = byPath.get(file.path)

    if (!document) {
      added.push(file)
      continue
    }

    const mtimeChanged = document.sourceMtimeMs === null || document.sourceMtimeMs !== file.mtimeMs
    if (mtimeChanged) {
      changed.push(file)
    } else if (document.sourceState !== 'available') {
      restored.push(document)
    }
  }

  const missing = existing.filter((document) => !seen.has(document.sourceUri))
  return { added, changed, missing, restored }
}
