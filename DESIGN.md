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

| Token                | Tailwind              | Light               | Dark                            | Use for                                                                 |
| -------------------- | --------------------- | ------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| `--surface-sunken`   | `bg-surface-sunken`   | `oklch(0.9551 0 0)` | `oklch(0.24 0.0127 258.3724)`   | Window chrome that sits _behind_ content: sidebar, left rail, title bar |
| `--surface-base`     | `bg-surface-base`     | `oklch(0.9851 0 0)` | `oklch(0.2925 0.0157 264.2965)` | App canvas, page background, the gap between panels                     |
| `--surface-raised`   | `bg-surface-raised`   | `oklch(1 0 0)`      | `oklch(0.325 0.011 260)`        | Content panels: document list, reader, chat, editor, cards              |
| `--surface-overlay`  | `bg-surface-overlay`  | `oklch(1 0 0)`      | `oklch(0.365 0.011 260)`        | Floating layers: dialog, sheet, popover, menu, select, tooltip, toast   |
| `--surface-hover`    | `bg-surface-hover`    | `foreground @ 5%`   | `neutral 0.9 @ 6%`              | Translucent hover fill for rows, menu items, ghost buttons              |
| `--surface-selected` | `bg-surface-selected` | `foreground @ 9%`   | `neutral 0.9 @ 10%`             | Translucent selected/active fill for rows and toggles                   |

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

Legacy aliases kept for compatibility while pages migrate:
`--background`, `--card`, `--popover`, `--sidebar`, `--accent`,
`--sidebar-accent` are defined in terms of the tokens above. New code uses
`surface-*`.

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

| Element                                    | Height   | Padding                                |
| ------------------------------------------ | -------- | -------------------------------------- |
| Panel header                               | `h-11`   | `px-3`, content `gap-2`                |
| Toolbar icon button (`Button size="icon"`) | `size-8` | —                                      |
| Button (`default`)                         | `h-9`    | `px-4`                                 |
| Button (`sm`)                              | `h-8`    | `px-3`                                 |
| Button (`lg`)                              | `h-10`   | `px-5`                                 |
| Input / Select trigger                     | `h-9`    | `px-3`                                 |
| List row, compact                          | `h-8`    | `px-2`                                 |
| List row, comfortable                      | `h-9`    | `px-3`                                 |
| List row, multi-line (title + meta)        | —        | `px-2 py-2`, `rounded-md`              |
| Sidebar nav item                           | `h-8`    | `px-2`                                 |
| Card / panel body padding                  | —        | `p-4`                                  |
| Dialog padding                             | —        | `p-5`                                  |
| Section gap inside a panel                 | —        | `space-y-3` / `divide-y divide-border` |
| Page gutter                                | —        | `px-6 py-4`                            |

Rows are separated with `divide-y divide-border` or a `border-b` hairline, never
with margin gaps.

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
| hover         | `hover:bg-surface-hover` (rows, menu items, ghost/outline buttons)                                                                                                                  |
| selected      | `bg-surface-selected` + `text-foreground` + `font-medium`; optional 2px primary indicator                                                                                           |
| focus-visible | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background` (inputs use `ring-1` with `border-ring`) |
| disabled      | `disabled:pointer-events-none disabled:opacity-50`                                                                                                                                  |
| transition    | `transition-colors` for fills; `transition-[transform,opacity]` for popovers. No bouncy or long animations on chrome.                                                               |

A row that is both hovered and selected keeps the selected fill; do not stack
`hover:bg-surface-hover` on `bg-surface-selected` elements.

A **segmented control** (`Tabs`) is the one place where selection is expressed as
a surface step rather than a translucent fill, because the thumb must cover the
track: track `bg-surface-sunken`, selected segment `bg-surface-raised`, no shadow.
Both steps are monotonic in dark mode, which `bg-muted` + `bg-background` was not.

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
  scrolling content), glow effects.
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

### Empty state

Implementation: `components/ui/empty.tsx`. `EmptyMedia variant="icon"` uses
`bg-muted text-muted-foreground`, never the accent; the container is a
`rounded-lg` dashed hairline, no shadow. Empty state copy is chrome, not
content: mark the container `select-none` so a mouse drag cannot select it.

### Form field

Label is T2 `text-xs font-medium`, control is `h-8 rounded-md border
border-border bg-surface-base px-3 text-sm`, error text `text-xs text-destructive`.
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

| Rule         | Fails when                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `radius`     | a radius utility other than `rounded-md`, `rounded-lg`, `rounded-full` and their `t/b/l/r` forms                    |
| `shadow`     | an elevation utility other than `shadow-elevation`, `shadow-control`, `shadow-none`                                 |
| `palette`    | a colour utility from the raw Tailwind palette (`bg-slate-100`, `text-gray-500`) or an arbitrary colour (`bg-[#…]`) |
| `text-level` | alpha stacked on a text level (`text-muted-foreground/70`)                                                          |
| `css-radius` | a raw CSS `border-radius` outside `0.375rem` / `0.5rem` / `9999px`                                                  |

`npm run check:design -- --list` prints the rules and the allowlists. The check
runs in the `Verify` workflow, before the build matrix.

What it does **not** enforce, and therefore relies on review: the surface ladder
(which surface a panel uses), accent discipline, spacing and density, and the
four interaction states. Those are the rules a reviewer must hold the line on.
