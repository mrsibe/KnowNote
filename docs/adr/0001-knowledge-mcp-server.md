# ADR 0001 — KnowNote as a local MCP server

- **Status:** Accepted — implementation deferred to #80 (v1.5)
- **Date:** 2026-09-25
- **Issues:** #38 (prior art), #79 (this decision), #80 (implementation), #94 (scoped search)
- **Related:** `docs/architecture.md` (the Retrieval seam, the reader's byte-serving rule)

## Context

#38 is a user request: they reached KnowNote from an external agent and published the result as a
fork. It is real demand, and the fork is not something to merge — it was written by someone who says
they have no programming background, against a protocol revision that has since changed.

The wrong response is to become an agent platform. That is the AnythingLLM / SurfSense feature race,
and it would make KnowNote a worse knowledge base. The intended shape is the opposite:

```text
Claude Code / Codex / Cursor / Claude Desktop / other agents
                        │
                        ▼
                   KnowNote MCP          ← KnowNote is the SERVER
                        │
        list / search / read / citations
                        │
                        ▼
                the user's local knowledge base
```

KnowNote stays a desktop knowledge layer; MCP is its **export surface**.

Most of what an MCP server needs already exists, and one piece of it was written with MCP in mind.
`src/main/services/retrieval/types.ts` says so in its own header comment:

> 检索是一等能力，不是 Chat 的附属逻辑。Chat、MCP、Search 面板都通过同一个 `Retriever` 拿到同一份
> `RetrievedEvidence`，因此不必各自重写一遍 RAG，也让 #75 的 eval harness 有一个稳定的入口。

So this ADR is mostly about **not forking a query path**, and about pinning the one thing that has
already changed underneath the prior art.

## Decision

### 1. Target the `2026-07-28` protocol model, and serve both eras

**Verified against the live specification on 2026-09-25**, not a summary:

- The specification is published at `modelcontextprotocol.io/specification/2026-07-28/`.
- The specification repository's release list shows `2026-07-28` as the newest **non-prerelease**
  revision (`published 2026-07-28`), preceded by `2025-11-25`, with `2026-07-28-RC` as its
  prerelease. Nothing newer exists.

This matters because the revision #38 was written against is **not** a small delta. From
`/specification/2026-07-28/changelog`:

> **Make MCP stateless: remove the `initialize`/`notifications/initialized` handshake.** Every request
> now carries its protocol version and client capabilities in `_meta`
> (`io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientCapabilities`).

and from `/specification/2026-07-28/basic/versioning`:

> **There is no negotiation handshake.** Every request carries its protocol version, and the server
> accepts or rejects each request independently

The specification names the two eras explicitly:

| Term         | Meaning                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------ |
| **Modern**   | `2026-07-28` and later — version, identity and capabilities travel as per-request metadata |
| **Legacy**   | `2025-11-25` and earlier — a session is established with an `initialize` handshake         |
| **Dual-era** | supports both                                                                              |

**Decision: target the 2026-07-28 protocol model, and let the official SDK serve both eras over stdio.**

There is no session to establish, so a server that hand-writes an `initialize` handshake from an old
tutorial — or copies #38's fork — implements the previous era by hand. That much stands.

What does **not** stand is the conclusion I first drew from it, which was that serving 2025-era
clients would mean maintaining two server implementations. With the official TypeScript SDK v2 it is
the opposite: the SDK's stdio entry point **is** the compatibility boundary, and dual-era is its
default.

From the SDK source (`packages/server/src/server/serveStdio.ts`):

> `serveStdio` — the stdio entry point for serving the 2026-07-28 protocol revision on a long-lived
> connection, **with 2025-era serving as the default** for clients that open with the `initialize`
> handshake.
>
> The entry owns the stdio transport and **the era decision** for the connection… constructs **ONE**
> server instance from the consumer's factory for the era the client opened with, pins that instance
> for the lifetime of the connection, and passes every later message straight through to it.

The same file documents the option and the trap:

- `legacy?: 'reject' | 'serve'` — `'serve'` is **the default**; `'reject'` answers an `initialize`
  with the unsupported-protocol-version error naming the supported modern revisions.
- A `server/discover` probe is answered by an optimistically built modern instance but **does not pin
  the connection** — the spec's stdio backward-compatibility flow, where a client may probe first and
  then either continue modern or fall back to `initialize`.
- "Hand-constructed servers connected directly to a `StdioServerTransport` are unaffected by this
  entry: **they keep serving the 2025-era protocol they were written for.**" So
  `Server.connect(new StdioServerTransport())` — the obvious first thing to write — is exactly the
  modern-communication gap this ADR exists to avoid.

And from the SDK's dual-era example, which the SDK documents as the recommended first read for this
migration:

> One server factory, both protocol eras (2025 `initialize` and 2026-07-28 per-request envelope), both
> transports… the entry (`serveStdio` / `createMcpHandler`) owns the era decision, **the factory is
> era-agnostic**.

So the decision is:

|                           |                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Architectural target      | the `2026-07-28` model (per-request envelope, `server/discover`, no session)                  |
| Compatibility boundary    | the SDK's `serveStdio(factory)` — dual-era, `legacy: 'serve'` (its default)                   |
| Server code               | **one** factory, one set of tool handlers, one `Retriever`, one provenance model              |
| Hand-written legacy stack | **none.** We serve the 2025 era by _delegating_ to the SDK, never by implementing a handshake |
| Network transport         | none (see §2)                                                                                 |

This is not a compromise against the product goal; it is what makes the product goal reachable. This
ADR names Codex as a target client, and Codex today is **legacy-by-default for local stdio**:

> Add an opt-in `mcp_2026_07_28` protocol mode **while preserving the legacy lifecycle by default**…
> **Require stdio servers to opt in with `CODEX_MCP_PROTOCOL_VERSION=2026-07-28`**
> — openai/codex#35724, _Add MCP 2026-07-28 discovery support_

A modern-only server would therefore fail to connect to one of the clients this ADR was written for,
until every user sets an environment variable. Dual-era costs one function choice and removes that
entire class of "it does not work on my client" report.

**Revisit trigger:** when the clients we care about all speak `2026-07-28` comfortably, dropping the
legacy era is a **one-line change** (`legacy: 'reject'`) and should be its own small ADR with the
support matrix recorded. Until then, dual-era is the default and the burden is on dropping it, not on
keeping it.

One implementation note this pins on #80: the factory **may be called twice** for one connection
(optimistic modern probe instance, then a legacy instance when the probe falls back), so it must be
cheap and side-effect-free to construct. The SDK says so explicitly, and a factory that opens the
database or starts an index on construction would break under that flow.

Concrete requirements this pins on #80, all from the same revision:

- `server/discover` **MUST** be implemented. It is a protocol RPC, not a tool — see §3.
- Every result carries a required `resultType`. The base protocol types it as a `string`
  discriminator: _"The `result` **MUST** include a `resultType` field to indicate the type of the
  result."_ For the surface defined here, results are `"complete"`; MRTR-capable operations may return
  `"input_required"`; the Tasks extension is **out of scope** for v1 and would use its own form.
- `tools/list` results carry `ttlMs` and `cacheScope` (the `CacheableResult` interface).
- `tools/list` **SHOULD** be returned in a deterministic order — which also helps prompt caching.
- Version mismatch returns `UnsupportedProtocolVersionError` (error code `-32022`).
- `ping`, `logging/setLevel` and `notifications/roots/list_changed` were **removed**; there are no
  protocol-level sessions to keep alive.
- **Roots, Sampling and Logging are deprecated** in this revision, and new implementations should not
  add support. KnowNote's server will not implement them.

### 2. Transport: local stdio only

`stdio`: newline-delimited JSON-RPC over the standard streams of a **client-launched subprocess**.

No network listener. No remote bind. No HTTP transport in v1. Protocol semantics are the same on
every binding, but _transport_ mechanics are not — HTTP cancellation closes the request's response
stream while stdio uses `notifications/cancelled` — so the justification is not "bindings are
interchangeable" but the narrower and checkable claim: **the tool surface defined in §3 requires no
HTTP-only capability.** It is request/response reads, so stdio carries all of it, and the server is
not reachable by anything that did not start it.

### 3. Tool surface: one required protocol RPC, then read-only application tools

`server/discover` is a **protocol RPC**, not a tool. The specification requires it of the server ("servers
**MUST** implement this RPC to advertise their supported protocol versions, capabilities, and
identity") and it is what a modern client calls first. It must **not** appear in `tools/list`, and #80
must not register it as a tool named `server/discover`.

**Protocol-required RPC — the SDK entry owns this:** `server/discover`. The spec's stdio
backward-compatibility flow (probe, then continue modern or fall back to `initialize`) is implemented
by `serveStdio`; our factory supplies a server instance and does not answer discovery itself.

**KnowNote application tools:**

| Tool              | Arguments                                               | Returns                                                                      |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `list_notebooks`  | —                                                       | notebook id + title (+ source/note counts)                                   |
| `search_notebook` | `notebook_id`, `query`, `top_k` (default 5, **max 50**) | evidence **with provenance**, not bare text                                  |
| `get_source`      | `document_id`                                           | source metadata + structure outline (pages / blocks)                         |
| `read_document`   | `document_id`, `page?`                                  | canonical text, page-scoped when `page` is given, otherwise a bounded window |
| `search_notes`    | `notebook_id`, `query`                                  | notes                                                                        |

These are the tools the factory registers, and they are the same for both eras — the SDK owns the era
decision, so there is no modern list and legacy list to keep in step.

Deliberately absent in v1: **every write path**, every tool that spends money or calls a model, and
anything that reports a filesystem path. Read-only is what makes an MCP surface safe to grant to an
agent that is itself acting on untrusted document text.

Two naming points:

- A "source" in this document is a `documents` row. `docs/architecture.md` §Source provenance already
  establishes that "a document is an identity", so `get_source(document_id)` returns the source
  identity and its structure. The tool name follows the app's domain language, the argument is the
  app's existing id.
- `search_notebook` is **notebook-scoped today**, because `Retriever.search(notebookId, query, opts)`
  takes a notebook and nothing else. Per-document scoping arrives with #94 (v1.5); v1 covers "this
  specific source" through `get_source` / `read_document` rather than by inventing a filter on the
  retriever here.

`read_document` is bounded on purpose: a whole document can exceed any sensible context budget, so a
page (or a capped window) is the unit, and the tool says which one it returned.

### 4. Reuse: one query path, one provenance model

The server must sit on the app's own retrieval and provenance, not fork them.

- **Retrieval:** `Retriever` / `RetrievedEvidence` (`src/main/services/retrieval/`), the same seam
  Chat and the eval harness use. No second RAG path, no direct vector-store access from the server.
- **Provenance:** `RetrievedEvidence.locator` (`pageStart`, `pageEnd`, `blocks[]`) plus `source`
  (`title`, `type`). This is what lets an agent surface `[1] p.5` instead of an opaque chunk.
- **Citations:** the `Citation` type (`src/shared/types/citation.ts`) is deliberately a **snapshot** —
  quote, page, block id and character offsets are written when the answer is produced, and survive a
  reindex or a deleted source. An agent's citation must have the same property for the same reason.

**There is no `CitationService`.** #79 and #80 both name one, but `docs/architecture.md` recorded
after #60 that it was deliberately never created: citation parsing, resolution and source-anchor
mapping are stateless and shared between the main and renderer processes, so they are pure functions
in `src/shared/utils/` (`citations.ts`, `citationResolution.ts`, `sourceAnchor.ts`). This ADR uses the
real names. Anyone implementing #80 should read "the app's citation logic" as those modules.

Reusing them is what keeps a future "click this citation" path possible: an agent's citation carries
`documentId` + page + block, which is exactly a `SourceAnchor`, which is what #72's
`openSourceAnchor()` consumes.

### 5. Security and consent

- **Explicit opt-in.** The server runs only when the user turns it on. Off by default, and enabling it
  is a visible state: while it is active the UI says so, because a running MCP server means an
  external process can read the knowledge base.
- **No filesystem path exposure.** Tools return ids, pages and text — never `localFilePath` or any
  path. This is the same rule the reader already follows (`knownote-doc://` serves bytes **by id**,
  never by path), and it is the rule that keeps a path-traversal class of bug structurally impossible
  here.
- **Read-only in v1.** No tool mutates state, so a prompt-injected document cannot turn an agent into
  a writer. An agent can be _wrong_ about what it read; it cannot _change_ the knowledge base.
- **The blast radius is "everything in the notebook".** Search is notebook-scoped, so consenting to
  the server means consenting to that. #94 (v1.5) narrows this; until then the ADR is explicit about
  it rather than implying per-document isolation.
- **Provenance is also a security property.** Because every retrieved item carries its source, page
  and block, a claim an agent makes can be checked against the document rather than trusted.

### 6. Prior art

**#38** — acknowledged as the demand signal, and as prior art only. Its fork
(`agx7993/KnowNote-MCP-RC`) is **not merged and not used as a template**, for two reasons: it targets
a protocol revision that has since removed the handshake it implements, and #79's whole point is that
the server should be thin over the seams the app already has rather than a parallel query path bolted
onto it. The issue itself stays closed; this ADR is what it becomes.

## Consequences

- #80 is a thin adapter: **one era-agnostic factory**, protocol plumbing supplied by `serveStdio`,
  and a mapping from `RetrievedEvidence` to tool output. If it starts to look like a second retrieval
  stack — or like two sets of handlers, one per era — the decision above has been violated.
- The server is **coupled to the protocol revision**, so an implementation note must record the
  revision it was built against (as this ADR does) — the next revision will move things again.
- Serving both eras is the **default** because dropping legacy is the change that needs justifying,
  not the other way round. When the support matrix allows it, that is `legacy: 'reject'` and a small
  follow-up ADR.
- The SDK's entry point may construct the factory's server **twice** for one connection (an
  optimistic modern probe instance, then a legacy instance when the probe falls back), so the factory
  must be cheap and side-effect-free. #80 must not open the database, start an index, or attach
  process-level state in the factory body.
- Being stdio-only means no remote/multi-device access. If that is ever wanted it is a **new ADR**,
  not a flag on this one: a network listener changes the security model completely.

## Alternatives considered and rejected

- **Become an agent platform** (host agents, tool registry, workflow engine) — the AnythingLLM /
  SurfSense race. Rejected: it makes KnowNote a worse knowledge base and is not the demand in #38.
- **HTTP / Streamable HTTP transport** — rejected for v1: it introduces a network listener, and with
  it a remote attack surface, for a capability no requested client needs.
- **Merge or port #38's implementation** — rejected above; its protocol era is obsolete and it forked
  the query path.
- **Hand-implement the legacy `initialize`/session path** — rejected: `serveStdio` already serves
  2025-era clients from the same era-agnostic factory, so writing that layer by hand would duplicate
  the protocol for no capability. Delegating to the SDK is the whole point of the decision above.
- **Modern-only, `legacy: 'reject'`** — rejected for v1, and this was the first draft of this ADR. It
  looks like the smaller surface, but it trades one function argument for real client breakage: Codex
  keeps the legacy lifecycle for local stdio by default and needs
  `CODEX_MCP_PROTOCOL_VERSION=2026-07-28` to speak 2026-07-28 (openai/codex#35724). A modern-only
  server would fail to connect to a client this ADR names, and dual-era costs less than that.
- **A writable v1 (create notes / add sources from an agent)** — deferred, not rejected on principle.
  It needs its own consent and confirmation design, and it belongs in a follow-up once the read path
  is proven.
