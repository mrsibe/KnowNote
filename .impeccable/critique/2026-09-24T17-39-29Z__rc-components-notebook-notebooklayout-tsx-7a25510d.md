---
target: src/renderer/src/components/notebook/NotebookLayout.tsx
total_score: 18
max_score: 40
na_heuristics:
p0_count: 2
p1_count: 3
target_identity: 'file:/home/mrsibe/mywork/KnowNote/src/renderer/src/components/notebook/NotebookLayout.tsx'
target_fingerprint: 'sha256:a07a0f37295a83b1c391100f20334380495d004079332837830ae14f3aba330b'
target_path: /home/mrsibe/mywork/KnowNote/src/renderer/src/components/notebook/NotebookLayout.tsx
timestamp: 2026-09-24T17-39-29Z
slug: rc-components-notebook-notebooklayout-tsx-7a25510d
---

### Design Health Score

| #         | Heuristic                         | Score     | Key Issue                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | --------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of system status       | 2         | Indexing progress exists (`SourcePanel.tsx:147`), but retrieval silently disabling on failure is invisible (`chatHandlers.ts:148-151`), the session auto-switch signal has no renderer listener (`chatHandlers.ts:267-276` vs `preload/index.ts:121`), and a provider error is never persisted (`chatHandlers.ts:244-249`), so the turn vanishes on reload.                                                                                                             |
| 2         | Match system / real world         | 2         | Vocabulary is internal: "chunks" (`DocumentList.tsx:129`), "Creative Space" (`notebook.json:108`), "Session" (`chatStore.ts:112`). The user's real object — page, heading, passage — has no representation anywhere.                                                                                                                                                                                                                                                    |
| 3         | User control and freedom          | 2         | Collapse and resize are reversible and deletes are confirmed, but there is no undo, no trash, no pane-width persistence (`ResizableLayout.tsx:30-60` re-derives on mount), and bare Escape destroys the context (P0 below).                                                                                                                                                                                                                                             |
| 4         | Consistency and standards         | 2         | Two visually identical `+` glyphs mean different things (`TopNavigationBar.tsx:139` creates a notebook, `SourcePanel.tsx:474` adds a source). `Empty` is used in `DocumentList.tsx:36` and hand-rolled in `MessageList.tsx:26` and `ItemList.tsx:445`. `alert()` (`SourcePanel.tsx:313,331,349,371,383`) sits next to sonner toasts (`NotePanel.tsx:199`).                                                                                                              |
| 5         | Error prevention                  | 2         | Confirmations on delete are real. But Enter while streaming aborts the answer (`ProcessPanel.tsx:158-165`), Escape closes the notebook and discards unsaved note text (P0), and `Add to Note` has no pending state (`MessageItem.tsx:228-234`) so a double click creates two notes and two hidden model calls.                                                                                                                                                          |
| 6         | Recognition rather than recall    | 1         | Every shell action is icon-only with a native `title` tooltip: four in the notes header (`NotePanel.tsx:352-393`), two panel toggles (`ProcessPanel.tsx:216-278`). Rename is a ghost title that reads as static text (`ProcessPanel.tsx:244-252`). Pane drag handles are invisible at rest (`DragHandle.tsx:10`). Copy and Add-to-Note appear only on hover. Tab labels truncate at 200px with no tooltip (`TopNavigationBar.tsx:117`). No shortcut hints in the shell. |
| 7         | Flexibility and efficiency of use | 2         | Five accelerators exist and are user-configurable (`defaults.ts:265-296`, `ShortcutSettings.tsx`), but there is no new-chat, new-note, tab-switch or jump-to-source. `ProcessPanel.tsx:98-107` listens for `shortcut:send-message`, which nothing dispatches.                                                                                                                                                                                                           |
| 8         | Aesthetic and minimalist design   | 3         | The atom layer is genuinely disciplined: quiet chrome, one hairline seam, one surface step, honest 14px density (`NotebookLayout.tsx:72`). Deductions for the gradient compose box floating over the reading surface (`ProcessPanel.tsx:287-298`), three panels at identical elevation so nothing leads, and chart-coloured icons in a neutral list (`ItemList.tsx:167,179-183`).                                                                                       |
| 9         | Error recovery                    | 1         | Failures become _content_: `❌ Error: ${error}` is written into the transcript as the assistant's answer (`chatStore.ts:319-336`), is not persisted (`chatHandlers.ts:244-249`), and offers no retry. `SourcePanel.tsx:385` can surface a raw English `error.message` in a zh-CN UI. `DocumentList.tsx:107-111` re-fires its alert on every remount.                                                                                                                    |
| 10        | Help and documentation            | 1         | The only in-app help is the library empty state, which disappears once one document exists (`DocumentList.tsx:36-47`). No help entry point, no explanation of notebook vs chat vs note, and the centre empty state says "Start a new conversation" (`MessageList.tsx:32`) for an action that does not exist.                                                                                                                                                            |
| **Total** |                                   | **18/40** | **Below the 20–32 band**                                                                                                                                                                                                                                                                                                                                                                                                                                                |

The low score concentrates in one family — whether the answer carries its evidence, and whether the interface helps when something goes wrong (1, 5, 6, 9, 10). The visual layer itself (8) is competent.

### Design Specificity Verdict

**Category-interchangeable shell carrying a product-specific promise it never draws.**

The panes are the generic three: a file list (`SourcePanel.tsx:461-560`), a transcript (`ProcessPanel.tsx:283`, `MessageList.tsx:43-54`), a resource list (`NotePanel.tsx:344-397`). Swap the copy strings and this shell ships unchanged as AnythingLLM or NotebookLM's web app. Nothing in the composition encodes a page, a paragraph, or a passage:

- `grep -i citation` over `src/` returns **0 matches**. The word does not exist in the codebase.
- `ChatMessage` carries `notebookId`, `reasoningContent`, `metadata`, `isStreaming` — no sources, no span, no document id (`src/shared/types/chat.ts:23-29`).
- The retrieved passages are compiled into a hidden system prompt (`chatHandlers.ts:16-34`) and then discarded; the persist path writes only the two text fields (`chatHandlers.ts:250-252`).
- Nothing can aim the library at a location: `SourcePanel` takes no props (`SourcePanel.tsx:250`).
- "Read" does not exist in the app. For `file` and `url` sources, clicking a row opens the OS default application (`SourcePanel.tsx:417-425` → `knowledgeHandlers.ts:284-296`, `shell.openPath`/`openExternal`), so the most common source type leaves the window.

The one authored decision in the shell is the golden-ratio split (`ResizableLayout.tsx:14-23`), and it inverts the product's stated priority: sides get 27.6% each and the centre 44.7% (`1/(2+1.618)`, `1.618/(2+1.618)`), so the reading surface is the narrowest thing on screen while the conversation is the widest. `PRODUCT.md` says the opposite — "The document is the subject. Reading is the anchor and the conversation is an overlay."

The interchangeability is explained by a spec gap rather than by carelessness. `DESIGN.md` declares itself the single source of truth for UI decisions but explicitly excludes information architecture, and it has no composition or grid section. So the most consequential decision in the shell is owned by nobody and lives as component constants (`GOLDEN_RATIO`, `MIN_SIDE_WIDTH 260`, `MIN_CENTER_WIDTH 420`, `DRAG_HANDLE_WIDTH`, `CONTAINER_PADDING_X`) that appear nowhere in `DESIGN.md` — against its own rule that a value not in the document gets added to it in the same PR. This was confirmed independently: the deterministic pass searched `DESIGN.md` for every one of those numbers and found none of them.

Finally, the most product-specific string in the shell is `{document.chunkCount} chunks` (`DocumentList.tsx:129`) — the only thing the interface says about a source is an implementation detail, and it is exactly the object a citation must _not_ resolve to.

### Overall Impression

The atom layer is better than most shipped products, and the shell above it does not use it to say anything true about this product. The single biggest opportunity is to make the citation a visible object, because that fixes the specificity verdict, the emotional valley, and the centre column's identity in one move.

### What's Working

1. **Chrome discipline is real.** One hairline seam, one surface step, no shadow on panels, no theme branching in components, honest density. `WindowTitleBar.tsx:20-60` documents the OS-reserve contract and reads it from shared constants instead of repeating numbers — award-level care about a part of the interface almost everyone gets wrong. `npm run check:design` passes, so this is enforced rather than aspirational.
2. **Destructive actions inside a zone are guarded.** The note panel intercepts back navigation while the editor is dirty (`NotePanel.tsx:220-232`), and the app ships a real top-level error boundary with a reload action rather than a white window (`AppErrorBoundary.tsx:44-69`).
3. **The differentiator is a UI problem, not an archaeology problem.** The retrieval layer already knows the exact passages it used (`chatHandlers.ts:127-146`) and the chunk API already returns per-chunk content (`SourcePanel.tsx:179-181`). Only the shell stands between the user and a citation.

### Priority Issues

**1. [P0] `Escape` closes the notebook and unsaved note text dies with it.**
_What:_ `defaults.ts:273-277` binds `CLOSE_NOTEBOOK` to bare `Escape`. `ShortcutManager.ts:79-116` matches it via `before-input-event`, calls `preventDefault()` and dispatches, with no check of the focused element. `NotebookLayout.tsx:44-54` then calls `removeOpenedNotebook(id)` and navigates away. The unsaved-changes guard at `NotePanel.tsx:220-232` is unreachable from this path, and `ProcessPanel.tsx:202-206` (Escape cancels a rename) is dead code that can never run. `ShortcutSettings.tsx:60-62` actively endorses modifier-less Escape.
_Why it matters:_ The universal "get me out of this field" key destroys the workspace and any unsaved note text, and it silently contradicts a control the app itself implements.
_Fix:_ Remove bare Escape from the default binding; require a modifier; skip the match when the focused element is an input, textarea or contenteditable; restore Escape-to-cancel.
_Suggested command:_ `/impeccable harden`

**2. [P0] The citation is unreachable, so the differentiator is absent from the shell.**
_What:_ Retrieval output is hidden in a system prompt and never persisted (`chatHandlers.ts:16-34`, `:250-252`); `ChatMessage` has no source field; `MessageItem`'s only actions are Copy and Add to Note (`MessageItem.tsx:150-236`); `SourcePanel` accepts no props; `grep -i citation` returns nothing. When RAG is unavailable the code logs it and answers anyway (`chatHandlers.ts:148-151`), so the user cannot tell a grounded answer from an ungrounded one.
_Why it matters:_ The product record makes the citation the product. Today the interface can produce a fluent, unverifiable claim and cannot show its work.
_Fix:_ Attach a `sources[]` (document id, block span, page, heading) to the assistant message at generation time; render a per-claim source chip; clicking it opens the library at that span with the passage highlighted; add the keyboard path to open it and return; surface retrieval status (used / none / failed) on every answer.
_Suggested command:_ `/impeccable shape`

**3. [P1] The centre column is a chat, not a reading surface, and it fights the reader.**
_What:_ Pane widths invert the stated priority (sides 27.6%, centre 44.7%, `ResizableLayout.tsx:14-23`). The only in-app reader joins raw chunk contents into a `<pre>` with no headings or page markers (`SourcePanel.tsx:179-181`, `:219-223`); for files and URLs there is no reader at all. And the transcript force-scrolls to the bottom on every token (`MessageList.tsx:17-22` keyed on `messages` × `chatStore.ts:58-62`), while the reasoning block auto-expands and auto-collapses (`ReasoningContent.tsx:33-42`).
_Why it matters:_ Reading a document is impossible in 27.6% of a window, reading a PDF is impossible in the app, and re-reading a previous sentence is impossible while an answer streams. The `read` step of the intended loop has no home.
_Fix:_ Give reading the centre and make the conversation the overlay; render documents as structured blocks with a citation target each; add in-document search; suspend auto-scroll once the user scrolls up, with a "jump to latest" affordance; make the reasoning block user-controlled.
_Suggested command:_ `/impeccable layout`

**4. [P1] First run is three empty columns with instructions the app cannot honour.**
_What:_ A new notebook is auto-named and auto-opened (`NotebookLayout.tsx:32-41`). The centre empty state says "Start a new conversation / Type below to begin" (`MessageList.tsx:32-33`, `ui.json:55-56`) — no such action exists anywhere (`chatStore.ts:112` is reachable only internally). The disabled input says "Please select a session first" (`ProcessPanel.tsx:305-310`, `ui.json:73`) and there is no session picker. The library `+` is disabled with its only explanation in a tooltip. Rename is discoverable only via a hover tooltip.
_Why it matters:_ The loop has seven steps; the user is dropped at step four with no ordering, no vocabulary, and two instructions pointing at controls that do not exist. This is where trust is set.
_Fix:_ Replace the three parallel empty states with one ordered path on an empty notebook; name the notebook at creation; make the session copy truthful or delete the concept; explain the disabled `+` inline; add a real "New chat" action.
_Suggested command:_ `/impeccable onboard`

**5. [P1] Silent state changes, and error handling that hides rather than recovers.**
_What:_ RAG disabled or failed → log only (`chatHandlers.ts:148-151`). Session auto-switch → main sends the event, preload exposes it, no renderer subscribes (`chatHandlers.ts:267-276`, `preload/index.ts:121`). No dirty indicator on a note (`NotePanel.tsx:156` is local state driving only a dialog). Errors go to blocking `alert()` or `console.error` despite an installed toast system. Failed generations are rendered as `❌ Error: <raw>` in the transcript and never persisted.
_Why it matters:_ In a tool whose promise is "trust every answer", the user cannot tell grounded from ungrounded, cannot tell which conversation they are in, cannot tell whether a note is saved, and loses the error record on reload.
_Fix:_ A retrieval status line on every answer; a visible session identity (or remove the concept); a dirty indicator on save; transient errors through toasts, dialogs reserved for blocking errors; persist error state with a retry.
_Suggested command:_ `/impeccable clarify`

### Persona Red Flags

**Alex (power user, 200 sources, keyboard).** Primary action: get to the passage and back.

- Escape closes the notebook mid-thought (`defaults.ts:275` → `NotebookLayout.tsx:44-54`), so Escape is unusable for anything.
- No shortcut for new chat, new note or tab switching; `shortcut:send-message` has a listener with no dispatcher (`ProcessPanel.tsx:98-107`).
- Tab labels truncate at 200px with no tooltip and the close `X` shares the label area (`TopNavigationBar.tsx:117-136`); at eight tabs they are indistinguishable.
- Pane widths are not persisted; any home round-trip remounts the layout and re-derives the ratio (`ResizableLayout.tsx:30-60`).
- The library has no search or filter, although the store implements both (`knowledgeStore` has `search`/`searchResults`, referenced by nothing). With 200 sources, Alex scrolls.
- The pane handle cannot be operated by keyboard at all (`DragHandle.tsx:8-14`).

**Jordan (first-timer).** Primary action: add one document and ask one question about it.

- Lands in an auto-named notebook and must find a hover tooltip to rename it (`ProcessPanel.tsx:244-252`).
- Is told to start a conversation that cannot be started (`MessageList.tsx:32`).
- With no model configured, the input is disabled with an instruction and no adjacent action; the settings entry point is an unlabelled 28px gear at the far right (`TopNavigationBar.tsx:88-96`).
- Two identical `+` glyphs mean different things within ~100px (`TopNavigationBar.tsx:139` vs `SourcePanel.tsx:474`).
- Nothing explains what a notebook is relative to a chat and a note, or what the four right-header buttons do (`NotePanel.tsx:352-393`).

**Sam (accessibility-dependent, keyboard and screen reader).** Primary action: move between zones and read an answer with its source.

- Pane dividers are bare `div`s: no `role="separator"`, no `tabIndex`, no keyboard handling, no `aria-valuenow` (`DragHandle.tsx:8-14`). There is no keyboard resize and no keyboard path between zones, which the product record requires.
- The tab close control is a `<span role="button" tabIndex={0}>` nested inside a Radix `TabsTrigger`, itself a `<button>` (`TopNavigationBar.tsx:120-136`) — nested interactive elements with duplicated Space/Enter handling.
- T3 `text-subtle-foreground` carries the chunk count and every date at 12px (`DocumentList.tsx:129`, `ItemList.tsx:227-231`), at 2.2:1 light and 2.7:1 dark per the project's own table. `DESIGN.md` forbids shipping a dark value below 3:1, so the theme table violates the document.
- Panel-header actions are labelled only by native `title` (`NotePanel.tsx:352-393`), which keyboard users cannot reveal.
- The transcript has no `aria-live`; completion is signalled only by a pulsing cursor and hover-only buttons (`MessageItem.tsx:177,190-236`).

**Maya (mobile / low-bandwidth) — excluded.** No mobile artifact exists (Windows and Apple Silicon macOS only), and offline is already a first-class state. Her nearest analogue inside a desktop context is a user with no endpoint reachable, which collapses into Alex's silent-retrieval-failure flag.

### Minor Observations

- `ProcessPanel.tsx:290-293` ships `linear-gradient(..., hsl(var(--card)) ...)`, which the document bans twice (no gradients; no raw `hsl()` in a component). The geometry is also wrong: the fade is 192px (`h-48`) while the transcript reserves 128px of bottom padding (`MessageList.tsx:44` `pb-32`) and the compose box takes ~118px, so the last line of every answer sits ~13px inside the fade.
- `ItemList.tsx:167,179-183` uses `bg-chart-1/5`, `border-chart-1/30`, `text-chart-1/2/3` and `animate-pulse` in a list — chart colours outside chart surfaces, and a colour icon in neutral chrome.
- `ProcessPanel.tsx:283` hardcodes `absolute top-14` (56px) above a 44px header: the same magic-number class the new window-chrome section forbids.
- `DESIGN.md` requires empty states to use `Empty`; `MessageList.tsx:26-41` and `ItemList.tsx:445-455` hand-roll theirs at smaller sizes while `DocumentList.tsx:36-63` uses the primitive. Three empty states, three treatments, one screen.
- `NoteList.tsx` is entirely unreferenced; `NotePanel` renders `ItemList` instead (`NotePanel.tsx:378-390`).
- `Add to Note` has no pending state and triggers a hidden second model call for a title (`noteHandlers.ts:66-68`); a double click produces two notes and two extra requests, and failure is console-only (`MessageItem.tsx:56-60`).
- `ProcessPanel.tsx:158-165`: Enter aborts the running generation — the key users press to send is the key that cancels, with no confirmation.
- `NodeDetailPanel.tsx:13` sends messages into the same session the main window is displaying, with no cross-window sync.
- **Deterministic i18n defect:** `TopNavigationBar.tsx:143` calls `t('create', { ns: 'common' })`, but `common.json` defines no `create` key in either locale, so the new-notebook button title renders the raw key `create` in both languages.
- The committed screenshot is stale: it shows an accent-filled user bubble, while `MessageItem.tsx:97` now renders `bg-muted` (correct per the accent rules). The README embeds it as the product preview, and it shows no citation — the headline claim.

### Questions to Consider

1. The retrieved passage set is known at the moment of answering and then thrown away. If the citation is the product, why is the chat bubble the primary object and the passage its annotation? What would that screen look like?
2. Which column is the subject? Today the answer is the conversation, and it has the widest column. If you swap them, what do the side columns have to give up — and is any of them strong enough to defend 27.6%?
3. What is a session _for_? There is a session stack, a token-budget auto-switch, and no UI. Is a notebook one growing conversation or several the user names and reopens? Only one of those makes "jump back to the passage I cited last week" affordable.
4. At 300 sources with no search box, is the library a list you scroll or an index you query? The store can already search it.
5. If the promise is "trust every answer", what is the interface for _doubt_? Right now the entire doubt-resolution affordance is a Copy button that appears on hover.
6. Would this shell work unchanged for a podcast summariser or a contract reviewer? If yes, what single element are you willing to make deliberately unusual to encode provenance?

### Verification evidence

`npm run check:design` → 0 violations. `npm run typecheck` → exit 0. `npm run lint` → 0 errors, 113 pre-existing warnings. `impeccable detect --json` on the target and on the wider shell surface → exit 0, **zero findings**.

That detector result is weak evidence, not a clean bill of health, and the run proved it: the same binary flagged a deliberately low-contrast HTML fixture (exit 2, one `low-contrast` finding), but returned nothing for deliberately bad `.tsx` fixtures carrying raw-palette class names, a no-alt image, and low-contrast inline JSX styles. Rule coverage for the TSX/className path could not be confirmed, so "0 findings" here means "no rule fired", not "no defect".

Browser evidence was not obtained, and no overlay exists for this run. Every step was skipped for a concrete reason: the shell is only reachable inside the Electron app, there is no plain localhost URL for it, the running app would render the maintainer's private research database, and there is no sanitised fixture route to capture instead. So no screenshot, DOM dump or runtime geometry measurement was produced; all numbers above were read from source.
