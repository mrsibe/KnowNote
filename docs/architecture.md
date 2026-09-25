# Architecture notes

Long-lived decisions that outlive a single feature. Feature-specific design lives
in the issue tracker and in `PRODUCT.md` / `DESIGN.md`; this file records the
seams that other work is allowed to depend on.

## Module seams

Three seams carry the v1.4 features. These are the names that **actually exist in the
code** — #60 guessed `DocumentParser` / `SourceStore` / `CitationService`, and none of
the three was needed. See [considered and rejected](#seams-considered-and-rejected)
for why, so the next reader does not re-litigate it.

### Document

| Role                          | What it is                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Parsing contract              | `IDocumentLoader` — `src/main/services/loaders/types.ts`                       |
| Format dispatch               | `FileParserService` — picks a loader by extension / MIME                       |
| Implementations               | `PdfLoader`, `DocxLoader`, `MarkdownLoader`, `PptLoader`, `WebLoader`          |
| Persistence and orchestration | `KnowledgeService` — `documents`, `document_blocks`, chunks, vectors, re-index |
| Derived structure             | `services/blocks/documentBlocks.ts`, `ChunkingService`, `chunkProvenance.ts`   |

Data invariants for this seam are in [Source provenance](#source-provenance).

### Retrieval

`Retriever` (interface) and `RetrievedEvidence` (result) in
`src/main/services/retrieval/`; `DenseRetriever` is the only implementation today.
Rules are in [Retrieval seam](#retrieval-seam).

### Application

**This seam is an architectural boundary, not a class.** There is deliberately no
`ApplicationService` and no `CitationService`:

- **IPC handlers** (`src/main/ipc/`) translate a request into a service call and
  translate the answer back. No handler calls `getDatabase()` itself.
- **Application services** — `ItemService`, `AnkiCardService`, `MindMapService`,
  `QuizService` — own their tables and may call `getDatabase()`.
- **Shared pure functions** — `src/shared/utils/`: `citations.ts`,
  `citationResolution.ts`, `answerSources.ts`, `sourceAnchor.ts`, `excerpt.ts` — hold
  citation parsing/resolution and source-anchor mapping, because the main _and_ the
  renderer process both need them and they carry no state.

**Known legacy exception, not addressed here.** `noteHandlers.ts`,
`notebookHandlers.ts` and part of `chatHandlers.ts` call `db/queries` directly instead
of a service. That predates v1.4 and #60 deliberately leaves it alone: its non-goals
forbid removing a legacy path before a real feature exercises the replacement.

### Call paths

Concrete, checkable against the code:

```text
src/main/ipc/itemHandlers.ts
  → ItemService                     (Application)
    → getDatabase()
      → Drizzle / SQLite

src/main/ipc/knowledgeHandlers.ts
  → KnowledgeService                (Document)
    → getDatabase()
      → Drizzle / SQLite

knownote-doc://<documentId>
src/main/protocol/documentProtocol.ts
  → KnowledgeService.getDocumentLocalFilePath(id)   (Document, narrow query)
    → getDatabase()
      → documents.localFilePath
```

The protocol path is the one #60 changed. It used to run its own
`select().from(documents)` (introduced by #116), which made an Electron plumbing module
depend on the database from outside the Document/Application layers. It now receives
the narrow query as a parameter, and `test/architectureBoundary.test.ts` fails if
database access reappears under `src/main/protocol/`. The narrower query is deliberate:
the handler needs “a readable file for this id”, not a whole `Document` row.

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

## Source reader

The reader is not "the PDF component". It is the surface that renders whatever
structure a source has, behind one format-agnostic contract:

```ts
interface ReaderHandle {
  openAt(anchor: ReaderAnchor): void
  getSelection(): ReaderSelection | null
}
```

`ReaderAnchor` is `{ documentId, page?, blockId?, startOffset?, endOffset? }`,
and `ReaderSelection` is the same shape plus the selected `text`. PDF is the full
implementation in v1.4 (pages, text layer, block overlay); every other format uses
a text reader. Nothing downstream may branch on which one is mounted — #72
(citation click) and #73 (excerpt to note) only use `openAt` / `getSelection`.

Rules:

- **Bytes are served by id, never by path.** `knownote-doc://docs/<documentId>` is
  resolved against `documents.localFilePath` in the main process. The renderer
  never constructs a filesystem path, and an unknown id is a 404.
- **Blocks travel with the source.** `document_blocks` holds page, char span and
  normalized bbox; `openAt({ page, blockId })` uses them to scroll and highlight,
  so the reader does not re-derive geometry from chunk text.
- **The text layer is real text.** pdfjs's `TextLayer` is rendered over the canvas
  so `getSelection()` can map a DOM selection back to a source location; selecting
  the canvas would give nothing.

## Seams considered and rejected

Recorded so they are not proposed again without a new reason. Each was considered
while building v1.4 and deliberately not introduced.

- **`DocumentParser` — rejected.** `IDocumentLoader` plus `FileParserService` already
  form the parsing seam, and all five format loaders implement it. A second interface
  over the same boundary would be duplicate abstraction with no new consumer.
- **`SourceStore` — currently rejected.** There is no storage consumer independent
  enough to justify a repository layer: the provenance helpers
  (`chunkProvenance.ts`) take the database handle as an explicit parameter, and
  `KnowledgeService` still owns Document persistence orchestration. Revisit only if a
  second, genuinely independent storage consumer appears.
- **`CitationService` — rejected.** Citation parsing, resolution and source-anchor
  mapping are stateless and shared between the main and renderer processes. Pure
  functions in `src/shared/utils/` are the right shape; a service would add a
  process-boundary round trip and a lifecycle for something that has no state.
- **A Model seam — not part of this work.** #44 already established it
  (`ModelClient` + `protocols/*`, driven by `ConnectionManager`); it is not rebuilt or
  re-documented here.
