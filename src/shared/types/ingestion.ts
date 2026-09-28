/**
 * Ingestion contract
 *
 * 索引管道需要一套自己的状态，而不是复用 `documents.status`
 * （`pending | processing | indexed | failed`）。原因有三：
 *
 * 1. 它表达不了 `queued → parsing → chunking → embedding → ready` 这样的阶段，
 *    用户在导入大文件时看不到进行到哪一步；
 * 2. 它把**来源身份**（source）和**派生索引**（index）混在一个字段里 —— 文件被删
 *    应该是 source 缺失、index 过期，而不是 source 消失；
 * 3. 一次导入/重建索引是**一次尝试**，可能失败、可以重试，而 `documents` 一行只
 *    能记一个终态。重试需要历史，因此单独的 `ingestion_runs` 记录。
 *
 * 类型放在 shared：DB schema 用它们约束列，UI 用它们渲染阶段文案，main 的写入端
 * 用它们推进状态机。三处必须是同一套枚举。
 */

/** 一次索引尝试的种类：首次导入，或对已有 source 重建索引。 */
export type IngestionRunKind = 'import' | 'reindex'

/**
 * 一次 ingestion run 的阶段。
 *
 * 前六个是进行中的阶段，后三个是终态；终态之后不再变化。`queued` 在 run 开始
 * 之前，`completed` / `failed` / `cancelled` 之后不再有下一个阶段。
 */
export type IngestionStage =
  | 'queued'
  | 'copying'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** 全部阶段，按进行顺序排列（终态排在最后）。 */
export const INGESTION_STAGES: readonly IngestionStage[] = [
  'queued',
  'copying',
  'parsing',
  'chunking',
  'embedding',
  'finalizing',
  'completed',
  'failed',
  'cancelled'
]

/** 终态：run 到此结束，不再变化。 */
export const TERMINAL_INGESTION_STAGES = ['completed', 'failed', 'cancelled'] as const

export type TerminalIngestionStage = (typeof TERMINAL_INGESTION_STAGES)[number]

/** 一个阶段是否是终态。用于判断 run 是否还能被重试/推进。 */
export function isTerminalStage(stage: IngestionStage): stage is TerminalIngestionStage {
  return (TERMINAL_INGESTION_STAGES as readonly string[]).includes(stage)
}

/**
 * 来源文件本身的状态。与索引状态分开：文件被删是 `missing`，索引才是 `stale`，
 * 因此 citation / 摘录仍然存在，只是指向一个暂时取不到的源文件。
 */
export type SourceState = 'available' | 'missing' | 'changed'

/** 派生索引的状态。 */
export type IndexState = 'queued' | 'processing' | 'ready' | 'failed' | 'stale'

/**
 * 一次索引尝试的记录（`ingestion_runs` 行）。
 *
 * 一个 document 可以有多次 run：失败的、重试后成功的。`documents` 只保留来源身份，
 * run 保留每次尝试的历史。
 */
export interface IngestionRun {
  id: string
  documentId: string
  kind: IngestionRunKind
  stage: IngestionStage
  progress: number
  /** 失败原因；未失败时为 null。 */
  errorMessage: string | null
  startedAt: Date
  /** 终态后写入；进行中为 null。 */
  finishedAt: Date | null
}
