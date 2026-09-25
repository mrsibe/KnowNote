# Dependency audit: the three that gate provenance and retrieval

This document covers **exactly three** dependencies, because those are the three where a
maintainer decision actually changes the v1.4/v1.5 roadmap:

|                                                  |                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `sqlite-vec`                                     | the retrieval substrate — its `vec0` capability set bounds what retrieval can do |
| `pdfjs-dist`                                     | the PDF parser, and the parser is the app's core input                           |
| `@huggingface/transformers` + `onnxruntime-node` | the local embedding runtime                                                      |

Everything else in `package.json` is deliberately **out of scope and undocumented**. A full
inventory of ~70 direct dependencies produces backlog rather than decisions; a fourth entry is
added here only when a committed feature is blocked by it, with that feature as the reason.

Verdicts up front:

| Dependency                                       | Verdict                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `sqlite-vec`                                     | **KEEP** — with a recorded, low-risk option to leave the alpha channel |
| `pdfjs-dist`                                     | **REPLACE (upgrade)** → tracked as #121, a v1.4 blocker                |
| `@huggingface/transformers` + `onnxruntime-node` | **KEEP** — already on the latest published versions                    |
| FTS5 (for #77's BM25/hybrid)                     | **available** — proven in the packaged app, see below                  |

## Read `dependencies` vs `devDependencies` the way this repo means it

This is required context, because the usual convention is **inverted here** and it is the single
most likely way someone mis-fixes a dependency later.

`electron.vite.config.ts` (see its comment on `rollupOptions.external`) states it directly:

> Every entry in package.json `dependencies` is already externalized automatically (electron-vite's
> `build.externalizeDeps` defaults to true)

So:

- **`dependencies`** = resolved at runtime from `node_modules` **inside the packaged app**. These
  are the things rollup cannot or must not inline.
- **`devDependencies`** = **inlined into the bundle** by rollup. They do not need to exist at
  runtime, and they are _not_ missing just because a file in `src/main` imports them.

Consequences that matter:

1. "A shipped file imports something declared in `devDependencies`" is **correct here**, not a bug.
   Promoting such an import into `dependencies` would externalize it — a bigger package and a new
   runtime resolution risk, which is how v1.2.1 shipped a `MODULE_NOT_FOUND`.
2. Only **nine** entries are in `dependencies`, and each is deliberate:
   `@huggingface/transformers`, `@mixmark-io/domino`, `anki-apkg-export`, `better-sqlite3`, `jsdom`,
   `onnxruntime-node`, `pdfjs-dist`, `sharp`, `sqlite-vec`.
   `sharp` and `@mixmark-io/domino` are transitive dependencies of `@huggingface/transformers` and
   `turndown` respectively that are **deliberately promoted so they ship**; neither is imported by
   this repository's source.
3. `better-sqlite3` is rebuilt against the Electron ABI during packaging. It **cannot be loaded
   from plain Node** (`require('better-sqlite3')` fails), so any question about the shipped SQLite
   has to be answered inside Electron — see the FTS5 section.

## 1. `sqlite-vec` — KEEP

|                      |                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Declared / installed | `0.1.7-alpha.2` (exact pin, no range)                                                    |
| Ships as             | confirmed at runtime by the packaged app: `vec_version()` → `v0.1.7-alpha.2`             |
| Upstream             | `latest` dist-tag is **`0.1.9`**; `alpha` is `0.1.10-alpha.4`; last published 2026-05-18 |
| Licence              | MIT OR Apache-2.0                                                                        |
| Native               | yes — loadable SQLite extension, unpacked (`sqlite-vec-linux-x64`, ~156 KB shipped)      |

**What it constrains.** `vec0` is the substrate every retrieval strategy sits on. Its capability
set (distance metrics, metadata filtering, table lifecycle) bounds what `DenseRetriever` and
whatever #77 adds can express. The workspace already depends on its lifecycle behaviour rather than
just its search: `SQLiteVectorStore` treats vector width as a per-notebook decision, refuses a
width change without an explicit rebuild, and drops a notebook's vector table when the notebook is
deleted — all of that is `vec0` semantics, and the packaged smoke test asserts it.

**The alpha question.** We pin an alpha while a stable `0.1.9` exists upstream. That is a real
inconsistency, but it is not currently causing a problem, and the pin is exact so the resolved
version cannot drift on its own.

**Replacement cost.** There is no cheaper option. Replacing the vector store means either a
pure-JS index (losing the SQLite-side filtering and the shared transaction boundary with
`better-sqlite3`) or another native ANN library (a second native addon in `asarUnpack`, a new
persistence format, and a re-index migration for existing users).

**Recommendation: KEEP.** The dependency is the right shape for this architecture, is already
asserted end to end by the packaged smoke test, and replacing it would be a rewrite of the retrieval
storage layer for no capability we currently lack.

**Recorded follow-up (not in #62):** moving from `0.1.7-alpha.2` to the stable `0.1.9`. Because the
pin is exact, that is a one-line manifest change plus a smoke run and the existing retrieval tests —
worth doing as its own small change, so a `vec0` behaviour change cannot hide inside a bigger PR.

**Blast radius:** native addon, `asarUnpack` (`node_modules/sqlite-vec/**`,
`node_modules/sqlite-vec-*/**`), and an entry in `dependencies`.

## 2. `pdfjs-dist` — REPLACE (upgrade) → #121

|                      |                                                         |
| -------------------- | ------------------------------------------------------- |
| Declared / installed | `^5.4.530` → lockfile resolves to **`5.7.284`**         |
| Upstream             | latest is **`6.3.289`**; last published 2026-08-29      |
| Licence              | Apache-2.0                                              |
| Native               | no — JavaScript only, so it needs no `asarUnpack` entry |

**Security follow-up: #121** (v1.4 blocker). `5.7.284` is inside the affected range of
GHSA-hq66-cqwq-w95j / CVE-2026-16633 — _arbitrary JavaScript execution upon opening a malicious
PDF_ — `>=5.6.83 <6.2.108`, fixed in `6.2.108`. The exploit path requires PDF.js's scripting
machinery, which this repository does not currently use (no `AnnotationLayer`, no
`pdfjs-dist/web/*` import, and `PDFScriptingManager` does not exist in the API build at all), so
the issue is not currently reachable. It is still a blocker: "not reachable" rests on our own call
sites, and the input model here is untrusted documents. Full evidence is recorded in #121.

**What it constrains.** It is the parser for the app's core input, and it is the dependency whose
packaging constraint is most likely to change under our feet:

- It is externalised (`dependencies`), and **two** consumers import it — the **main** process
  (`src/main/services/loaders/PdfLoader.ts`, the `legacy` build, `getTextContent()` only) and the
  **renderer** (`src/renderer/src/components/notebook/source/reader/PdfSourceReader.tsx`, the API
  build plus the worker via `?url`).
- #71 carries a timeboxed spike for moving the parser into the renderer only. That would remove it
  from the main process, which changes this row's blast radius — and, relevant to #121, would put
  the vulnerable code in a different process context.

**Recommendation: REPLACE.** Upgrade to `>=6.2.108`. Per this audit's rules that is its own issue
with its own rollback plan (**#121**), not a dependency bump hidden in an audit PR.

**Blast radius:** an entry in `dependencies`; no native addon; no `asarUnpack` entry; two process
boundaries (main + renderer) plus the parsing worker.

## 3. `@huggingface/transformers` + `onnxruntime-node` — KEEP

|                      |                                                                       |
| -------------------- | --------------------------------------------------------------------- |
| Declared / installed | `^4.3.0` → `4.3.0`; `^1.30.0` → `1.30.0`                              |
| Upstream             | **both are already the latest published** (2026-09-16 and 2026-09-18) |
| Licence              | Apache-2.0 and MIT                                                    |
| Native               | yes — `onnxruntime-node` ships `libonnxruntime.*`, unpacked           |

**What it constrains.** This pair _is_ the local embedding backend (`LocalEmbeddingBackend`), so it
determines which models are usable, what the first-use download costs, and whether #95 (model
switching) is realistic. The model is pinned deliberately: `Xenova/multilingual-e5-small` at
revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`, `q8`, with file sizes and SHA256s verified
before anything is written to the cache. The download is **134 MB** on disk, cached by CI and
keyed on the pin.

**Runtime evidence.** The packaged smoke test loads the real module graph — both
`@huggingface/transformers` and `onnxruntime-node`, including the native binding — and the eval
harness runs real retrieval against a real model, so this is exercised rather than assumed.
`onnxruntime-node` is also pulled in by `@huggingface/transformers`, which additionally imports
`sharp` for image paths; that is why `sharp` and `@img/*` are promoted into `dependencies` and
`asarUnpack`.

**Artifact evidence (linux x64 unpacked build).** Total unpacked `dist/linux-unpacked` is **747 MB**
(`app.asar` 245 MB + `app.asar.unpacked` 218 MB). Within that:

| Item                   | Shipped                                       |
| ---------------------- | --------------------------------------------- |
| `onnxruntime-node`     | **155 MB**, of which **152.7 MB is binaries** |
| `@napi-rs`             | 32 MB                                         |
| `@img` (sharp/libvips) | 19 MB                                         |
| `better-sqlite3`       | 13 MB                                         |
| `sqlite-vec`           | 156 KB                                        |

Of the 152.7 MB of onnxruntime binaries, only `linux/x64/libonnxruntime.so.1` (**43.7 MB**) is
usable by this build. The remaining **~109 MB (72%) is for other platforms and architectures**:

| Binary                                     | Size    | Usable here?                             |
| ------------------------------------------ | ------- | ---------------------------------------- |
| `linux/x64/libonnxruntime.so.1`            | 43.7 MB | **yes**                                  |
| `darwin/arm64/libonnxruntime.1.dylib`      | 42.5 MB | no                                       |
| `darwin/arm64/libonnxruntime.1.30.0.dylib` | 42.5 MB | no — the same binary under a second name |
| `linux/arm64/libonnxruntime.so.1`          | 24.0 MB | no (x64 build)                           |

This is **evidence, not a task**: it does not change the verdict on this dependency, and pruning it
is a packaging concern with its own risk (a filter that is wrong once produces an app that starts on
the CI runner and crashes on a user's machine). It is recorded here because it is the material fact
behind the 747 MB figure, and because "the embedding runtime is large" is more accurate as "the
embedding runtime ships the wrong platforms".

**Recommendation: KEEP.** It is the latest published version, it is the capability the local-first
promise depends on, and the alternative (a hosted embedding API) would break the product's
local-first premise. The per-platform binary pruning above is a follow-up to consider on its own
merits, not a reason to replace the dependency.

**Blast radius:** a native addon with large cross-platform binaries, `asarUnpack`
(`node_modules/onnxruntime-node/**`, `node_modules/sharp/**`, `node_modules/@img/**`), and entries
in `dependencies`.

## FTS5 in the shipped build: available

#77 wants BM25/hybrid retrieval, and SQLite's BM25 lives in the FTS5 module. Whether FTS5 exists is
a property of the SQLite that `better-sqlite3` bundles, not of anything this repository compiles, so
it had to be answered against the **shipped** build. It cannot be answered from plain Node at all:
`better-sqlite3` is rebuilt for the Electron ABI and fails to load there.

The check now lives in the packaged smoke test (`src/main/smokeTest.ts`) and inserts, matches and
ranks rather than only reading a compile flag, because a flag is not proof that `MATCH` and `bm25()`
work in the build users actually run.

Result from `npm run build:unpack && npm run smoke:packaged`:

```text
[SmokeTest] ok   sqlite-vec reports version v0.1.7-alpha.2
[SmokeTest] ok   FTS5 is available and ranks: sqlite 3.53.2, ENABLE_FTS5 flag present,
                 bm25() = -9.447852760736198e-7
[SmokeTest] PASS - 20 checks passed
```

**FTS5 is available: `ENABLE_FTS5` is compiled in, `MATCH` returned the expected row, and `bm25()`
produced a usable rank on SQLite 3.53.2.** #77 therefore has no blocker from the SQLite side, and
BM25/hybrid is a design choice rather than a build constraint.

## How to reproduce

```bash
npm ls sqlite-vec pdfjs-dist @huggingface/transformers onnxruntime-node   # resolved versions
npm audit --omit=dev --registry=https://registry.npmjs.org                # the pdfjs advisory
npm run build:unpack && npm run smoke:packaged                            # FTS5 + native modules
du -sh dist/*/resources/app.asar dist/*/resources/app.asar.unpacked       # artifact size
```

`npm audit` needs the explicit registry here: a mirror registry may not implement the audit
endpoint (`NOT_IMPLEMENTED`), which is an environment detail and not a repository defect — `.npmrc`
pins no registry.
