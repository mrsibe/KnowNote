/**
 * What the user actually opened, as opposed to what recently changed.
 *
 * `notebooks.updatedAt` answers "what has new content in it", which is what the
 * Recent shelf shows. It cannot answer "where was I": opening a notebook to read
 * does not touch a row, and a notebook the user renamed last week outranks the one
 * they were reading an hour ago. Home needs both facts, and only one of them is in
 * the database, so this is the other one.
 *
 * The record stores **ids and a timestamp, nothing else**. Titles are resolved from
 * the database at render time, so a rename shows immediately and a deleted notebook
 * simply drops out of the list instead of leaving a row that points nowhere.
 *
 * The pure half is separated from the storage half for the same reason
 * `panelGeometry.ts` splits them: the parsing and the ordering are the parts that
 * can be wrong, and they can be asserted without a browser.
 */

export const STORAGE_KEY = 'knownote:recently-opened'

/** How many notebooks are kept. Home shows a couple; the rest is headroom. */
export const MAX_RECENT_NOTEBOOKS = 8

export interface RecentlyOpenedNotebook {
  notebookId: string
  /** `Date.now()` at the moment it was opened. Only used for ordering. */
  at: number
}

/**
 * Read a stored value, dropping anything that is not a usable entry.
 *
 * Defensive per entry rather than all-or-nothing: the value is user-writable,
 * survives upgrades, and one malformed row must not throw away the entries that
 * are still good. Entries are re-sorted, because the stored order is a claim this
 * module makes and must not have to trust.
 */
export function parseRecentlyOpened(raw: string | null): RecentlyOpenedNotebook[] {
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const entries: RecentlyOpenedNotebook[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const { notebookId, at } = item as Record<string, unknown>
    if (typeof notebookId !== 'string' || notebookId.length === 0) continue
    if (typeof at !== 'number' || !Number.isFinite(at)) continue
    entries.push({ notebookId, at })
  }

  return sortAndCap(dedupe(entries))
}

/**
 * The list after opening one notebook: most recent first, no duplicates, capped.
 *
 * Re-opening moves an entry to the front rather than adding a second one, so a
 * notebook the user lives in cannot crowd the list.
 */
export function recordNotebookOpened(
  entries: readonly RecentlyOpenedNotebook[],
  notebookId: string,
  at: number
): RecentlyOpenedNotebook[] {
  const withoutDuplicate = entries.filter((entry) => entry.notebookId !== notebookId)
  return sortAndCap([{ notebookId, at }, ...withoutDuplicate])
}

/** Notebook ids, newest first. The order Home renders "Continue" in. */
export function recentlyOpenedIds(entries: readonly RecentlyOpenedNotebook[]): string[] {
  return entries.map((entry) => entry.notebookId)
}

function dedupe(entries: readonly RecentlyOpenedNotebook[]): RecentlyOpenedNotebook[] {
  const byId = new Map<string, RecentlyOpenedNotebook>()
  for (const entry of entries) {
    const existing = byId.get(entry.notebookId)
    if (!existing || entry.at > existing.at) byId.set(entry.notebookId, entry)
  }
  return [...byId.values()]
}

function sortAndCap(entries: RecentlyOpenedNotebook[]): RecentlyOpenedNotebook[] {
  return entries.sort((a, b) => b.at - a.at).slice(0, MAX_RECENT_NOTEBOOKS)
}

export function readRecentlyOpened(): RecentlyOpenedNotebook[] {
  try {
    return parseRecentlyOpened(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

export function writeRecentlyOpened(entries: readonly RecentlyOpenedNotebook[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Persistence is a convenience; losing it must never break Home.
  }
}
