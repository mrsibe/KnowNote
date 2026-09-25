/**
 * RAG eval harness (#75).
 *
 * Indexes a corpus through the normal ingestion path, runs the real `Retriever`,
 * and reports retrieval and citation metrics. It is the reference point every
 * v1.5 experiment (#77, #78) must be measured against — so the numbers are
 * produced here, never typed by hand.
 *
 * Ground truth is resolved from corpus identity to runtime identity **after**
 * ingestion, because `documentId` is random and `blockId` embeds it. Nothing in
 * the committed dataset references a runtime id.
 */

import { readdir, readFile } from 'fs/promises'
import { join, posix } from 'path'
import { and, eq } from 'drizzle-orm'
import { documentBlocks, notebooks } from '../db/schema'
import type { getDatabase } from '../db'
import type { KnowledgeService } from '../services/KnowledgeService'
import { DEFAULT_CHUNK_OPTIONS } from '../services/ChunkingService'
import { LOCAL_EMBEDDING_MODEL } from '../embedding/localModel'
import {
  citationRecall,
  firstRelevantRank,
  mean,
  ndcgAtK,
  percentile,
  recallAtK,
  reciprocalRank
} from './metrics'
import type {
  EvalDeterministicReport,
  EvalQuestion,
  EvalReport,
  EvalRelevantLocation,
  QuestionReport,
  ResolvedGroundTruth
} from './types'

type Db = ReturnType<typeof getDatabase>

export interface EvalHarnessOptions {
  /** Absolute path used to read the corpus. */
  corpusDir: string
  /** Repo-relative label recorded in the report, so the JSON is machine-independent. */
  corpusLabel: string
  questionsPath: string
  baseline: string
  /** Ranks to compute Recall@k for. */
  topK: number
  /** Similarity floor; 0 keeps the ranking intact for ranking metrics. */
  threshold: number
  /** How many retrieved passages an answer would cite. */
  citationK: number
}

const NOTEBOOK_ID = 'eval-notebook'

/** Normalised comparison for the optional quote drift check. */
const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()

function parseQuestions(raw: string): EvalQuestion[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as EvalQuestion
      } catch (error) {
        throw new Error(`questions.jsonl line ${index + 1} is not valid JSON: ${String(error)}`)
      }
    })
}

/**
 * 把 `document`/`block` 顺序解析成运行期的 `documentId`/`blockId`，并用可选 quote
 * 校验块顺序没有因为 parser 改动而漂移。
 */
function resolveGroundTruth(
  db: Db,
  question: EvalQuestion,
  documentIds: Map<string, string>
): ResolvedGroundTruth[] {
  return question.relevant.map((location: EvalRelevantLocation) => {
    const documentId = documentIds.get(location.document)
    if (!documentId) {
      throw new Error(
        `question ${question.id} references "${location.document}", which is not in the corpus`
      )
    }

    const block = db
      .select()
      .from(documentBlocks)
      .where(
        and(eq(documentBlocks.documentId, documentId), eq(documentBlocks.order, location.block))
      )
      .get()

    if (!block) {
      throw new Error(
        `question ${question.id}: "${location.document}" has no block with ordinal ${location.block}`
      )
    }
    if (location.quote && !normalize(block.text).includes(normalize(location.quote))) {
      throw new Error(
        `question ${question.id}: quote drifted — block ${location.block} of "${location.document}" ` +
          `does not contain ${JSON.stringify(location.quote)}. Update the ground truth deliberately.`
      )
    }
    if (location.page !== null && block.page !== location.page) {
      throw new Error(
        `question ${question.id}: "${location.document}" block ${location.block} is on page ` +
          `${block.page}, ground truth says ${location.page}`
      )
    }

    return {
      document: location.document,
      documentId,
      blockId: block.id,
      page: block.page,
      block: location.block
    }
  })
}

/** Index every corpus document and return `corpus-relative path → runtime documentId`. */
async function indexCorpus(
  db: Db,
  knowledgeService: KnowledgeService,
  corpusDir: string
): Promise<Map<string, string>> {
  const now = new Date()
  db.insert(notebooks)
    .values({ id: NOTEBOOK_ID, title: 'Eval corpus', createdAt: now, updatedAt: now })
    .run()

  const files = (await readdir(corpusDir)).filter((name) => !name.startsWith('.')).sort()
  const documentIds = new Map<string, string>()

  for (const file of files) {
    const documentId = await knowledgeService.addDocumentFromFile(
      NOTEBOOK_ID,
      join(corpusDir, file)
    )
    documentIds.set(posix.normalize(file), documentId)
  }

  return documentIds
}

export async function runEvalHarness(
  db: Db,
  knowledgeService: KnowledgeService,
  options: EvalHarnessOptions
): Promise<EvalReport> {
  const documentIds = await indexCorpus(db, knowledgeService, options.corpusDir)
  const questions = parseQuestions(await readFile(options.questionsPath, 'utf-8'))

  const perQuestion: QuestionReport[] = []
  const latencies: number[] = []

  for (const question of questions) {
    const groundTruth = resolveGroundTruth(db, question, documentIds)
    const groundTruthIds = groundTruth.map((entry) => entry.blockId)

    const started = performance.now()
    const results = await knowledgeService.search(NOTEBOOK_ID, question.question, {
      topK: options.topK,
      threshold: options.threshold
    })
    const latencyMs = performance.now() - started
    latencies.push(latencyMs)

    const matchesByRank = results.map((result) => {
      const blockIds = new Set(result.locator.blocks.map((block) => block.blockId))
      return groundTruthIds
        .map((blockId, index) => (blockIds.has(blockId) ? index : -1))
        .filter((index) => index >= 0)
    })

    perQuestion.push({
      id: question.id,
      question: question.question,
      firstRelevantRank: firstRelevantRank(matchesByRank),
      relevantCount: groundTruth.length,
      retrievedCount: results.length,
      matchesByRank
    })
  }

  const metrics = {
    recallAt1: mean(perQuestion.map((q) => recallAtK(q.matchesByRank, q.relevantCount, 1))),
    recallAt5: mean(perQuestion.map((q) => recallAtK(q.matchesByRank, q.relevantCount, 5))),
    recallAt10: mean(perQuestion.map((q) => recallAtK(q.matchesByRank, q.relevantCount, 10))),
    mrr: mean(perQuestion.map((q) => reciprocalRank(q.matchesByRank))),
    ndcgAt10: mean(perQuestion.map((q) => ndcgAtK(q.matchesByRank, q.relevantCount, 10))),
    citationRecall: mean(perQuestion.map((q) => citationRecall(q.matchesByRank, options.citationK)))
  }

  const chunking = DEFAULT_CHUNK_OPTIONS
  return {
    baseline: 'v1.4',
    generatedBy: 'npm run eval',
    config: {
      embedding: `${LOCAL_EMBEDDING_MODEL.id}@${LOCAL_EMBEDDING_MODEL.revision} ${LOCAL_EMBEDDING_MODEL.dtype} (${LOCAL_EMBEDDING_MODEL.dimensions}d, local)`,
      chunking: {
        chunkSize: chunking.chunkSize,
        chunkOverlap: chunking.chunkOverlap,
        minChunkSize: chunking.minChunkSize,
        allowSpanPages: chunking.allowSpanPages
      },
      retrieval: 'dense',
      topK: options.topK,
      threshold: options.threshold,
      citationK: options.citationK,
      corpus: options.corpusLabel,
      documents: documentIds.size,
      questions: questions.length
    },
    metrics,
    timing: {
      latencyP50Ms: percentile(latencies, 50),
      latencyP95Ms: percentile(latencies, 95)
    },
    perQuestion
  }
}

/** Round metrics to a stable number of decimals so the JSON diffs cleanly. */
export function stabilize(report: EvalReport): EvalReport {
  const round = (value: number): number => Number(value.toFixed(6))
  return {
    ...report,
    metrics: {
      recallAt1: round(report.metrics.recallAt1),
      recallAt5: round(report.metrics.recallAt5),
      recallAt10: round(report.metrics.recallAt10),
      mrr: round(report.metrics.mrr),
      ndcgAt10: round(report.metrics.ndcgAt10),
      citationRecall: round(report.metrics.citationRecall)
    },
    timing: {
      latencyP50Ms: round(report.timing.latencyP50Ms),
      latencyP95Ms: round(report.timing.latencyP95Ms)
    },
    perQuestion: report.perQuestion
  }
}

/** Strip the non-deterministic timing so the committed JSON is diff-stable. */
export function toDeterministicReport(report: EvalReport): EvalDeterministicReport {
  return {
    baseline: report.baseline,
    generatedBy: report.generatedBy,
    config: report.config,
    metrics: report.metrics,
    perQuestion: report.perQuestion
  }
}
