# RAG eval harness

Measures retrieval quality so "did this change make retrieval better?" has an answer.
The current numbers are frozen in [`docs/eval/baseline-v1.4.md`](../docs/eval/baseline-v1.4.md);
every v1.5 experiment (#77, #78) is reported as a delta against that file.

## Commands

```bash
npm run eval:prepare   # one-time, networked: download the pinned embedding model
npm run eval           # offline and deterministic: run the harness, rewrite the baseline
```

`eval:prepare` downloads the pinned `multilingual-e5-small` revision into the app's model
cache and verifies it. `eval` never touches the network: if the model is missing it stops
with

```
Eval model is not available locally.
Run: npm run eval:prepare
```

"Runs without configuration" means no API keys and no model/provider setup in the app — it
does not mean "no download". The 134 MB of weights are not committed.

## Layout

```text
eval/
  corpus/            first-party documents (markdown today)
  questions.jsonl    one question per line; committed with the corpus
```

The corpus is authored for this repository and carries the repository's GPL-3.0 licence,
so it is redistributable. Keeping it first-party avoids a licence question every time the
dataset needs a new question.

`questions.jsonl` schema:

```json
{
  "id": "q001",
  "question": "Why is bedload harder to measure than suspended sediment?",
  "relevant": [
    {
      "document": "river-monitoring.md",
      "page": null,
      "block": 4,
      "quote": "Bedload is the harder fraction to measure"
    }
  ],
  "goldAnswer": "optional"
}
```

Ground truth uses **corpus identity, never database identity**:

- `document` is the corpus-relative path.
- `block` is the block ordinal inside the document (`document_blocks.order`).
- `page` is `null` for unpaginated sources.
- `quote` is an optional excerpt. The runner fails if the referenced block no longer
  contains it, so a parser change cannot silently move the ground truth.

Runtime `documentId`s are random and `blockId`s embed them, so neither may appear here.
This is what lets #78 change chunking without invalidating the dataset: the ground truth
describes the source, and the runner maps it to whatever ids that run produced.

## What it does

1. Creates a throwaway database (a temp profile; the developer's own DB is never opened).
2. Indexes the corpus through the normal ingestion path (`addDocumentFromFile`), so blocks,
   chunking and embeddings are the real ones.
3. Maps each ground-truth `document`/`block` to the run's runtime ids.
4. Runs the real `Retriever` (`KnowledgeService.search` → `DenseRetriever`).
5. Writes `docs/eval/baseline-<version>.json` (deterministic) and `.md` (with timing).

## Metrics

- **Recall@1/5/10** — share of ground-truth blocks covered by the first k passages.
- **MRR** — reciprocal rank of the first relevant passage.
- **nDCG@10** — binary-gain discounted cumulative gain.
- **Citation recall** — share of the first `citationK` passages that resolve into ground
  truth. This is the answer-level metric: the failure it catches is a *wrong* citation.
- **Latency p50/p95** — informational only. Timing is **not** frozen, and the committed
  JSON excludes it so two runs diff cleanly.

## Determinism

`npm run eval` twice must print the same `[eval] metrics {...}` line:

```bash
node scripts/eval.mjs | grep '\[eval\] metrics'
node scripts/eval.mjs | grep '\[eval\] metrics'
```

The local embedding backend always runs (`KNOWNOTE_EVAL_MODEL_CACHE` can point CI at its own
cache), so a developer's remote embedding configuration cannot leak into the baseline.
