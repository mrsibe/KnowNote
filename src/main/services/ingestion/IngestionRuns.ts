import { desc, eq } from 'drizzle-orm'
import { getDatabase } from '../../db'
import { ingestionRuns } from '../../db/schema'
import type { IngestionRunKind, IngestionStage } from './types'

/**
 * 索引尝试记录（#95）。
 *
 * 纯写入原语，不做任何 pipeline 决策：谁在什么时候开始一次尝试、推进到哪个阶段、
 * 以什么结束，由 `KnowledgeService` 决定。这里只保证记录本身是完整的 —— 一次尝试
 * 从 `queued` 开始，到某个终态结束，并带起止时间。
 */

const newRunId = (): string => `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

/** 开始一次尝试；返回 run id，后续推进都以它为准。 */
export function startRun(documentId: string, kind: IngestionRunKind): string {
  const id = newRunId()
  getDatabase()
    .insert(ingestionRuns)
    .values({ id, documentId, kind, stage: 'queued', progress: 0, startedAt: new Date() })
    .run()
  return id
}

/** 推进到某个进行中的阶段。终态用 `completeRun` / `failRun`。 */
export function advanceRun(runId: string, stage: IngestionStage, progress: number): void {
  getDatabase()
    .update(ingestionRuns)
    .set({ stage, progress })
    .where(eq(ingestionRuns.id, runId))
    .run()
}

/** 成功结束。 */
export function completeRun(runId: string): void {
  getDatabase()
    .update(ingestionRuns)
    .set({ stage: 'completed', progress: 100, finishedAt: new Date() })
    .where(eq(ingestionRuns.id, runId))
    .run()
}

/** 失败结束，并记下原因。 */
export function failRun(runId: string, message: string): void {
  getDatabase()
    .update(ingestionRuns)
    .set({ stage: 'failed', errorMessage: message, finishedAt: new Date() })
    .where(eq(ingestionRuns.id, runId))
    .run()
}

/** 一份文档最近一次尝试。判断「能不能重试」看它。 */
export function latestRun(documentId: string) {
  return getDatabase()
    .select()
    .from(ingestionRuns)
    .where(eq(ingestionRuns.documentId, documentId))
    .orderBy(desc(ingestionRuns.startedAt))
    .get()
}

/** 一份文档的全部尝试，最近优先。 */
export function runsFor(documentId: string) {
  return getDatabase()
    .select()
    .from(ingestionRuns)
    .where(eq(ingestionRuns.documentId, documentId))
    .orderBy(desc(ingestionRuns.startedAt))
    .all()
}
