import type { Notebook as DBNotebook } from '../../main/db/schema'

/**
 * The Home page's single read (#65).
 *
 * Home needs three things at once: recent notebooks with how much is in them, the
 * newest sources across the whole library, and the conversation the user was last
 * in. Asking for those separately would be one IPC per notebook (`getStats`) plus
 * one per notebook (`getDocuments`) on every mount — an N+1 fan-out that gets worse
 * as the library grows, for a page that is opened constantly.
 *
 * So it is one call, three statements, bounded by `limit`s. Nothing here is derived
 * from anything the renderer already holds, and nothing is computed in SQL that a
 * reader would have to re-derive: the counts are counts, and the ordering is the
 * ordering the page displays.
 */
export interface WorkspaceOverview {
  /** Every notebook, most recently updated first, each with its source count. */
  notebooks: WorkspaceOverviewNotebook[]
  /** The newest sources in the library, across all notebooks. */
  recentDocuments: WorkspaceOverviewDocument[]
  /** The most recently touched active conversations, across all notebooks. */
  recentSessions: WorkspaceOverviewSession[]
}

export interface WorkspaceOverviewNotebook extends DBNotebook {
  /** How many sources are in it. Counted, not guessed from a list the caller has. */
  sourceCount: number
}

/**
 * Only the fields a Home row renders. Deliberately not the whole `documents` row:
 * that carries `content`, `structure` and `contentHash`, none of which a list of
 * filenames has any use for, and shipping them over IPC is how a 20-item list turns
 * into megabytes.
 */
export interface WorkspaceOverviewDocument {
  id: string
  notebookId: string
  /** Resolved in the same query, so the row does not need a second lookup. */
  notebookTitle: string
  title: string
  type: string
  mimeType: string | null
  sourceUri: string | null
  localFilePath: string | null
  createdAt: Date
}

export interface WorkspaceOverviewSession {
  id: string
  notebookId: string
  notebookTitle: string
  title: string
  updatedAt: Date
}
