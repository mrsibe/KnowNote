# KnowNote Design System

KnowNote is a desktop reading, note-taking and RAG tool. The interface is mostly
chrome around content that people read for a long time: document text, notes,
chat answers, settings.

This document is the **single source of truth for UI decisions in this
repository**. It is written to be executable: every rule names a token or a
Tailwind class. If you are an agent adding a page or a component, follow the
recipes in [Component recipes](#component-recipes) instead of inventing values.
If a rule here is wrong or missing, change this file in the same PR as the code.

Non-goals: this document does not define product behaviour, information
architecture, branding (logo, hue of the primary colour) or i18n.

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

## Surfaces

The app is a stack of opaque surfaces plus two translucent state fills. Higher
in the stack means further from the window background, and **lighter** in both
colour schemes.

| Token                | Tailwind              | Light               | Dark                            | Use for                                                                                                    |
| -------------------- | --------------------- | ------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `--surface-sunken`   | `bg-surface-sunken`   | `oklch(0.9551 0 0)` | `oklch(0.24 0.0127 258.3724)`   | Window chrome that sits _behind_ content: the settings sidebar and dialog shell, a segmented-control track |
| `--surface-base`     | `bg-surface-base`     | `oklch(0.9851 0 0)` | `oklch(0.2925 0.0157 264.2965)` | App canvas, page background, the gap between panels                                                        |
| `--surface-raised`   | `bg-surface-raised`   | `oklch(1 0 0)`      | `oklch(0.325 0.011 260)`        | Content panels: document list, reader, chat, editor, cards                                                 |
| `--surface-overlay`  | `bg-surface-overlay`  | `oklch(1 0 0)`      | `oklch(0.365 0.011 260)`        | Floating layers: dialog, sheet, popover, menu, select, tooltip, toast                                      |
| `--surface-hover`    | `bg-surface-hover`    | `foreground @ 5%`   | `neutral 0.9 @ 6%`              | Translucent hover fill for rows, menu items, ghost buttons                                                 |
| `--surface-selected` | `bg-surface-selected` | `foreground @ 9%`   | `neutral 0.9 @ 10%`             | Translucent selected/active fill for rows and toggles                                                      |

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

**Not** part of the ladder: the window title bar. It is the OS window frame
rather than a panel, so every window draws it `bg-surface-base`, the same tone as
the canvas. Do not give it a surface step.

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
  cards floating on `surface-base`; the canvas between them _is_ the handle.
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

`MessageList` follows the transcript only while the reader is already at the
bottom (within 48px). Scrolling up suspends the follow and reveals a
`jumpToLatest` pill; the follow resumes when they return to the bottom. A stream
that force-scrolls per token makes re-reading impossible. The scroll itself is
instant, never smooth: this effect runs per token, and an animation queued that
often never settles.

The transcript's empty state and its message list must share **one** `ScrollArea`.
The scroll subscription runs once, so a viewport that only exists after messages
arrive can never be observed — that is how the follow silently stopped working
while looking correct in review.

`ProcessPanel` floats the composer over the transcript and reserves `pb-32`
(128px) for it; the scroll fade above it is `h-32` for the same reason. The fade
is sized to the reserve, not to taste: a taller fade dims the last line of every
answer, because the content scrolls under it.

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
  tab, switching tabs, the Home tab and `Cmd+W` all unmount it. `NotePanel`
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
const openDocument = selectedDocument ?? focusedDocument
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

| Size | Class         | Use for                                                                               |
| ---- | ------------- | ------------------------------------------------------------------------------------- |
| 11px | `text-[11px]` | Keycaps, tiny counters (rare; prefer `text-xs`)                                       |
| 12px | `text-xs`     | Meta line, timestamps, badges, table headers, code                                    |
| 14px | `text-sm`     | **Default UI size**: buttons, labels, list rows, inputs, prose in chat and the editor |
| 16px | `text-base`   | Dialog titles, empty-state body (only where 14px reads cramped)                       |
| 18px | `text-lg`     | Page titles, empty-state titles                                                       |
| 20px | `text-xl`     | Focus content: home page title, flashcard face                                        |
| 36px | `text-4xl`    | A single focus readout (quiz score). One per screen                                   |

Weights: `font-normal` for body, `font-medium` for interactive labels, panel
headers, section titles, titles and the selected state of anything.
`font-semibold` and above are reserved for the one focus readout per screen.
Never use weight alone to express selection — pair it with
`bg-surface-selected`.

Line height: UI text uses Tailwind defaults. Long-form reading surfaces
(`markdown.css`, `noteEditor.css`) use 14px / `line-height: 1.75`.

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
  the `pb-32` reserve it covers so it never dims the last line of an answer
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

```tsx
<div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface-raised">
  <PanelHeader … />
  <div className="min-h-0 flex-1 overflow-y-auto themed-scrollbar">…</div>
</div>
```

### Panel header

Implementation: `components/ui/panel-header.tsx`.

```tsx
<div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3" />
```

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

### Selected row

```tsx
<button className="flex h-9 items-center gap-2 rounded-md bg-surface-selected px-3 text-sm font-medium text-foreground" />
```

### Floating layer

Dialog, popover, menu, toast:

```tsx
<div className="rounded-lg border border-border bg-surface-overlay shadow-elevation" />
```

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

1. Pick the surfaces: which panel is `surface-raised`, what is `surface-base`
   between panels, what is `surface-sunken`.
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
