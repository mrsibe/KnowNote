/**
 * Ingestion 模块入口
 *
 * 类型定义在 `shared/types/ingestion`：DB schema 与 renderer 也要用同一套枚举。
 */

export * from '../../../shared/types/ingestion'
export { startRun, advanceRun, completeRun, failRun, latestRun, runsFor } from './IngestionRuns'
