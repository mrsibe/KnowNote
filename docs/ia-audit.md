# Current-state IA audit — Workspace shell (#65)

Status: **audit only, no code**. This document maps the v1.4 renderer shell as it
exists after #60–#126, then checks it line by line against #65's acceptance. It
decides whether #65 is a small IA closure or a larger UI change. It does **not**
change any surface.

> This file is **implementation evidence**, not the contract. The normative IA is
> [DESIGN.md §Information architecture](./DESIGN.md#information-architecture).
> Where the two disagree, `DESIGN.md` wins; keep the findings here as the record
> of what was observed before the change.

Method matches #60: read the shipped sources, record the current call/entry path,
and separate "the component exists but the entry or hierarchy is wrong" from
"the shell capability is genuinely missing".

Sources read: `App.tsx`, `NotebookLayout`, `TopNavigationBar`,
`ResizableLayout`, `SourcePanel`, `ProcessPanel`, `NotePanel`, `ItemList`,
`MessageItem`, `CitationChip`, `AnswerSources`, `PdfSourceReader`,
`useSourceAnchorNavigation`, `uiStore`, `chatStore`, `appendExcerptCommand`,
`excerpt.ts`, `sourceAnchor.ts`, `DESIGN.md` §Workspace shell, both locale trees.

---

## 1. Shell map

### 1.1 Routes (`src/renderer/src/App.tsx`)

| Route                                              | Element            | Notes                                     |
| -------------------------------------------------- | ------------------ | ----------------------------------------- |
| `/onboarding`                                      | `OnboardingPage`   | gated on `hasCompletedOnboarding`         |
| `/`                                                | `NotebookListPage` | Home; redirects to onboarding if not done |
| `/notebook/:id`                                    | `NotebookLayout`   | the workspace                             |
| `/mindmap/:notebookId`, `/mindmap/view/:mindMapId` | `MindMapPage`      | separate `BrowserWindow`                  |
| `/quiz/:notebookId`, `/quiz/view/:quizId`          | `QuizPage`         | separate window                           |
| `/anki/:notebookId`, `/anki/view/:ankiCardId`      | `AnkiPage`         | separate window                           |

`HashRouter`. There is **no route for reading, chat or notes** — all three live
inside `/notebook/:id` as panels. Artifact windows are opened imperatively by
`NotePanel` via `window.api.{mindmap,quiz,anki}.openWindow(...)`.

### 1.2 Workspace composition (`NotebookLayout.tsx`)

```text
┌─ WindowTitleBar ── TopNavigationBar ────────────────────────────────┐
│  tabs = [Home] + opened notebooks + [+]            settings button  │
├──────────────── ResizableLayout (3 cards + 2 gutters) ──────────────┤
│  leftPanel            centerPanel               rightPanel          │
│  <SourcePanel/>       <ProcessPanel/>           <NotePanel/>        │
│  = Library            = Chat transcript          = Notes + artifacts│
│  list OR reader       composer + messages        ItemList + editor  │
└─────────────────────────────────────────────────────────────────────┘
```

Zone labels currently in the UI: left header **"Knowledge Base"**, right header
**"Creative Space"**. Neither matches #65's Library / Reading-Chat / Notes.

### 1.3 Panel sub-views (the real entry hierarchy)

| Panel          | State                                                    | Sub-view                                                          |
| -------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| `SourcePanel`  | `focusedSource` (uiStore) or `selectedDocument` non-null | `DocumentViewerPanel` → `SourceReader` (PDF/media, text fallback) |
| `SourcePanel`  | both null                                                | `DocumentList` (sources list + add-source menu)                   |
| `NotePanel`    | `isEditing && currentNote`                               | `NoteEditorPanel` (title + Save/Delete + Tiptap)                  |
| `NotePanel`    | otherwise                                                | `ItemList` (notes **and** mindmap/quiz/anki) + 4 generate buttons |
| `ProcessPanel` | always                                                   | `MessageList` + floating composer (no sub-views)                  |

So "Library" and "Reading" are the **same left card, mutually exclusive**; "Chat"
is the centre card; "Notes" and the artifact generators share the right card.

### 1.4 State ownership

| Concern                                  | Owner                                                          | Consumers                            |
| ---------------------------------------- | -------------------------------------------------------------- | ------------------------------------ |
| open notebooks / current notebook        | `notebookStore`                                                | TopNavigationBar, NotebookLayout     |
| panel widths + collapse                  | `ResizableLayout` local + `localStorage:knownote:panel-widths` | —                                    |
| selected document (list click)           | `SourcePanel` local                                            | reader                               |
| focused source anchor (citation/excerpt) | `uiStore.focusedSource` + URL query on `/notebook/:id`         | SourcePanel, MessageItem, NoteEditor |
| unsaved note dirty flag                  | `uiStore.hasUnsavedNoteChanges` (published by NotePanel)       | NotebookLayout guard                 |
| chat sessions                            | `chatStore.currentSession` / `.sessions`                       | ProcessPanel (current only)          |
| notes + artifacts list                   | `itemStore.items`                                              | NotePanel → ItemList                 |

The cross-panel request path is implemented and documented: citation chip →
`useSourceAnchorNavigation.openSourceAnchor` → `uiStore` **and** URL query →
`SourcePanel` derives during render. `DESIGN.md` §Cross-panel requests covers it.

> Drift found: `DESIGN.md:275` still says
> `const openDocument = selectedDocument ?? focusedDocument`. The code
> (`SourcePanel.tsx:383`) is `focusedDocument ?? selectedDocument`, with the
> precedence rationale in the comment above it. The doc is stale.

### 1.5 How each capability is entered today

| Capability                      | Entry point                                               | In-app?  |
| ------------------------------- | --------------------------------------------------------- | -------- |
| Import file / URL / text / note | `SourcePanel` add menu                                    | yes      |
| Read a **text** source          | click row → `selectedDocument` → reader                   | yes      |
| Read a **PDF / file** source    | click row → `handleOpenSource` → OS default app           | **no**   |
| Read from an answer             | click `[n]` chip → `focusedSource` → reader at page/block | yes      |
| Read from a note excerpt        | click excerpt link in note → `focusedSource`              | yes      |
| Ask a question                  | centre composer                                           | yes      |
| Create / switch conversation    | —                                                         | **none** |
| Create a note                   | right header button                                       | yes      |
| Excerpt selection → note        | reader header "Save excerpt"                              | yes      |
| Mindmap / quiz / Anki           | right header generate buttons → separate window           | yes      |
| Settings                        | title-bar button                                          | yes      |

---

## 2. `#65` acceptance cross-check

| #   | Acceptance                                                                            | Status                  | Evidence                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `DESIGN.md` contains the IA section, three zones and the end-to-end loop              | **Missing**             | `DESIGN.md` has §Workspace shell (geometry) and §Cross-panel requests, but no IA/zone/loop section. The loop `import → read → annotate/cite → ask → inspect → jump back → excerpt` appears nowhere                                                                                            |
| 2   | Every new/changed surface defines `hover` / `selected` / `focus-visible` / `disabled` | **Partial**             | `CitationChip` has hover / focus-visible / disabled but **no selected** (no "this is the citation currently open"). Icon buttons in `PanelHeader`s rely on conditional rendering instead of `disabled`. Only surfaces _changed by #65_ need to be re-audited, but the chip is a likely change |
| 3   | A keyboard path to open a citation and return exists and is documented                | **Partial**             | Open exists: chips are real `<button>`s, Tab+Enter works. Return does **not**: `DocumentViewerPanel` binds Esc to `onBack`, which calls `closeSourceAnchor()` and returns to the **source list**, not to chat. `ShortcutManager` has no "focus chat" / "move between zones" action            |
| 4   | `en-US` and `zh-CN` locale keys are both updated                                      | **Currently satisfied** | mechanical key diff shows only plural forms (`ankiCards_one/_other` vs `ankiCards`). But the zone **labels** are legacy (`knowledgeBase`, `creativeSpace`, `toggleKnowledgeBase`, `toggleCreativeSpace` in both trees) and would change with #65                                              |

---

## 3. Findings A — component exists, entry/hierarchy is wrong

These are the "already built, wrong door" cases. Fixing them is IA work, not new
features.

**A1. The Reader is unreachable from the Library for PDFs — the format v1.4
ships.** `SourcePanel.handleSelectDocument` (≈line 528) previews only
`type === 'text' || 'note'`; `file` and `url` call `handleOpenSource` →
`window.api.knowledge.openSource` → OS default application. The in-app
`PdfSourceReader`, its highlight layer and #73 selection→excerpt are reachable
**only** by clicking a citation or a note excerpt link. So the loop's first
half — `import → read` — is broken at the exact format the epic is about. This
is the highest-value item in #65 and it is a routing decision, not a new
component.

**A2. Library and Reading are one panel and mutually exclusive.**
`SourcePanel` swaps its whole body between `DocumentList` and
`DocumentViewerPanel`. #65 treats Library as "what is in the notebook" and
Reading as the working surface. Today opening a source _replaces_ the library,
so the user loses the source list (and the ability to switch sources) while
reading. The component exists; the placement is the issue.

**A3. Notes are conflated with "Creative Space" artifacts.** `ItemList` renders
notes, mindmaps, quizzes and Anki cards in one list, and `NotePanel`'s header
shows four generate buttons of equal weight. #65 explicitly says mind map / quiz
/ Anki "stay reachable, not promoted". They are currently promoted. The
separate windows already exist; what is wrong is that the notes zone advertises
them at the same level.

**A4. Conversation history has no surface.** `chatStore` owns `sessions`,
`loadSessions()` and `createSession()`; **nothing in the renderer renders them**
(`loadSessions` is never called; the app silently resumes/creates one "active
session" per notebook). A research loop that involves "inspect the source → jump
back" has no way to revisit an earlier conversation. This is an existing
capability with no entry point.

**A5. Zone names are legacy.** "Knowledge Base" / "Creative Space" vs the
Library / Reading-Chat / Notes vocabulary of #65. Small, but it is the user-
visible half of the IA change and touches both locales.

## 4. Findings B — shell capabilities genuinely missing

**B1. No keyboard path between zones, and no "return to chat".** Acceptance #3.
`ShortcutManager` currently exposes only create/close notebook, toggle left,
toggle right, save note. There is no focus-composer, no "return to chat from the
reader", no zone cycling. Opening a citation works from the keyboard; getting
back does not.

**B2. No "currently open citation/source" state.** The chip has no selected
state and the Library list does not show which source is anchored. #65 calls the
citation "the connective tissue"; right now the tissue is one-directional and
visually invisible after the jump.

**B3. Per-zone empty / loading / error / offline states are not specified.**
They exist scattered (Library empty states, reader loading/error, the three
`AnswerSources` states) but #65 asks for them to be _specified_ per zone in
`DESIGN.md`. Offline is not defined anywhere.

---

## 5. Verdict

**#65 is a small-to-medium IA closure, not a large UI rework — on one
condition.** The three-column geometry, the citation plumbing, the reader
contract and the excerpt round-trip are all built and tested. Nothing here needs
a new layout engine, a new panel, a palette, or a rebrand.

The one decision that can change the size is A2:

- **Option 1 (contained, recommended).** Keep the three cards. Library stays
  left; define "Reading / Chat" as the left reader **plus** centre transcript —
  the working surface spans two cards, which is what the current citation flow
  already does. Notes stay right. Work = A1, A3, A4(defer or fold), A5, B1, B2,
  B3 + the `DESIGN.md` IA section.
- **Option 2 (larger).** Move the reader into the centre card and make chat an
  overlay/drawer, exactly as #65's "the document is the anchor, the conversation
  is an overlay" reads literally. That is a real shell restructure touching
  `ResizableLayout`, `ProcessPanel`, `SourcePanel` and the citation target, and
  it would put #72/#73 under regression risk for no user-visible gain over
  Option 1.

Recommendation: **Option 1.** A1 is the only item that is arguably a bug rather
than IA, and it should be fixed inside #65 because it is the loop's missing
front door.

## 6. Proposed #65 work breakdown (for the follow-up, not now)

1. `DESIGN.md`: add the IA section — three zones, the end-to-end loop, the
   citation as connective tissue, per-zone empty/loading/error/offline states.
2. A1: route in-app-readable sources (PDF via `SourceReader`; text/note as
   today) to the reader on list click. Keep `openSource` (external) as an
   explicit secondary action. This makes the loop's first step real and is what
   #125 will exercise.
3. A3: demote artifact generation out of the notes header; decide whether
   `ItemList` splits notes from artifacts.
4. A5: rename zone labels in `en-US` and `zh-CN` (keys + shortcuts descriptions).
5. B1: add zone navigation to `ShortcutManager` + `useShortcutExecutor`
   (focus chat, return to chat from reader, cycle zones). Document it.
6. B2: selected state for the open citation/source (chip + list).
7. A2: resolve via Option 1 — state explicitly in `DESIGN.md` that Reading/Chat
   is the working surface spanning reader+transcript; do not restructure panels.
8. A4: decide explicitly. Candidate to **defer to v1.5** — it is a real gap but
   not a precondition of the trusted research loop, and adding a session list is
   a feature, which #65's non-goals exclude.

## 7. Explicit non-goals (unchanged from #65)

- No visual rebrand, no new palette (guarded by `npm run check:design`).
- No promotion of mind map / quiz / Anki — A3 is demotion, not removal.
- No new features. A4, if taken, is the one item that is a feature and is
  therefore the natural deferral.
- No change to the three-column geometry or `panelGeometry.ts`.

## 8. Open decisions for the owner

1. Option 1 vs Option 2 for A2 (recommendation: Option 1).
2. A4 (conversation history): fold into #65 or defer to v1.5?
3. Does A1 belong in #65 or is it a separate bug/feature issue that #65 depends
   on? (Recommendation: inside #65, because without it the IA loop has no front
   door and #125's manual pass cannot start from the Library.)
