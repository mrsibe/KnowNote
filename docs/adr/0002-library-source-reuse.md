# ADR 0002: Library sources and notebook memberships (#99)

Status: accepted for implementation, recorded before code changes.

## Schema and identity

Add `library_sources` as the durable library identity and snapshot (canonical text,
parser structure, original URI and local file). Add nullable `documents.sourceId`
referencing it, unique within a notebook. Existing `documents` rows remain notebook
memberships and retain their IDs: historical citations and retrieval scopes must
not change during migration. Existing imports are backfilled one-to-one (do not
merge unrelated sources merely because titles or paths match).

The existing document shape is a compatibility projection of the snapshot plus
membership-local indexing state. Keep the current text/structure fields as cached
projections for the existing retrieval/readers; reuse performs no parsing or file
copy. A library snapshot is immutable while shared. Explicit file refresh creates
a new library snapshot for that membership (copy-on-write); it never changes the
text or page offsets underneath another notebook's citations. Reindex uses the
persisted snapshot, not the original mutable file.

## Embedding-space rule

Chunks, chunk/block mappings, ingestion attempts, indexing status, and vectors
remain per membership/notebook. Citation document IDs identify the membership;
its `sourceId` identifies the shared library snapshot. This preserves every
existing citation's notebook context and page/span contract.

Reuse is an explicit operation. If a donor membership is indexed and its stored
space identity and vector width match the target notebook (and the configured
embedding space), copy its chunks, provenance and vectors with new membership-
local IDs. Never call the embedding provider in the reuse operation. An empty
target may adopt the matching donor space. If there is no compatible indexed
donor, add a pending membership and show that indexing is required; only the
user's explicit reindex action may produce embeddings. Same dimensions alone
are not proof of compatibility. Copying never invalidates other target sources.

A remote embedding connection cannot report its vector width before the first
embedding, so its space id is dimension-agnostic while `notebook_embedding_spaces.dimensions`
carries the width measured during indexing. Reuse therefore compares the exact
space id and, when the current width is known, that width; the donor's persisted
width is separately checked against its own vector table and against every chunk's
embedding row and vector row, and a vector copy that does not affect exactly one
row fails the attach instead of producing a half-indexed membership.

## Removal and lifecycle

Removing a source removes only that notebook's membership and derived index.
Keep the library snapshot and file, including after the last membership is
removed; it remains available for later reuse. Permanent library deletion is a
separate, explicitly confirmed operation and is refused while memberships exist.
Notebook deletion follows the same detach-only semantics. A notebook must never
unlink a file still used by a library source.

## UI and validation

Add “From library” to the existing source-import UI, list snapshots not already
attached, and distinguish ready-to-reuse sources from those needing explicit
indexing. Add confirmed permanent deletion for unused library sources. Provide
both English and Chinese strings. Regression tests cover legacy migration,
two-notebook reuse, no embedding calls on attach, embedding-space mismatch,
page/span preservation, independent removal, notebook deletion and confirmed
last-copy deletion. No automatic deduplication of new imports is introduced.
