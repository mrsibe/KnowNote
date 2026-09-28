import { readdir, stat } from 'fs/promises'
import { extname, join, relative } from 'path'

/**
 * Folder scan for batch import (#98).
 *
 * A folder import is a **snapshot, not a watch** — this returns the files present
 * now. Watching is #158 and lives elsewhere; keeping the two apart is what stops
 * "one-shot import" and "the folder changed" from becoming the same code path
 * with different triggers.
 */

export interface ScannedFile {
  /** Absolute path, as the importer will read it. */
  path: string
  /** Path relative to the scanned root, for stable ordering and messages. */
  relativePath: string
  /** File modification time in ms — what a watch compares to decide "changed" (#158). */
  mtimeMs: number
}

/**
 * Every supported file under `dir`, recursively, in a deterministic order.
 *
 * Directories whose name starts with `.` are skipped (`.git`, `.obsidian`, …), and
 * symlinks are not followed — `Dirent.isDirectory()` is false for a symlink to a
 * directory, so a link that points back up the tree cannot make this loop.
 */
export async function scanFolder(
  dir: string,
  extensions: readonly string[]
): Promise<ScannedFile[]> {
  const allowed = new Set(extensions.map((extension) => extension.toLowerCase()))
  const files: ScannedFile[] = []

  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue

      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }
      if (!entry.isFile()) continue

      const extension = extname(entry.name).toLowerCase().slice(1)
      if (allowed.has(extension)) {
        const info = await stat(fullPath)
        files.push({ path: fullPath, relativePath: relative(dir, fullPath), mtimeMs: info.mtimeMs })
      }
    }
  }

  await walk(dir)
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}
