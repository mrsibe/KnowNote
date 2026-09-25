/**
 * Eval harness entry point (#75), enabled by `--eval-harness` / `--eval-prepare`.
 *
 * Runs in the real main process because the DB layer, the vector store and the
 * loaders only exist there — a plain Node runner would have to reimplement the
 * ingestion path it is supposed to measure. It never opens a window.
 *
 * `--eval-prepare` is the only step allowed to touch the network: it downloads
 * the pinned embedding model into the real model cache. `--eval-harness` then
 * runs offline against a throwaway database and refuses to download.
 */

import { app } from 'electron'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join, relative, resolve } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDatabase, initDatabase, initVectorStore, runMigrations } from '../db'
import { ConnectionManager } from '../models/ConnectionManager'
import { EmbeddingService } from '../services/EmbeddingService'
import { KnowledgeService } from '../services/KnowledgeService'
import { isModelInstalled } from '../embedding/ModelRegistry'
import {
  runEvalHarness,
  stabilize,
  toDeterministicReport,
  type EvalHarnessOptions
} from './harness'
import { renderMarkdown } from './report'

export const EVAL_FLAG = '--eval-harness'
export const EVAL_PREPARE_FLAG = '--eval-prepare'

export function isEvalRequested(argv: readonly string[] = process.argv): boolean {
  return argv.includes(EVAL_FLAG) || argv.includes(EVAL_PREPARE_FLAG)
}

function readOption(argv: readonly string[], prefix: string, fallback: string): string {
  const arg = argv.find((value) => value.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : fallback
}

/**
 * A ConnectionManager that can never produce a remote backend, so the harness
 * always measures the built-in local model regardless of the developer's own
 * embedding configuration. Determinism is a property of the baseline, not of the
 * machine it was produced on.
 */
function localOnlyConnectionManager(): ConnectionManager {
  // SAFETY: only `getEmbeddingClient` and `getConnection('embedding')` are reached by
  // `EmbeddingService`; both always answer "no remote connection", so no other member of
  // ConnectionManager is ever touched. A new call site fails at runtime, loudly.
  return {
    getEmbeddingClient: async () => null,
    getConnection: async () => null
  } as unknown as ConnectionManager
}

export async function runEvalCli(argv: readonly string[] = process.argv): Promise<number> {
  const prepare = argv.includes(EVAL_PREPARE_FLAG)
  const corpusDir = resolve(readOption(argv, '--eval-corpus=', 'eval/corpus'))
  const questionsPath = resolve(readOption(argv, '--eval-questions=', 'eval/questions.jsonl'))
  const outDir = resolve(readOption(argv, '--eval-out=', 'docs/eval'))

  // The real profile is captured before redirecting: the model cache lives under
  // it and must survive the throwaway run.
  const realUserData = app.getPath('userData')
  const workDir = mkdtempSync(join(tmpdir(), 'knownote-eval-'))
  app.setPath('userData', workDir)

  // `KNOWNOTE_EVAL_MODEL_CACHE` lets CI point at its own cache instead of the
  // developer profile, without changing what production uses.
  const modelCacheDir = process.env.KNOWNOTE_EVAL_MODEL_CACHE || join(realUserData, 'models')

  const embeddingService = new EmbeddingService(localOnlyConnectionManager(), {
    cacheDir: modelCacheDir
  })

  let databaseInitialized = false

  try {
    if (prepare) {
      console.log(`[eval] preparing the pinned local embedding model into ${modelCacheDir}`)
      await embeddingService.ensureReady((progress) => {
        const percent = Math.round(progress.progress * 100)
        if (percent > 0 && percent % 10 === 0) {
          console.log(`[eval] model download ${percent}%`)
        }
      })
      console.log('[eval] model ready; `npm run eval` will now run offline')
      return 0
    }

    if (!(await isModelInstalled(modelCacheDir))) {
      console.error('[eval] Eval model is not available locally.')
      console.error('[eval] Run: npm run eval:prepare')
      return 1
    }

    initDatabase()
    databaseInitialized = true
    runMigrations()
    initVectorStore()

    const knowledgeService = new KnowledgeService(embeddingService)
    const options: EvalHarnessOptions = {
      corpusDir,
      // Recorded in the report as a repo-relative path so the committed JSON is
      // identical on every machine and checkout.
      corpusLabel: relative(process.cwd(), corpusDir) || 'eval/corpus',
      questionsPath,
      baseline: 'v1.4',
      topK: 10,
      threshold: 0,
      evidenceK: 5
    }

    const report = stabilize(await runEvalHarness(getDatabase(), knowledgeService, options))

    await mkdir(outDir, { recursive: true })
    const jsonPath = join(outDir, `baseline-${report.baseline}.json`)
    const markdownPath = join(outDir, `baseline-${report.baseline}.md`)
    writeFileSync(jsonPath, `${JSON.stringify(toDeterministicReport(report), null, 2)}\n`)
    writeFileSync(markdownPath, renderMarkdown(report))

    // A single machine-readable line so a determinism check can diff the metrics
    // without parsing the whole report (timing is deliberately excluded).
    console.log(`[eval] metrics ${JSON.stringify(report.metrics)}`)
    console.log(`[eval] wrote ${jsonPath} and ${markdownPath}`)
    return 0
  } catch (error) {
    console.error('[eval] FAIL', error instanceof Error ? error.message : error)
    return 1
  } finally {
    if (databaseInitialized) {
      try {
        closeDatabase()
      } catch {
        // A close failure must not mask the eval result.
      }
    }
    rmSync(workDir, { recursive: true, force: true })
  }
}
