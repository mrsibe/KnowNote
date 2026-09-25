# Architecture notes

Long-lived decisions that outlive a single feature. Feature-specific design lives
in the issue tracker and in `PRODUCT.md` / `DESIGN.md`; this file records the
seams that other work is allowed to depend on.

## Source provenance

A document is an identity. Everything derived from it can be rebuilt:

```text
PDF / DOCX / URL / Note
        ↓
documents                 ← source identity (id, content, structure, localFilePath)
        ↓
document_blocks           ← derived: page / heading level / bbox / char span
        ↓
chunks + chunk_blocks     ← derived: char offsets anchored to documents.content
        ↓
embeddings + vectors      ← derived
```

Two invariants hold across the whole chain:

1. `chunk.content` and `block.text` are always `documents.content.slice(start, end)`.
   The chunker and the block builder never pre-process text, so offsets and content
   cannot drift apart.
2. Re-indexing rebuilds the derived layer in place. It never creates a second
   `documents` row, so a citation that stored a `documentId` stays valid. The parse
   structure is persisted on the source row so a rebuild does not need to re-parse a
   file that may have changed on disk.

## Retrieval seam

`src/main/services/retrieval/` is the boundary between "how do we search" and
"what do we do with the results". Anything — Chat, the search panel, the MCP
server (#80), the eval harness (#75) — goes through it instead of embedding its own
RAG path.

```ts
interface Retriever {
  search(notebookId: string, query: string, options?: RetrieveOptions): Promise<RetrievedEvidence[]>
}
```

```ts
interface RetrievedEvidence {
  chunkId: string
  documentId: string
  content: string
  score: number
  chunkIndex: number
  source: { title: string; type: string }
  locator: {
    pageStart: number | null
    pageEnd: number | null
    blocks: EvidenceBlock[]
  }
  metadata?: Record<string, unknown>
}
```

Rules:

- **Provenance travels with the result.** A retriever must return a `locator`, not a
  bare chunk, so the citation layer (#69) never has to query the database again.
- **The embedding-space guard is a precondition, not a strategy.** It stays in
  `KnowledgeService.search()`, where the notebook-level index identity is checked,
  before any strategy runs.
- **Strategies are swappable and measurable.** `DenseRetriever` is the only
  implementation today. BM25, hybrid fusion and rerankers (#77) implement the same
  interface; the eval harness (#75) measures them without touching callers.
- **Hydration is batch.** `hydrateEvidence()` resolves chunk, document and
  provenance in a constant number of queries regardless of `topK`. Per-chunk
  `resolveChunkProvenance()` calls are not allowed on the hot path.

`KnowledgeService.search()` keeps its historical `SearchResult[]` shape for IPC
compatibility and delegates to the default retriever. `SearchResult` gained a
`locator` field, which is populated from `RetrievedEvidence`; ranking, scores and
the existing fields are unchanged.

## Retrieval measurement

Retrieval quality is a number before it is an opinion. `eval/` holds a committed
corpus and a ground-truth dataset; `src/main/eval/` runs them through the normal
ingestion path and the real `Retriever`, and writes
`docs/eval/baseline-<version>.json` (deterministic) plus a markdown summary.

Rules:

- **Ground truth is corpus identity, not database identity.** A relevant location
  is `{ document: <corpus-relative path>, page, block: <ordinal>, quote? }`. Runtime
  `documentId`s are random and `blockId`s embed them, so a dataset keyed on them
  would break — instead of measuring — a chunking or parser change.
- **The baseline is frozen and the delta is explicit.** v1.5 experiments (#77,
  #78) are reported as a delta against the committed baseline, with an
  adopted-change threshold. A change that is not measured against it is not
  adopted.
- **`npm run eval` is offline.** Only `npm run eval:prepare` may download the
  pinned model. The pinned revision is part of the embedding space identity, so a
  model change is a baseline change.

The harness is a main-process entry (`--eval-harness`), like the packaged smoke
test, because the DB layer, vector store and loaders do not exist outside
Electron. See `eval/README.md` for the dataset format and commands.
