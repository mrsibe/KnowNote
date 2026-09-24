# Product

<!-- impeccable:product-schema 1 -->

> **Provenance.** The maintainer asked for this file to be written directly
> instead of through the init interview, so nothing here is an interview answer.
> Every fact is either sourced to a repository artifact — README, an issue,
> `DESIGN.md`, `CONTRIBUTING.md`, `package.json` — or marked `[inferred]`, which
> means it was read out of the code and the direction the repository already
> states. Confirm or correct the `[inferred]` items before treating them as
> settled, and treat the two items under "Undecided" in
> [Capabilities and Constraints](#capabilities-and-constraints) as open questions,
> not as answers.

## Platform

web

The shell is Electron, so the interface is drawn by a web engine and this is the
only schema value that fits. `adaptive` is wrong: the design language does not
switch per OS. Shipped artifacts are Windows and macOS (Apple Silicon) only, but
that is a release-pipeline fact, not a platform fact — see
[Operating Context](#operating-context).

## Users

People who read long documents for study or research and need to be able to trust
what they write down: graduate students, researchers, and analysts working from
papers, PDFs, slide decks and web pages. `[inferred]` from "research workspace" in
the README and "research/learning workstation" in #65.

Single-user and local by construction: one person, their own machine, a growing
body of sources, no account, no sync, no collaboration, no telemetry (README,
"What is not here yet").

The job to be done, in the maintainer's own words in #65:

```text
import → read → annotate/cite → ask → inspect the source → jump back → excerpt into a note
```

## Product Purpose

KnowNote turns a person's own documents into a knowledge base they can question,
and answers from those documents with a reference back to the passage the answer
came from. Parsing, splitting, embedding and vector search run inside the
application; the only thing that leaves the machine is the request to the model
endpoint the user configured (README).

Success means the loop above closes: the reader can go from an answer to the
original page and paragraph and back without leaving the app, and can inspect
what an answer was actually built from instead of taking it on faith (#65, #82).

## Positioning

**A citation resolves to a source location, not to a chunk.**

A chunk can be re-split, re-embedded, or replaced by a different retrieval
strategy; a citation has to survive all of that. The architecture therefore
persists source blocks carrying page, heading level and character span, and has
chunks reference block spans rather than the reverse (#82). That is the mechanism
a neighbouring product cannot copy by shipping a feature, because it constrains
the indexing path itself.

The corollary is written down by the maintainer rather than discovered by a user:
in #82, "the README claims … precise source traceability. The claim is ahead of
the code", and the indexing path was actively discarding the structure it had
already parsed. Do not claim more than the shipped build does.

## Operating Context

- **Bring your own model.** Any OpenAI-, Anthropic- or Google-compatible
  endpoint, or a local server such as Ollama. No bundled chat model, no account
  (README).
- **Offline retrieval is a supported state, not a degraded one.** The embedder
  (`Xenova/multilingual-e5-small` through ONNX, 384 dimensions, `q8`, revision
  pinned, remote loading disabled) downloads once and then runs in the Electron
  main process (README, Architecture).
- **Storage** is SQLite with `sqlite-vec` through Drizzle ORM; one vector table
  per notebook, each carrying its own width, so vectors from different embedding
  spaces are never compared (README; #47).
- **Publication position:** unsigned and un-notarised builds, no Linux build,
  macOS is Apple Silicon only. `[inferred]` This describes what the release
  pipeline publishes today, not what the code can build.
- **Two locales** ship: English and Simplified Chinese, kept in sync
  (CONTRIBUTING.md).
- **Work happens against a written interface system.** `DESIGN.md` is declared
  the single source of truth for UI decisions and is guarded by
  `npm run check:design`; the guard runs in CI before the build matrix.

## Capabilities and Constraints

Confirmed by the README and the code:

- Import PDF, Word, PowerPoint and web pages; each format keeps the structure it
  has — page boundaries, headings, slides.
- Passage splitting at roughly 500 characters with ~50 characters of overlap,
  recording start and end offsets in the extracted text.
- Local embedding and vector retrieval, and chat over retrieved passages.
- Notes (Tiptap) and mind maps beside the sources; quiz and Anki card surfaces
  exist and open in their own windows.
- Protocol-based model connections — OpenAI Completions, OpenAI Responses,
  Anthropic Messages, Google Generative AI — instead of a vendor registry. A
  model is a connection: protocol + base URL + API key + model ID, with the
  capability declared explicitly by the user rather than guessed (#44).
- **Structural constraints:** Electron with a main/renderer/preload/shared split;
  native modules (`better-sqlite3`, `sqlite-vec`) unpacked from the asar; a
  deliberately minimal `dependencies` list, because anything listed there stays a
  runtime `require()` and has to be collected into the package (package.json,
  electron-builder.yml).
- **Process constraints:** Conventional Commits for both commits and PR titles,
  because the prefix selects the label and the release-notes section; a single
  `Verify` workflow is the gate; `en-US` and `zh-CN` locales move together
  (CONTRIBUTING.md).

Undecided, recorded rather than resolved:

- The README says quiz generation, audio transcription and slide generation are
  "in development" and "not in any release", but quiz and Anki surfaces are
  implemented in the renderer. Which statement is current needs a maintainer
  answer, and the answer decides whether those surfaces are promoted or hidden.
- No accessibility standard is named anywhere in the repository. See
  [Accessibility & Inclusion](#accessibility--inclusion).

## Brand Commitments

- **Name:** KnowNote. **Tagline in use:** _A local-first research workspace._
  **Sub-line:** _Research your documents. Trust every answer._ **Position line:**
  _Desktop · Local RAG · Bring your own model · Open source_ (README).
- **Licence:** GPL-3.0. Contributions are licensed under the same terms.
- **Voice:** plain, technical, candid about limits. The README spends a section on
  "What is not here yet", and #82 records the maintainer catching their own claim
  running ahead of the code. That habit is a commitment, not a style preference:
  limits are documented in the same voice as features.
- **The website is the long-form positioning.** knownote.pages.dev carries the
  mechanism, the limits, and a comparison with NotebookLM and AnythingLLM. The
  README points at it as "the full story". `[inferred]` That copy is not in this
  repository and must not be re-invented here.
- **No further binding identity.** No palette, typeface or mark is declared
  binding beyond what `DESIGN.md` defines; `src/renderer/src/assets/logo.png` and
  `resources/` hold the only brand assets. `[inferred]`

## Evidence on Hand

- `DESIGN.md` — the executable interface system, enforced by
  `npm run check:design` (`scripts/check-design-tokens.mjs`).
- `.github/images/screenshot-main.png` — the only real screenshot in the
  repository; the README embeds it as the product preview.
- `test/fixtures/sample.pdf`, `sample.docx`, `sample.html` — parser fixtures, plus
  a Node built-in test suite with no added runtime dependency.
- The issue tracker holds the roadmap: #82 (the v1.4 epic) and its children
  #65–#80, which the README's "not here yet" section is written against.

**Absences that later work must not fill in.** There are no customer
testimonials, no case studies, no benchmark numbers, no performance claims, no
download or user counts, and no pricing. Do not author any of these; if proof is
needed, ask for it.

## Product Principles

1. **Provenance before fluency.** An answer without a resolvable source location
   is an unverified claim. The citation is the product, not the chat bubble.
2. **Local is the default, not a mode.** Retrieval has to work with the network
   off, and the only outbound request is the endpoint the user configured.
3. **Say what is not there.** A claim ahead of the code is a bug, and the README
   is the place that gets corrected — not the roadmap.
4. **The document is the subject.** Reading is the anchor and the conversation is
   an overlay; chrome stays neutral and quiet (#65, `DESIGN.md`).
5. **Structure is preserved, not normalised.** Page boundaries, headings and slide
   structure survive import, because a citation depends on them.

## Accessibility & Inclusion

Enforced today (`DESIGN.md`, `npm run check:design`):

- Every interactive surface defines `hover`, `selected`, `focus-visible` and
  `disabled`; missing states are treated as bugs.
- Both themes must be usable on every page, and colour is never the only carrier
  of state — pair it with weight, an icon or a border.
- Focus rings are explicitly part of the state contract rather than an addition.

Required by #65, not yet built:

- A keyboard-first path to open a citation, return to the chat, and move between
  the three zones, reusing `ShortcutManager` + `useShortcutExecutor`.

Undecided:

- No target standard is named — WCAG 2.2 AA, or anything else.
- No screen-reader testing record, and no stated i18n requirement beyond keeping
  `en-US` and `zh-CN` in sync.
