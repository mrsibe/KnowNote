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

### 1. Target protocol revision: `2026-07-28`

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

**Decision: implement modern (`2026-07-28`) only.** There is no session to establish, so a server that
follows old tutorials or the #38 fork would implement a handshake the protocol no longer has. The
spec also requires a discovery RPC, which is what makes a modern-only server discoverable rather than
just incompatible:

> Add `server/discover`: servers **MUST** implement this RPC to advertise their supported protocol
> versions, capabilities, and identity. Clients **MAY** call it before any other request for up-front
> version selection, or use it as a backward-compatibility probe on STDIO.

**Revisit trigger:** if a client the user actually wants to use cannot speak `2026-07-28`, add the
legacy handshake as a dual-era shim. Not before — dual-era support is real complexity, and
`server/discover` is the designed answer to "what do you speak?".

Concrete requirements this pins on #80, all from the same revision:

- `server/discover` **MUST** be implemented; it is not optional.
- Every result carries a required `resultType` (`"complete"`, or `"input_required"` for multi
  round-trip); clients must treat a missing field from older servers as `"complete"`.
- `tools/list` results carry `ttlMs` and `cacheScope` (the `CacheableResult` interface).
- `tools/list` **SHOULD** be returned in a deterministic order — which also helps prompt caching.
- Version mismatch returns `UnsupportedProtocolVersionError` (error code `-32022`).
- `ping`, `logging/setLevel` and `notifications/roots/list_changed` were **removed**; there are no
  protocol-level sessions to keep alive.
- **Roots, Sampling and Logging are deprecated** in this revision, and new implementations should not
  add support. KnowNote's server will not implement them.

### 2. Transport: local stdio only

`stdio`: newline-delimited JSON-RPC over the standard streams of a **client-launched subprocess**.

No network listener. No remote bind. No HTTP transport in v1. The protocol semantics are identical on
every binding, so choosing stdio costs no capability an agent needs, and it means the server is not
reachable by anything that did not start it. Cancellation arrives as `notifications/cancelled` on this
binding.

### 3. Tool surface: small, read-only

| Tool              | Arguments                                               | Returns                                                                      |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `server/discover` | —                                                       | supported revisions, capabilities, identity (**required by the spec**)       |
| `list_notebooks`  | —                                                       | notebook id + title (+ source/note counts)                                   |
| `search_notebook` | `notebook_id`, `query`, `top_k` (default 5, **max 50**) | evidence **with provenance**, not bare text                                  |
| `get_source`      | `document_id`                                           | source metadata + structure outline (pages / blocks)                         |
| `read_document`   | `document_id`, `page?`                                  | canonical text, page-scoped when `page` is given, otherwise a bounded window |
| `search_notes`    | `notebook_id`, `query`                                  | notes                                                                        |

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

- #80 is a thin adapter: protocol plumbing plus a mapping from `RetrievedEvidence` to tool output. If
  it starts to look like a second retrieval stack, the decision above has been violated.
- The server is **coupled to the protocol revision**, so an implementation note must record the
  revision it was built against (as this ADR does) — the next revision will move things again.
- Modern-only means an old client cannot talk to it. That is deliberate and reversible via the
  dual-era trigger above.
- Being stdio-only means no remote/multi-device access. If that is ever wanted it is a **new ADR**,
  not a flag on this one: a network listener changes the security model completely.

## Alternatives considered and rejected

- **Become an agent platform** (host agents, tool registry, workflow engine) — the AnythingLLM /
  SurfSense race. Rejected: it makes KnowNote a worse knowledge base and is not the demand in #38.
- **HTTP / Streamable HTTP transport** — rejected for v1: it introduces a network listener, and with
  it a remote attack surface, for a capability no requested client needs.
- **Merge or port #38's implementation** — rejected above; its protocol era is obsolete and it forked
  the query path.
- **Implement `2025-11-25` (legacy handshake) first** — rejected: it is the previous revision, and
  building the deprecated shape first means rewriting the transport immediately after.
- **A writable v1 (create notes / add sources from an agent)** — deferred, not rejected on principle.
  It needs its own consent and confirmation design, and it belongs in a follow-up once the read path
  is proven.
