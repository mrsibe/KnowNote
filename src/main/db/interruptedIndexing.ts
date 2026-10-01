export const INTERRUPTED_INDEXING_ERROR =
  'Indexing was interrupted because KnowNote exited. Retry indexing to continue.'

interface RecoveryDatabase {
  prepare(sql: string): {
    run(error: string, updatedAt: number): { changes: number | bigint }
  }
}

/** Run only at desktop startup, before any ingestion jobs or folder watchers start. */
export function markInterruptedIndexingFailed(
  database: RecoveryDatabase,
  now = new Date()
): number {
  const result = database
    .prepare(
      `UPDATE documents
       SET status = 'failed', error_message = ?, updated_at = ?
       WHERE status IN ('pending', 'processing')`
    )
    .run(INTERRUPTED_INDEXING_ERROR, Math.floor(now.getTime() / 1000))
  return Number(result.changes)
}
