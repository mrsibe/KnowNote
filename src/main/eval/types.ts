/**
 * RAG eval harness types (#75).
 *
 * Ground truth is expressed in **corpus identity**, not database identity. A
 * `document` is the corpus-relative path, a `block` is the block ordinal inside
 * that document. Runtime `documentId`s are random, and `blockId` embeds them, so
 * neither may appear in the committed ground truth: #78 changes chunking, and a
 * ground truth bound to a runtime id would break instead of measuring the change.
 */

export interface EvalRelevantLocation {
  /** Corpus-relative path, e.g. `river-monitoring.md`. */
  document: string
  /** Page number when the source is paginated, else null. */
  page: number | null
  /** Block ordinal inside the document (`document_blocks.order`). */
  block: number
  /** Optional excerpt used to detect parser drift in `block`. */
  quote?: string
}

export interface EvalQuestion {
  id: string
  question: string
  relevant: EvalRelevantLocation[]
  goldAnswer?: string
}

/** One resolved ground-truth location, after runtime id mapping. */
export interface ResolvedGroundTruth {
  document: string
  documentId: string
  blockId: string
  page: number | null
  block: number
}

export interface EvalMetrics {
  recallAt1: number
  recallAt5: number
  recallAt10: number
  mrr: number
  ndcgAt10: number
  /** Share of the top-k citations that resolve into ground truth. */
  citationRecall: number
}

export interface QuestionReport {
  id: string
  question: string
  firstRelevantRank: number
  relevantCount: number
  retrievedCount: number
  /** Ground-truth indices matched by each retrieved rank, in rank order. */
  matchesByRank: number[][]
}

export interface EvalReport {
  baseline: string
  generatedBy: string
  config: {
    embedding: string
    chunking: {
      chunkSize: number
      chunkOverlap: number
      minChunkSize: number
      allowSpanPages: boolean
    }
    retrieval: string
    topK: number
    threshold: number
    citationK: number
    corpus: string
    documents: number
    questions: number
  }
  metrics: EvalMetrics
  timing: { latencyP50Ms: number; latencyP95Ms: number }
  perQuestion: QuestionReport[]
}

/**
 * The committed report: everything that is identical between two runs. Wall-clock
 * timing is deliberately absent, so `npm run eval` twice produces a byte-identical
 * JSON that a PR can actually diff.
 */
export interface EvalDeterministicReport {
  baseline: string
  generatedBy: string
  config: EvalReport['config']
  metrics: EvalMetrics
  perQuestion: QuestionReport[]
}
