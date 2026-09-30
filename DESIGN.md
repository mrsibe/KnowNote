# KnowNote Design System

KnowNote is a desktop reading, note-taking and RAG tool. The interface is mostly
chrome around content that people read for a long time: document text, notes,
chat answers, settings.

This document is the **single source of truth for UI decisions in this
repository**. It is written to be executable: every rule names a token or a
Tailwind class. If you are an agent adding a page or a component, follow the
recipes in [Component recipes](#component-recipes) instead of inventing values.
If a rule here is wrong or missing, change this file in the same PR as the code.

Non-goals: this document does not define product behaviour, branding (logo, hue
of the primary colour) or i18n.

## Design principles

1. **Content is the subject.** Chrome is neutral and quiet. Panels are separated
   by a 1px hairline and a surface step, not by shadows or colours.
2. **Neutral first, accent rarely.** The accent colour marks focus and the
   primary action of a view. It is never decoration. Same-screen accent elements
   should be countable on one hand.
3. **Hairline over shadow.** Shadows are reserved for things that float above the
   document (dialogs, popovers, menus, toasts). Panels never float.
4. **Density over airiness.** 32–36px rows, 44px panel headers, 14px UI text.
   Density is what makes a knowledge tool feel fast.
5. **Four states, always.** Every interactive surface has a defined `hover`,
   `selected`, `focus-visible` and `disabled` expression. Missing states are
   bugs, not omissions.

Direction reference: Notion's content feel, Linear's information density,
Raycast's desktop chrome (near-flat dark surfaces, hairlines, almost no shadow).

## Information architecture

Implementation: `components/notebook/NotebookLayout.tsx` and the three panels it
composes. [Workspace shell](#workspace-shell) owns the geometry; this section is
the layer above it — what each zone is for, how it is entered, and how the loop
between them stays continuous.

### Three zones, one loop

KnowNote is not a menu of features. It is one loop:

```text
import → read → annotate / cite → ask → inspect the source → return → excerpt into a note
```

| Zone               | Surface                                 | Owns                                                                           |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------------ |
| **Library**        | left panel, list state                  | what is in the notebook: sources, and the way in                               |
| **Reading / Chat** | left panel reading state + centre panel | the working surface: the document is the anchor, the conversation is beside it |
| **Notes**          | right panel                             | output that stays linked to its source                                         |

The **citation is the connective tissue** between the three. A `[n]` in an answer
opens the source at its page/block ([Cross-panel requests](#cross-panel-requests));
a selection in the reader becomes an excerpt in a note that links back to the same
anchor (`shared/utils/excerpt.ts`). No other surface needs to know how the panels
talk to each other.

Mind map, quiz and Anki are **secondary utilities**, not part of this loop. They
stay reachable — from the Notes panel and from their own windows — but they are
never promoted into the three zones or into the loop above. This is #65's explicit
non-goal, recorded here so the next IA change does not relitigate it.

### Library and Reading are one zone, two states

Reading does **not** get its own column. The left card switches between the source
list and the reader, and the switch is explicit in both directions:

- A source row opens the reader **in-app, for every format**. PDF renders its
  pages (`PdfSourceReader`); every other format uses the text fallback. There is
  one entry (`handleSelectDocument`) and one reading contract, so "read from the
  Library" and "jump from a citation" cannot drift into two navigation models.
- "Open in system application" is an explicit action in the reader header, never
  the meaning of a list click.
- **Back** (Back button or `Escape`) returns to where the reader was opened from.
  From a citation or a note excerpt, focus returns to that element; from the
  Library list, focus returns to the list; a reader with no origin (deep link,
  restored session) hands focus to the chat composer. Returning to the exact
  origin is the accessible behaviour — not a hard-coded "Escape focuses the
  composer".

The source row is the primary control of this switch, so it is a real `<button>`
with `hover` and `focus-visible`. Two of the four states are **unreachable** for
it, and are therefore not invented: `selected` cannot be shown because the list is
replaced by the reader, so no row is visible while its source is open; `disabled`
can never apply because reading a source is not gated on anything. The surface
that carries the full `hover` / `selected` / `focus-visible` / `disabled` set is
the citation chip, not the row.

### Keyboard path

- **Open a citation:** `Tab` to the chip, then `Enter` / `Space`. Chips are real
  buttons, so this is the platform behaviour, not a custom keybinding.
- **Return:** `Escape` (or Back) returns focus to the chip that opened the reader.
- **Toggle side panels:** `Cmd/Ctrl+[` expands/collapses Library and
  `Cmd/Ctrl+]` expands/collapses Notes, exactly like the panel-header buttons.
  Reopening restores the remembered width. Citation navigation is separate:
  it only reveals Library, never collapses it. The centre composer is reached
  through `FOCUS_CHAT_EVENT` (the reader's back fallback).
- **Close notebook:** `Cmd/Ctrl+D`, with the unsaved-note guard. Existing
  Escape and Cmd/Ctrl+W defaults migrate to this binding; other custom bindings stay.

The chip for the citation the reader is currently showing carries `aria-current`
and a selected fill. That state is **derived** from `uiStore.focusedSource`
(`sourceAnchorsEqual(citationToSourceAnchor(citation), focusedSource)`) — there is
no second selection store to keep in sync.

### States, by zone

Every zone defines its four states. This table is the contract; a missing state is
a bug (rule 5).

| Zone    | empty                                                                 | loading                                                              | error                                                                                 | offline                                                                                              |
| ------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Library | `Empty` — no documents, or no embedding model with a link to settings | spinner while the list loads; a row shows `indexing` while ingesting | a failed ingestion surfaces on its row; a source whose file is gone fails when opened | local-first: listing sources needs no network                                                        |
| Reading | a text source with no content renders an empty reader                 | reader spinner until blocks and bytes arrive                         | `readerPdfUnavailable` when the stored file is missing                                | local-first: bytes are served over `knownote-doc://`                                                 |
| Chat    | `Empty` — "start a new conversation"                                  | streaming cursor; the send button is disabled while a turn runs      | a retrieval `failed` line; a `none` line when nothing was used                        | the composer refuses to send with no chat model (`noProviderConfigured`); the transcript still reads |
| Notes   | `Empty` — no items                                                    | `generating` row for an in-flight artifact; editor save state        | `failed` row for an artifact                                                          | local-first: notes live in SQLite                                                                    |

Offline is a **model-connection** concern, not a zone concern: zones read local
data and never gate on connectivity. Only a chat turn and remote embeddings need
the network, and both already carry their own unavailable state.

#### What an answer says when it did not finish

A turn's record carries its state (`chat_messages.status`), and the transcript
renders from that record — never from whether a stream happens to be open
(`shared/utils/answerState.ts` is the only place that maps one to the other). That is
what makes the answer that is arriving and the same answer after a restart the same
statement rather than two rendering paths that have to agree.

Four states explain themselves in one muted line **beside** the answer; none is an
error card, and none replaces the text that arrived:

| `status`    | the line                                                       |
| ----------- | -------------------------------------------------------------- |
| `truncated` | the output ceiling ended it — a completion with a known defect |
| `blocked`   | the provider refused it; not the model's own decision          |
| `aborted`   | the reader stopped it                                          |
| `failed`    | generation broke, with the reason                              |

`completed` says nothing. A row written before the column existed says nothing
either: unknown is not a claim, and it must not be rendered as one.

The line is `text-xs text-subtle-foreground`, the treatment the retrieval lines
already use — a state of the answer, quieter than the answer itself.

## Home

Implementation: `components/home/` and `components/pages/NotebookListPage.tsx`. Home
is a **starting desk, not a dashboard**. It has four sections, in the order they are
used, and each one is allowed to render nothing:

| Section           | Grammar         | Ordered by              | Source                                     |
| ----------------- | --------------- | ----------------------- | ------------------------------------------ |
| Greeting + prompt | text, `text-xl` | —                       | local time                                 |
| Search entry      | input, `h-12`   | —                       | notebooks + recent sources, filtered in JS |
| Recent notebooks  | cards           | `notebooks.updatedAt`   | the notebook store                         |
| Continue          | list rows       | the user's own activity | `lib/recentlyOpened.ts` + `recentSessions` |
| Recently added    | list rows       | `documents.createdAt`   | `recentDocuments`                          |

Rules:

- **No hero banner.** The greeting is one `text-xl` line and a T2 prompt. Home is
  opened a hundred times; a banner is paid for on every one of them. The visual
  centre is the entry below it, not the words above it.
- **One grammar per kind of thing.** Notebooks are cards, everything that is not a
  notebook is a row, and creating is a button. Repeating one container for every
  object is what makes a launcher read as a wall of identical boxes, and it hides
  the difference between a place you work and a file that arrived.
- **"Continue" means where the user was, not what changed.** The shelf is ordered by
  `updatedAt`, so a notebook renamed last week outranks the one read an hour ago.
  Continue merges the notebooks the user actually opened with the conversation last
  written to, ordered by real recency, and caps at three.
- **No dead affordances.** There is no "View all" link, because there is no Library
  page to point at — Home is where notebooks are browsed, so the shelf expands in
  place with a real disclosure. A section with nothing to show is omitted, not
  rendered as an empty box with a heading.
- **One read, not a fan-out.** Home's data arrives in a single
  `get-workspace-overview` call (`WorkspaceOverview`): source counts, the newest
  sources across every notebook, and the last active conversation. One IPC per
  notebook would grow with the library on a page that is opened constantly.
- **Counts are rendered only when known.** A notebook card takes an optional
  `sourceCount` and omits the count rather than printing a zero it cannot vouch for.

### What Home's search does, and does not

`HomeSearch` filters **notebook and source names** in the renderer, over data Home
already has. It is not wired to retrieval, and the placeholder says so: search the
_text_ of the library and ask a question across all notebooks is a different change,
because `searchChunksFts` is scoped to one notebook and every notebook owns its own
vector table. A box labelled "ask your knowledge" that quietly matched only titles
would be worse than the honest label.

The entry owns the `Cmd/Ctrl+K` binding on Home, so the hint it renders is a
shortcut that works. Results are a `combobox` / `listbox` pair with
`aria-activedescendant`; options prevent `mousedown` so clicking one does not blur
the input before the click lands.

### Card hover

A shelf card takes `hover:-translate-y-px` and `hover:shadow-control`, over 150ms.
This is the one place a `surface-raised` card may carry a shadow, and only while
hovered: it is a transient affordance on a control, not a panel floating over the
document. At rest the card is border + surface step, per [Borders and
shadow](#borders-and-elevation). Never widen this into a resting shadow or a
`shadow-elevation`.

## Surfaces

The app is a stack of opaque surfaces plus two translucent state fills. Higher
in the stack means further from the window background, and **lighter** in both
colour schemes. Each of the three opaque steps has one job, and a surface is
only ever used for that job:

| Tier            | Token                | Tailwind              | Light                         | Dark                      | Use for                                                                                                                                            |
| --------------- | -------------------- | --------------------- | ----------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **floor**       | `--surface-sunken`   | `bg-surface-sunken`   | `oklch(0.946 0.0045 91)`      | `oklch(0.1776 0.0015 91)` | The workspace floor: the window background and the gutter between panels. Also the recessed utility fill — a segmented-control track, a code block |
| **chrome**      | `--surface-base`     | `bg-surface-base`     | `oklch(0.9756 0.0026 106.45)` | `oklch(0.2046 0.0015 91)` | Rails and bars: the library panel, the notes panel, the settings nav, every window title bar, a full-bleed page background                         |
| **content**     | `--surface-raised`   | `bg-surface-raised`   | `oklch(1 0 0)`                | `oklch(0.235 0.0015 91)`  | What the user is reading or writing: the chat document, the reader, the editor, a notebook card, a dialog body                                     |
| **floating**    | `--surface-overlay`  | `bg-surface-overlay`  | `oklch(1 0 0)`                | `oklch(0.285 0.0015 91)`  | Layers above the page: dialog, sheet, popover, menu, select, tooltip, toast                                                                        |
| **state fills** | `--surface-hover`    | `bg-surface-hover`    | `foreground @ 5%`             | `neutral 0.93 @ 6%`       | Translucent hover fill for rows, menu items, ghost buttons                                                                                         |
|                 | `--surface-selected` | `bg-surface-selected` | `foreground @ 9%`             | `neutral 0.93 @ 10%`      | Translucent selected/active fill for rows and toggles                                                                                              |

The three opaque steps are the **floor → chrome → content** ladder. In the
workspace it reads as: the `p-2` gutter is floor, the library and notes panels
are chrome, and the chat document in the centre — the thing the notebook is
_about_ — is content. That is the whole hierarchy; no shadow or colour carries
it.

Rules:

- **Never invent a background colour.** `bg-white`, `bg-black`, `bg-gray-*`,
  `bg-slate-*`, `bg-[…]` and raw `oklch()`/`hsl()` in a component are all
  violations. If the surface you need is not in the table, the table is wrong —
  extend it here.
- `surface-hover` and `surface-selected` are translucent so that they adapt to
  whatever they are drawn on. Do not add alpha to them again (`bg-surface-hover/50`
  is a bug).
- The ladder is monotonic: `sunken < base < raised < overlay` in lightness, in
  **both** colour schemes. Ordering surfaces the other way (a panel darker than
  the canvas in dark mode) is the bug this ladder was introduced to fix.
- Adjacent surfaces must differ in lightness; two neighbours at the same value
  mean you are expressing hierarchy through a shadow, which is not allowed.
- Inside a panel, nested containers (a bubble, an inline code block, an icon
  tile) use `bg-muted` — a quiet opaque fill that is _recessed_ relative to
  `surface-raised` in both colour schemes. Do not nest `surface-raised` inside
  `surface-raised`.

**The neutral ramp is warm.** Surfaces and text share hue ~91 (a warm grey)
rather than the zero-chroma grey this palette used to be, which is what makes a
white panel read as paper instead of as a default browser surface. Text and
surfaces remain two separate ramps — they agree on hue, nothing else. Do not
mix a warm surface with a cool grey label, and do not introduce a second
neutral hue.

**Not** a separate tier: the window title bar. It is the OS window frame rather
than a panel, so it is drawn `bg-surface-base` — the chrome tier — in all four
windows. It takes no step of its own; do not give it one.

Legacy aliases kept for compatibility while pages migrate: `--background`,
`--card`, `--popover`, `--sidebar` and `--accent` — with their `-foreground`
siblings and the remaining `--sidebar-*` tokens — are defined in terms of the
tokens above. New code uses `surface-*`.

`--secondary` / `--secondary-foreground` were dead tokens: they held their own
literals rather than aliases, nothing rendered them (`Button` and `Badge`
`variant="secondary"` both use `bg-muted`), and the light value was the only
blue-tinted neutral in the palette. They have been deleted; do not reintroduce
them — the `secondary` **variant** name is unrelated to a `--secondary` colour
and is spelled with `bg-muted`.

## Window chrome

The title bar is the one piece of the interface the OS and the renderer draw
_together_: the renderer draws the bar, the OS draws minimize / maximize / close
on top of it. Both halves therefore read their geometry from
`src/shared/utils/windowChrome.ts`, and neither repeats the numbers. The
renderer half is one component, `components/common/WindowTitleBar.tsx`, shared
by all four windows — main, mind map, quiz and Anki.

| Value                  | Constant                   | Renderer side                            |
| ---------------------- | -------------------------- | ---------------------------------------- |
| Title bar height, 44px | `TITLE_BAR_HEIGHT`         | `h-11` in `WindowTitleBar`               |
| Control strip, 138px   | `WINDOW_CONTROLS_WIDTH`    | reserved on the right, Windows and Linux |
| Traffic lights, 80px   | `MAC_TRAFFIC_LIGHTS_WIDTH` | reserved on the left, macOS              |

Rules:

- The height given to `titleBarOverlay.height` **is** the height of the drawn
  window controls, so it has to equal the renderer's bar. A mismatch shows up as
  controls that are visibly not centred in their bar — that is what a 35px
  overlay under a 44px bar looked like.
- Every window reserves the OS strips, not just the one that happened to get it
  right. Each window used to carry its own copy of this geometry and they had
  drifted to 100px, 128px and 0 for the same reserve: the controls sat over the
  content on Windows, and on Linux two windows reserved nothing at all.
- Both reserves are real measurements, not round numbers. Windows caption
  buttons are 3 x 46px, so `w-32` (128px) was 10px short and put the settings
  button under the minimize button.
- A window whose content is full-bleed (the mind map canvas, the quiz view, the
  flashcard list) adds `border-b border-border` to separate the bar from the
  content. The main window does not: its panels already sit in a `p-2` canvas
  gutter.
- A window that overlays its bar on the content offsets that content by
  `TITLE_BAR_HEIGHT`. Do not write the number again.

`color-scheme` is declared per theme in `theme.css` so that the surfaces the CSS
does not paint — scrollbars, caret, selection, form controls — follow the app
theme instead of the OS light default.

## Workspace shell

Implementation: `components/layouts/ResizableLayout.tsx` and `DragHandle.tsx`.

The three-zone workspace is the one part of the interface whose geometry used to
live only in component constants. These are the values; change them here first.

| Value                | Constant                               | Notes                                                      |
| -------------------- | -------------------------------------- | ---------------------------------------------------------- |
| Container gutter     | `p-2` (`CONTAINER_PADDING_X`)          | The canvas gap around and between the panels               |
| Initial side widths  | golden ratio of the free space         | `1 / (2 + 1.618)` each; the centre takes `1.618 / 3.618`   |
| Minimum side panel   | `260px` (`MIN_SIDE_WIDTH`)             | A drag and a keyboard step both clamp here                 |
| Minimum centre panel | `420px` (`MIN_CENTER_WIDTH`)           | The sides give up width first, down to their own minimum   |
| Seam                 | `w-3` (`HANDLE_WIDTH`)                 | 12px canvas gutter; the gutter itself is the drag target   |
| Fallback widths      | `320px` / `360px`                      | Used when the container has no measurable width yet        |
| Keyboard step        | `10px` / `50px`                        | `Shift` for the larger step; `Home` / `End` for the limits |
| Persistence          | `localStorage` `knownote:panel-widths` | Survives navigation, unlike the component's own lifetime   |

Rules:

- **The constraints live in one place.** They are computed from the measured
  container width in `ResizableLayout`, never restated as a CSS `min-width` — the
  two drifted apart, and the CSS copy was derived from a width that stopped
  being measured after the first render.
- **A drag owns the whole gesture.** Listeners go on `window`, the container rect
  and the constraints are snapshotted at pointer-down, and the commit is
  rAF-coalesced. A drag ends on `pointerup`, `pointercancel`, `window` `blur`,
  `visibilitychange` **and** on `event.buttons === 0` in the move handler — that
  last one is what catches a button released while another window held focus,
  where neither `pointerup` nor `pointerleave` ever arrives.
- **`pointerdown` calls `preventDefault()` and takes the drag lock**
  (`lib/dragLock.ts`: `user-select: none` + a forced cursor, ref-counted, Escape
  cancels). Without the lock, dragging past a panel's limit leaves the browser's
  native selection drag running and selects the text underneath.
- **The seam is a gutter, and its width is layout.** The panels are separate
  cards floating on the `surface-sunken` floor; the gutter between them _is_ the handle.
  That is why `HANDLE_WIDTH` is subtracted from the width the panels may occupy,
  and why the handle paints nothing at rest. Painting it (`bg-border`) or
  shrinking it toward `w-px` closes the gutter and makes the cards read as
  adjacent surfaces sharing a divider. This is the one place a hairline is wrong —
  do not "tidy" it.
- **The seam is a real `separator`**: `role`, `aria-orientation`, `aria-valuenow`,
  `aria-valuetext`, `tabIndex={0}`, arrow keys. Panel resizing is not mouse-only.
- **Arrow keys move the seam, not the panel.** `ArrowLeft` shrinks the panel on the
  left of the seam and grows the panel on the right of it; `ArrowRight` does the
  opposite. `Home` / `End` go to the minimum and maximum of the value. The two
  seams report the same kind of number (the panel width in px) under the same key
  semantics — an earlier revision inverted one of them, so the same key raised the
  reported value on one seam and lowered it on the other.
- **Double-click a seam** restores that panel to its default share. Persistence
  without a way back is a trap: one bad drag otherwise keeps a 260px reading pane
  forever.
- **The centre's minimum is not absolute.** `maxSideWidth` floors each side at
  `MIN_SIDE_WIDTH`, so on a window too narrow for both minimums the centre absorbs
  the shortfall rather than a side panel being clamped to something unusable. In
  practice the window's own 1000px minimum keeps the two from colliding, but the
  guarantee comes from the window, not from this layout.
- A collapsed panel keeps its previous width in the session so expanding restores
  it; `0` is never persisted as a width.

`MessageList` follows the transcript only while the reader is already near the
bottom (within `PINNED_THRESHOLD`, 48px). Scrolling up suspends the follow and
reveals a circular, icon-only `jumpToLatest` control centred above the composer;
the follow resumes when they return to the bottom, or when the control is
pressed. A stream that force-scrolls per token makes re-reading impossible. The
follow itself is instant, never smooth, because it runs per token and an
animation queued that often never settles; the control is the one place a smooth
scroll is allowed, and only while no answer is streaming. Reduced motion turns
even that into an instant jump.

The distance to the bottom is `scrollHeight - scrollTop - clientHeight` clamped at
zero, compared against the threshold — never `scrollTop + clientHeight ===
scrollHeight`, which is false under fractional pixels and reflows. The numbers
live in `stickToBottom.ts` and are tested there.

The transcript's empty state and its message list must share **one** `ScrollArea`.
The scroll subscription runs once, so a viewport that only exists after messages
arrive can never be observed.

The follow is driven by the content's **height**, not only by the messages array:
streaming grows one message, and Markdown reflow, a highlighted code block, a
decoded image or an opened source disclosure change the height with no message
event at all. A `ResizeObserver` on the transcript keeps the follow alive in all
of those, and only while the reader is pinned.

`ProcessPanel` floats the composer over the transcript, so the transcript reserves
space for it: `COMPOSER_GAP` (24px) plus the composer's own measured height. The
composer's height is **measured**, not assumed — it grows with the scope row and
the auto-resizing textarea, and the old fixed reserve left a long question's answer
behind the input. A single `ResizeObserver` publishes the reserve as
`--composer-reserve` on the panel card; the transcript's `padding-bottom`, the
back-to-bottom control's offset and the scroll fade all read that one value. The
fade is exactly the reserve's height for the same reason: a taller fade dims the
last line of every answer, because the content scrolls under it.

Two rules for the composer and for leaving the workspace:

- **Enter sends; only the Stop button aborts.** Enter used to abort a running
  generation while the composer was disabled during a stream, so the key you press
  to send was the key that cancels — and the composer was unusable for composing
  the next question while reading the current answer, which is the actual rhythm
  of research. The textarea now stays enabled while a turn streams; `canSend` is
  still false, so Enter is inert rather than destructive, and the Stop button is
  the single abort affordance. Shift+Enter is still a newline.
- **Sending always brings your own message into view.** `MessageList` exposes a
  `pinToBottom` handle and `handleSend` calls it, so the follow state cannot hide
  the message the user just wrote.
- **Leaving the workspace asks first when the note editor is dirty.** Closing a
  tab, switching tabs, the Home tab and `Cmd/Ctrl+D` all unmount it. `NotePanel`
  publishes its dirty state to `uiStore` (only it knows), and `NotebookLayout`
  owns the single `UnsavedChangesDialog` that every one of those paths goes
  through. The in-panel Back button is not special-cased — it uses the same
  state. A navigation path that skips this guard is a bug.

### An answer shows what it was built from

Implementation: `components/notebook/chat/AnswerSources.tsx`, fed by
`chat_messages.metadata` (see [message metadata](#message-metadata)).

Retrieval already knew which passages it used and threw the identity away: the
prompt kept a title and some text, and `chunkId` / `documentId` were dropped. The
answer therefore looked identical whether it came from the reader's documents or
from nowhere, which is the one distinction this product cannot afford to lose.

The region has three states, and they are three different statements — do not
collapse them:

| State            | Shown                                                         |
| ---------------- | ------------------------------------------------------------- |
| `used`           | A disclosure: "Based on N source passages" → the passages     |
| `none`           | One T3 line: nothing from your sources was used               |
| `failed`         | One T3 line: searching your sources failed                    |
| no status at all | **Nothing** — an older message is "unknown", not "ungrounded" |

Rules:

- **The passage is quoted verbatim**, never summarised or truncated into a
  paraphrase. It is the evidence; if it is too long to read, it is still too long
  to invent.
- Each passage sits in `bg-muted` — a recessed container inside the panel, per the
  surface rules. The region is **not** a `Card`: cards inside panels nest, and this
  belongs to the message, not beside it.
- Density is the disclosure's job. The collapsed state is one line; the passages
  are behind it.
- Only after the turn ends. Rendering an empty evidence list mid-answer would read
  as "nothing was used".
- The ungrounded and failed lines are T3: they must be readable, and they must not
  compete with the answer.

### Message metadata

The structured part of `chat_messages.metadata` is typed (`ChatMessageMetadata`
in `shared/types/chat.ts`) and read **only** through
`shared/utils/answerSources.ts`. Two rules:

- **Parse defensively, drop per entry.** The column is an open JSON bag written by
  whichever version of the app produced the message, so a reader never assumes a
  shape. One malformed entry must not hide the passages that did survive: two
  usable sources out of three still show two.
- **"Not recorded" is not "none".** An answer from before this existed has no
  status; saying it was ungrounded would accuse a grounded answer. Unknown
  renders nothing.

### Cross-panel requests

The transcript (centre) and the library (left) are siblings, so a citation click
cannot pass a prop. It writes to `uiStore` and `SourcePanel` derives from it **during
render** — never in an effect:

```tsx
const openDocument = focusedDocument ?? selectedDocument
```

Two things this avoids, both of which were tried and rejected:

- `setState` inside an effect to consume the request: the lint rule
  `react-hooks/set-state-in-effect` fails the build, and it cascades renders.
- Clearing the store request from inside render: writing to a store during render
  notifies other components mid-render. The clear happens in the event handlers
  instead (list click, Back), which is why the derivation needs no cleanup step.

### Geometry lives in a module, and it is tested

The arithmetic above — `availableFrom`, `maxSideWidth`, the golden-ratio split, the
stored-layout parser, and the key-to-width mapping — lives in
`components/layouts/panelGeometry.ts`, not inside the component. It used to be
inline, where the only way to exercise it was to drag a mouse, and it was wrong:
`ArrowLeft` grew the left panel and shrank the right one. That passed typecheck and
lint, and only a second reviewer found it.

`test/panelGeometry.test.ts` covers the constraint math, the stored-layout parser
(absent, corrupt, `NaN`, `Infinity`, zero) and the arrow-key direction on **both**
seams. Note what does _not_ catch the inversion: an invariant like "the two seams
move oppositely" stays true when both are flipped together. Only assertions on the
absolute direction do.

### Motion and announcement

- **`prefers-reduced-motion` is honoured** in `theme.css`: transitions and
  decorative animation collapse, scroll behaviour goes instant. Spinners keep
  turning, slowed rather than stopped — a spinner is a status indicator, and
  removing it removes information, not motion. The `!important` there is
  load-bearing: a `*` selector cannot outrank Tailwind's utility classes.
- **The transcript announces completion, never tokens.** A `role="status"` region
  inside `MessageList` reports when a turn ends, with the node keyed so an
  identical message still re-announces. Putting the live region on the transcript
  itself would chatter on every token, which is worse than the silence it replaces.
- **The tab close control is a sibling of its tab, not a child.** A real
  `<button>` with an accessible name, next to the `role="tab"` rather than nested
  inside it as a `role="button"` span. The tablist uses a roving tabindex, so the
  old inner `tabIndex={0}` added a second focus stop per open notebook and
  duplicated the Enter/Space handling the trigger already had.

## Borders and elevation

Two border weights exist, and only two:

- **Hairline divider**: `border-b border-border` / `border-r border-border` —
  panel seams, panel headers, list separators.
- **Control outline**: `border border-border` on `Input`, `Select` trigger,
  `outline` buttons and popover/menu containers.

An element gets **both** a border and a shadow only when it floats. Rules:

| Layer                                                   | Border                               | Shadow             |
| ------------------------------------------------------- | ------------------------------------ | ------------------ |
| Panel (`surface-raised`)                                | hairline dividers only, `rounded-lg` | **none**           |
| Card (`surface-raised`)                                 | optional `border border-border`      | **none**           |
| Overlay (`surface-overlay`)                             | `border border-border`               | `shadow-elevation` |
| Small controls (switch knob, slider thumb, drag handle) | —                                    | `shadow-control`   |
| Buttons, inputs, badges, tabs, list rows                | —                                    | **none**           |

`shadow-elevation` and `shadow-control` are the only shadow tokens permitted in
component code. The legacy `shadow-sm/md/lg/xl/2xl` utilities are aliases of
`shadow-elevation` and exist only so that un-migrated lines degrade to a
consistent value instead of a wild one; the design guard fails a build that
introduces them.

`ring` shadows (`ring-2`, `focus-visible:ring-ring`) are focus rings, not
elevation, and are always allowed.

## Radius

Three values, no exceptions:

| Value  | Class          | Use for                                                                                |
| ------ | -------------- | -------------------------------------------------------------------------------------- |
| 6px    | `rounded-md`   | Controls: buttons, inputs, selects, menu items, list rows, tabs, badges with a label   |
| 8px    | `rounded-lg`   | Containers: panels, cards, dialogs, popovers, empty states, icon tiles, avatars-in-box |
| 9999px | `rounded-full` | Pills, avatars, knobs, progress bars, counters                                         |

`--radius: 0.5rem` in `theme.css` derives both scale values, so this is a single
knob for the whole app. **Forbidden:** `rounded-sm`, `rounded-xl`,
`rounded-2xl`, `rounded-3xl`, `rounded-[…]`. `rounded-none` is not in the list
either: a full-bleed element inside a padded container should get its parent
`p-1` + `rounded-md` items instead of a square child.

Do not round one corner differently (`rounded-t-lg` is allowed only on a header
that is visually part of a rounded container).

## Spacing and density

Base rhythm is 4 / 8 / 12 / 16 (`gap-1,2,3,4`; `p-2,3,4,6`). Half steps
(`px-2.5`, `py-1.5`, `gap-1.5`) are tolerated only when aligning text against a
16/20px icon; do not introduce them anywhere else.

| Element                                    | Height    | Padding                                |
| ------------------------------------------ | --------- | -------------------------------------- |
| Panel header                               | `h-11`    | `px-3`, content `gap-2`                |
| Title bar (`WindowTitleBar`)               | `h-11`    | `px-2` main · `px-3` overlay           |
| Title-bar icon button                      | `w-7 h-7` | —                                      |
| Title-bar tab                              | `h-7`     | `px-3`                                 |
| Toolbar icon button (`Button size="icon"`) | `size-8`  | —                                      |
| Button (`default`)                         | `h-9`     | `px-4`                                 |
| Button (`sm`)                              | `h-8`     | `px-3`                                 |
| Button (`lg`)                              | `h-10`    | `px-5`                                 |
| Input / Select trigger                     | `h-9`     | `px-3`                                 |
| List row, compact                          | `h-8`     | `px-2`                                 |
| List row, comfortable                      | `h-9`     | `px-3`                                 |
| List row, multi-line (title + meta)        | —         | `px-2 py-2`, `rounded-md`              |
| Sidebar nav item                           | `h-8`     | `px-2`                                 |
| Card / panel body padding                  | —         | `p-4`                                  |
| Dialog padding                             | —         | `p-5`                                  |
| Section gap inside a panel                 | —         | `space-y-3` / `divide-y divide-border` |
| Page gutter                                | —         | `px-6 py-4`                            |

Rows are separated with `divide-y divide-border` or a `border-b` hairline, never
with margin gaps.

The title bar is its own density tier: it is the only place allowed to step
below `size-8` / `h-8`. `TopNavigationBar` runs 28px tabs and 28px icon buttons
so the strip reads as window chrome rather than as content, and it keeps the
window controls comfortable in the 44px bar. That tier stops at the title bar —
a 28px control inside a panel is a violation, not a precedent.

## Type scale and text hierarchy

Fonts (bound in `theme.css`, loaded by `index.html`):
`--font-sans: Inter` for UI and prose, `--font-mono: Fira Code` for code, IDs
and keycaps. `--font-serif: Lora` is reserved for long-form article titles; it is
not currently used and must not be introduced without a stated reason.

Three text levels, and only three:

| Level          | Class                    | Use for                                                                                                             |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| T1 — primary   | `text-foreground`        | Titles, panel headers, list primary line, body of documents and answers, form values                                |
| T2 — secondary | `text-muted-foreground`  | Descriptions, list secondary line, help text, placeholders, inactive icons                                          |
| T3 — tertiary  | `text-subtle-foreground` | Timestamps, counters, keyboard hints, disabled labels — anything that must be readable but must not attract the eye |

Do not express hierarchy by inventing a new grey (`text-gray-500`), and do not
use opacity on top of a level (`text-muted-foreground/70`).

Sizes:

| Size | Class         | Use for                                                                                    |
| ---- | ------------- | ------------------------------------------------------------------------------------------ |
| 11px | `text-[11px]` | Keycaps, tiny counters (rare; prefer `text-xs`)                                            |
| 12px | `text-xs`     | Meta line, timestamps, badges, table headers, code                                         |
| 14px | `text-sm`     | **Default UI size**: buttons, labels, list rows, inputs, prose in chat and the editor      |
| 16px | `text-base`   | Dialog titles, empty-state body (only where 14px reads cramped)                            |
| 18px | `text-lg`     | Page titles, empty-state titles                                                            |
| 20px | `text-xl`     | Focus content: home page title, flashcard face                                             |
| 30px | `text-3xl`    | The notebook title in the workspace header, `font-semibold tracking-tight`. One per screen |
| 36px | `text-4xl`    | A single focus readout (quiz score). One per screen                                        |

Weights: `font-normal` for body, `font-medium` for interactive labels, panel
headers, section titles, titles and the selected state of anything.
`font-semibold` and above are reserved for two things: headings inside long-form
prose (`.markdown-content h1–h4`, `.ProseMirror h1–h3`, all 600), and the one
focus readout per screen. A prose heading is never `font-bold`: an `h3` inside an
answer must not out-weigh the panel header above it. Never use weight alone to
express selection — pair it with `bg-surface-selected`.

Line height: UI text uses Tailwind defaults. Long-form reading surfaces
(`markdown.css`, `noteEditor.css`) use 14px / `line-height: 1.75`.

**Measure.** There are two widths, because a workspace and a reading column are
different things.

A long-form reading surface is capped at `--reading-measure` (72ch) and centred:

```tsx
<div className="mx-auto w-full max-w-[var(--reading-measure)] px-4 py-6">
```

The note editor (`NoteEditor.tsx`, `p-4`) is that surface. Widening a panel adds
margin around the column; it must never lengthen the line — uncapped, a 1000px
centre panel sets prose at roughly 130 characters per line.

The chat transcript is not a reading column. Its canvas — the notebook header,
the empty state and the message list in `MessageList.tsx` — is `max-w-5xl`
(~1024px), the same width as the home page, so a wide centre panel is actually
used. Inside that canvas an answer is capped at `--answer-measure` (88ch) rather
than by `--reading-measure`: an answer carries tables and code as often as prose,
and a paragraph at 88ch is still inside a comfortable band. A user message keeps
its narrower bubble. The composer (`ProcessPanel.tsx`) is centred on the same
`max-w-5xl` canvas, so the input lines up with the transcript it answers.

Both tokens are defined once in `theme.css`; take them as variants rather than
hard-coding a `ch` value or a pixel width.

The source reader does **not** read `--reading-measure` yet, and the reason is a
contract rather than an oversight: `TextSourceReader` measures its highlight
rectangles once from the laid-out range, so a column that re-centres on resize
would strand the highlight. Make that measurement resize-aware before capping
that surface.

## Accent and states

`--primary` is the only accent. It is allowed in exactly five places:

1. The primary action of a view (`Button` variant `default`).
2. Focus indication (`focus-visible:ring-2 focus-visible:ring-ring`).
3. The selected indicator of a nav/list row: a 2px bar
   (`before:` / `absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary`) or a
   filled `bg-primary text-primary-foreground` icon chip.
4. Inline links: the `Button` variant `link`, and prose links inside long-form
   content (`.markdown-body`, `.note-editor`).
5. Progress and slider fill (`bg-primary`), where the colour _is_ the data.

Everywhere else — toolbars, icon buttons, headers, cards, badges, tab labels,
progress — the UI is neutral. A blue icon in a neutral toolbar is a violation.
`--destructive` is allowed only on a destructive action and its confirmation
dialog, and `--success` only on the outcome of a graded result (correct answer,
passing check). Neither is decoration, and neither may be the only carrier of
state: pair it with an icon or a label. `--chart-*` are for charts, graph nodes
and mind-map topic colouring, and are used as small data dots rather than as
text-bearing fills (they sit at one lightness in both themes, so no single text
colour reads on them).

State expressions (use these literal forms, they are the contract):

| State         | Expression                                                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hover         | `hover:bg-surface-hover` (rows, menu items, ghost/outline buttons; see [Raised card](#raised-card) for opaque cards)                                                                |
| selected      | `bg-surface-selected` + `text-foreground` + `font-medium`; optional 2px primary indicator                                                                                           |
| focus-visible | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background` (inputs use `ring-1` with `border-ring`) |
| disabled      | `disabled:pointer-events-none disabled:opacity-50`                                                                                                                                  |
| transition    | `transition-colors` for fills; `transition-[transform,opacity]` for popovers. No bouncy or long animations on chrome.                                                               |

A row that is both hovered and selected keeps the selected fill; do not stack
`hover:bg-surface-hover` on `bg-surface-selected` elements. The one exception to
the hover form above is an opaque `surface-raised` card, where the token has to
be composited rather than swapped — see [Raised card](#raised-card).

`Tabs` has exactly two documented forms, and they express selection differently:

- **Segmented control** — settings, filters, mode switches. Track
  `bg-surface-sunken`, selected segment `bg-surface-raised`, no shadow. The thumb
  has to cover the track, so selection is a surface step. Both steps are monotonic
  in dark mode, which `bg-muted` + `bg-background` was not.
- **Tab strip** — `TopNavigationBar`'s open notebooks are document tabs, not a
  mode switch. No track (`bg-transparent border-0 p-0 h-auto`), and selection is
  the ordinary translucent fill: `bg-surface-selected` + `text-foreground` +
  `font-medium`, with a resting `border-transparent` becoming `border-border` when
  active so the label does not shift by a pixel.

Small atoms keep the control radius even though it is proportionally rounder:
a 16px checkbox is `rounded-md`, not a new radius value.

## Dark mode

Dark mode is a first-class theme, not a filter. Requirements:

- Every surface, border and text token has a dark value defined in `theme.css`;
  a component must never branch on the theme itself.
- The surface ladder is monotonic in dark mode too (see [Surfaces](#surfaces)).
- Text levels keep their contrast ordering: T1 > T2 > T3. Do not ship a dark
  value that reads below 3:1 against its surface.
- Colour is never the only carrier of state (selection, error, warning) — pair it
  with weight, an icon, or a border.
- Both themes must be usable on every page; a page that "looks off in dark" is a
  blocker, not a follow-up.

## Do / Don't

Do:

- Separate panels with a hairline and one surface step.
- Use `bg-surface-hover` for hover, `bg-surface-selected` for selection.
- Keep a screen to one accent action.
- Put reading content on `surface-raised` with T1 text and generous line height.
- Reach for `text-sm` before anything else; go smaller only for meta.

Don't:

- `bg-white`, `bg-black`, `bg-slate-*`, `text-gray-*`, `border-[#…]`, raw
  `oklch(...)` in a component, `bg-card shadow-md` panels, `rounded-xl` cards,
  `shadow-sm` buttons or inputs, `rounded-sm` controls.
- Gradients, glassmorphism (`backdrop-blur` except on a floating toolbar over
  scrolling content), glow effects. **One sanctioned exception:** the scroll fade
  between the transcript and the floating composer — a functional fade, sized to
  the measured composer reserve it covers so it never dims the last line of an answer
  (`ProcessPanel.tsx`).
- Colour icons in neutral chrome; colour-coded sections chosen from `--chart-*`
  outside chart/graph surfaces.
- Express hierarchy with `scale-*` transforms on chrome (allowed only inside
  mind-map / graph editors, where zoom is part of the interaction).
- `transition-all` on rows (`transition-colors` is enough and avoids animating
  layout properties).

## Component recipes

Copy these shapes. `cn()` (`@/lib/utils`) is used for merging class overrides.

### Panel

`Panel` is the frame for a workspace zone. Which tier it takes depends on what
the zone holds — a rail is chrome, the thing being read is content:

- **Rail** (library, notes, settings nav): `bg-surface-base`.
- **Content** (chat transcript, reader, editor): `bg-surface-raised`.

A rail and a content panel share the same hairline; what separates them is the
tier under it. The hairline is one step lighter than it used to be, because the
surface ladder now carries part of the separation the outline used to carry
alone — do not compensate by reaching for a darker border, and do not add a
second outline to a rail that already sits in the gutter.

```tsx
// rail
<Card className="flex h-full flex-col overflow-hidden bg-surface-base">
// content
<div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface-raised">
  <PanelHeader … />
  <div className="min-h-0 flex-1 overflow-y-auto themed-scrollbar">…</div>
</div>
```

There are two scroll controls and they must look like one. `themed-scrollbar` is
the native-scrolling variant above; a Radix `ScrollArea`
(`components/ui/scroll-area.tsx`) draws its own bar instead, because a surface
that needs to read or set scroll position (the chat transcript) cannot use a
plain overflow container. The primitive's bar is deliberately the same control:
8px track, a 4px `--muted-foreground` pill that darkens to `--foreground` on
hover. Change them together, never one without the other.

### Panel header

Implementation: `components/ui/panel-header.tsx`.

```tsx
<div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3" />
```

A panel header is chrome. It carries the panel's own controls and nothing that
belongs to the document — in the chat panel that is the two collapse toggles, and
its centre is an empty `<span />` that exists only to keep the centre a drag
surface. Do not put the notebook title back in it: the title is the document
header's job (see [Notebook header](#notebook-header)), and the window's tab strip
already carries the name at all times.

The content below a panel header starts at `top-11`, the header's own height.
Nothing sits in between; a `top-14` left a 12px dead band under every header.

### Notebook header

Implementation: `components/notebook/chat/NotebookHeader.tsx`, rendered as the
first block inside the transcript's scroll area (it is passed to `MessageList` as
`header`, not positioned above it).

```tsx
<header className="pt-6 pb-2">
  <button className="block w-full cursor-text rounded-md text-left text-3xl font-semibold tracking-tight break-words">
    {notebook.title}
  </button>
  <p className="mt-2 text-xs text-subtle-foreground">
    {sources} · {updated}
  </p>
</header>
```

- **The title scrolls with the answer**, like a page title, instead of sitting
  pinned above the scroll area. Pinning it would change the boxes the composer
  reserve, the scroll fade and the follow-the-answer observer are measured
  against; scrolling it costs nothing and reads as a document.
- **The title is a `<button>`, not a span with a click handler**, and its
  affordance is `cursor-text` — no resting border, no hover fill. At `text-3xl` a
  hover block would read as a control sitting on a document.
- **Metadata is one T3 line**: `documents` count and the relative updated date
  (`lib/relativeDate.ts`, shared with `NotebookCard`). Counters and timestamps are
  exactly what T3 is for.
- **There is no subtitle.** `notebooks.description` exists but nothing in the app
  can author it, so every notebook carries the same creation-time filler. Printing
  a sentence the user never wrote is worse than an empty line; add it when the
  field is editable.

### Window title bar

Implementation: `components/common/WindowTitleBar.tsx`. Every window uses it;
none hand-rolls the geometry. `left` and `right` take content (the reserves are
applied around them), and `center` takes the remaining width.

```tsx
// main window: the tab strip is the centre, settings sits next to the controls
<WindowTitleBar className="gap-0.5" right={<SettingsButton />} center={<TabStrip />} />

// secondary window: the bar floats over full-bleed content
<WindowTitleBar
  overlay
  className="border-b border-border"
  center={<span className="text-sm font-medium text-foreground">{title}</span>}
  right={<Actions />}
/>
```

Children that live inside a `WebkitAppRegion: 'drag'` bar must set
`WebkitAppRegion: 'no-drag'` on themselves, or they cannot be clicked.

### Section / list

Separators, not gaps:

```tsx
<div className="divide-y divide-border">
  <button className="flex h-9 w-full items-center gap-2 px-3 text-sm text-foreground transition-colors hover:bg-surface-hover" />
</div>
```

### Rail list

A list inside a chrome panel (the library, the notes list) is not a table. Rows
are separated by a 4px gap and identified by a `hover` fill on a `rounded-md`
block, never by a hairline; groups are separated by 12px and labelled with a T3
section heading.

```tsx
<div className="p-2 space-y-3">
  <section className="space-y-1">
    <h2 className="select-none px-2 py-0.5 text-xs font-medium text-subtle-foreground">
      {label}
    </h2>
    {/* one row */}
    <div className="group flex items-start gap-0.5 rounded-md transition-colors hover:bg-surface-hover focus-within:bg-surface-hover">
      <button className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm text-foreground">{title}</span>
          <span className="truncate text-xs text-subtle-foreground">{meta}</span>
        </span>
      </button>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={…}
          className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
        />
      </DropdownMenuTrigger>
    </div>
  </section>
</div>
```

Rules:

- **A heading is rendered only when there is more than one group.** A heading over
  the only group restates the panel header.
- **Secondary actions live in one `···` menu, revealed on hover or focus.** A row
  in a rail never carries a permanent column of buttons — that is what made every
  source row read as a toolbar. Retry, re-index, open and delete are items in the
  same menu, applied in that order with the destructive item last, below a
  separator.
- **The hover-revealed control is always laid out**, with `opacity-0` rather than
  `hidden`/conditional rendering, so revealing it cannot reflow the title.
- **The row button and its menu trigger are siblings**, never nested. A button
  inside a button is unreachable by keyboard and is the same defect the tab strip
  already fixed.
- **The row button keeps a real hover fill** (`hover:bg-surface-hover` on the
  wrapper). The revealed control uses `hover:bg-surface-selected` so it stays
  visible on top of it.
- **A source row leads with what the source is.** The metadata line is
  `<kind> · <n> chunks`, where the kind comes from `lib/sourceKind.ts`
  (`sourceKindOf`), not from `document.type` — `file` covers PDF, Word and Slides,
  and "202 chunks" on its own is machine vocabulary, not a fact about the source.
  The leading glyph is `KIND_ICON[kind]` in the same module's vocabulary, drawn
  from one library at one stroke weight and left neutral: the kind is carried by
  the glyph **and** the word, never by a tint (a colour icon in neutral chrome is
  a violation).
- **The kind is derived, never stored twice.** `sourceKindOf` is the single
  reader of `mimeType` / path / URL, it is total (an unknown file is `file`, not a
  guessed `text`), and it is asserted in `test/sourceKind.test.ts`. It is
  deliberately _not_ shared with `SourceReader`'s `isPdf`: that predicate answers
  "which reader renders this?", which is a rendering contract, and folding the two
  together would let a display change pick a different reader.
- **There is no persistent selected row in the library.** Clicking a source
  replaces the list with the reader (see [Library and Reading are one zone, two
  states](#library-and-reading-are-one-zone-two-states)), so there is no state in
  which a selected row is on screen; do not add one back. The notes rail does have
  a real selection and uses the [Selected row](#selected-row) recipe.

### Selected row

```tsx
<button className="flex h-9 items-center gap-2 rounded-md bg-surface-selected px-3 text-sm font-medium text-foreground" />
```

### Floating layer

Dialog, popover, menu, toast:

```tsx
<div className="rounded-lg border border-border bg-surface-overlay shadow-elevation" />
```

### Composer

Implementation: `components/notebook/ProcessPanel.tsx`. The chat composer is the
one floating layer that lives permanently on the page rather than over it.

```tsx
<div className="relative bg-surface-overlay rounded-lg border border-border focus-within:ring-2 focus-within:ring-ring shadow-elevation">
  <ScopeSelector … />
  <Textarea className="min-h-[56px] max-h-[280px] py-3 pl-4 pr-14 resize-none border-0 bg-transparent focus-visible:ring-0" />
  <Button size="icon" className="absolute right-2 bottom-3 rounded-full" />
</div>
```

- **Opaque, and no blur.** It is a floating surface with a hairline and
  `shadow-elevation`. It does not take `backdrop-blur` — the functional scroll
  fade below the transcript already covers the content that passes under it, so a
  blur here costs GPU and returns nothing.
- **One line when empty.** `min-h-[56px]` keeps it reading as an input; it grows
  with the content to `max-h-[280px]`.
- **Its height is measured, never assumed.** `ProcessPanel` writes the measured
  height to `--composer-reserve`, and `MessageList`'s bottom padding and the fade
  both read that variable. `COMPOSER_RESERVE_FALLBACK` in `stickToBottom.ts` is
  only the pre-measurement value; if the composer's geometry changes, that
  constant is the one to re-derive (it is the scope row + the one-line textarea +
  the wrapper padding).
- **The send control is a pill inside the composer**, not a sibling below it.

### Raised card

Implementation: `components/common/NotebookCard.tsx`.

A card is opaque `bg-surface-raised`, so `hover:bg-surface-hover` does **not**
work on it the way it does on a row: it replaces the fill instead of adding to
it, and in dark mode `surface-hover` over `surface-base` lands on almost the
same lightness as `surface-raised` — an invisible hover. Composite the token as
an overlay so it stays visible in both themes:

```tsx
<Card className="group relative cursor-pointer overflow-hidden">
  <div
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 bg-surface-hover opacity-0 transition-opacity group-hover:opacity-100"
  />
  …
</Card>
```

That is the only sanctioned use of an extra overlay element; do not reach for it
on rows, menu items or buttons, where `hover:bg-surface-hover` is still correct.

### Empty state

Implementation: `components/ui/empty.tsx`. `EmptyMedia variant="icon"` uses
`bg-muted text-muted-foreground`, never the accent; the container is a
`rounded-lg` dashed hairline, no shadow. Empty state copy is chrome, not
content: mark the container `select-none` so a mouse drag cannot select it.

In a narrow panel the dashed outline is visual noise around an already empty
area, so a panel-level empty state opts out with `border-none`
(`DocumentList`). The primitive keeps its dashed hairline — that opt-out is the
exception, and it belongs to the panel that asked for it, not to `Empty`.

### Form field

Implementation: `components/ui/field.tsx` — `Field`, `FieldSet`, `FieldLegend`,
`FieldGroup`, `FieldContent`, `FieldLabel`, `FieldTitle`, `FieldDescription`,
`FieldError`, `FieldSeparator`. Prefer these over hand-rolled label/input/error
stacks: `FieldError` already carries the `text-destructive text-sm` treatment and
the `role="alert"` wiring.

- Label: T1 `text-sm font-medium` (`Label` and `FieldLabel` both default to it).
  The label is not a T2 meta line — it names the value below it.
- Control: `h-9 rounded-md border border-border bg-surface-base px-3 text-sm`,
  matching `Input` and the `Select` trigger. (`h-8` is the `sm` button height and
  the compact row height, not an input height.)
- Error: `text-sm text-destructive`, from `FieldError`.

Never signal an error with a red border alone.

## Adding a page: order of decisions

1. Pick the tiers: which zone is the `surface-sunken` floor, which panels are
   `surface-base` chrome (rails), and which one is the `surface-raised` content.
2. Pick the panel header height (`h-11`) and the row density (`h-8` / `h-9`).
3. Build with the [recipes](#component-recipes); pick radius from the radius
   table, never a literal.
4. Add the four states to every interactive element.
5. Add the empty state using `Empty` before adding padding or placeholders.
6. Check both themes, and check that the only accent on the screen is the primary
   action and the focus ring.

If any step needed a value that is not in this document, add that value here in
the same PR.

## Enforcement

`npm run check:design` (`scripts/check-design-tokens.mjs`) reads the renderer
sources — no build, no dependencies — and fails on:

| Rule                  | Fails when                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `radius`              | a radius utility other than `rounded-md`, `rounded-lg`, `rounded-full` and their `t/b/l/r` forms                    |
| `shadow`              | an elevation utility other than `shadow-elevation`, `shadow-control`, `shadow-none`                                 |
| `palette`             | a colour utility from the raw Tailwind palette (`bg-slate-100`, `text-gray-500`) or an arbitrary colour (`bg-[#…]`) |
| `text-level`          | alpha stacked on a text level (`text-muted-foreground/70`)                                                          |
| `chart-scope`         | `--chart-*` as a utility class or as `var(--chart-N)`, outside `CHART_SURFACES` in the script                       |
| `raw-colour-in-style` | a colour function (`hsl(`, `rgb(`, `oklch(` …) inside an inline `style` object — including `hsl(var(--card))`       |
| `css-radius`          | a raw CSS `border-radius` outside `0.375rem` / `0.5rem` / `9999px`                                                  |

`chart-scope` and `raw-colour-in-style` were added after a rule-shaped defect
reached `main` twice: chart colours on list rows and a `hsl(var(--card))` scroll
fade. Neither was catchable before, because `--chart-*` is a semantic token rather
than a raw palette colour, and this guard only looked at utility classes — not at
inline style objects. `CHART_SURFACES` is the only allowlist, and it names one
file: the mind-map node, which is a graph node.

`test/designGuard.test.ts` covers the allowlist predicate and the rule list. It
exists because the first version of that predicate compared a forward-slash
pattern against a platform path: on Windows it never matched, so the one file it
was written to exempt was the one file it flagged. Linux and macOS CI passed;
the Windows job failed. A test asserts both separator styles now, so the same bug
is caught locally on any platform.

Known gap, stated rather than implied: a raw **hex** in an inline style
(`style={{ background: '#fff' }}`) still passes. That is deliberate — the one
current use is the mind-map PNG export, which needs a fixed background rather
than a themed one (`MindMapPage.tsx`). Anything that wants a literal colour
should be raised as a rule change, not smuggled through.

`npm run check:design -- --list` prints the rules and the allowlists. The check
runs in the `Verify` workflow, before the build matrix.

What it does **not** enforce, and therefore relies on review: the surface ladder
(which surface a panel uses), accent discipline, spacing and density, and the
four interaction states. Those are the rules a reviewer must hold the line on.

## Locales

`en-US` and `zh-CN` move together (CONTRIBUTING.md), and the check is **parity**:
neither file may carry a key the other lacks.

**One exception: plural forms.** English declares `key_one` / `key_other` and
Chinese declares `key` alone with no suffix, which is the correct i18next shape and
not a missing translation. This matters when pruning: a literal search for a key
misses plural forms entirely, because `t('ankiCards', { count })` never renders the
string `ankiCards_one` in source. Prune by hand for those, or keep them
unconditionally.

Two prunes have already found the same artefact: each locale file carried a block
of English-only keys for surfaces that do not exist (an editor menubar, a notes /
trash / tags feature). They were unreachable, and they made the app read as
half-translated. Delete dead copy rather than translating it.
