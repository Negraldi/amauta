# Design

Visual system for the amauta portal (the local wiki). Strategy and audience live in `PRODUCT.md`.

## Visual Theme

A calm, studious reading surface: a knowledge notebook, not a control room. Restrained color, one accent, generous
reading measure for prose and dense tabular layout for data. Light and dark follow the operating system and are
designed with equal care. Scene: one person, in an app window next to their editor, at any hour, reading what their
harness has learned.

Anchors: Obsidian (sidebar and backlinks that invite wandering), a well-made Wikipedia article (measure and
hierarchy), Stripe docs (exact tabular numbers, sober tables).

## Color

Restrained: tinted neutrals (chroma 0.004-0.012 toward the accent hue 200) plus one accent. No cream, sand or beige
body background. The accent marks links, current selection and focus only. Data colors are reserved for token
series. Status never relies on color alone (always a label, icon or shape).

| Token | Light (OKLCH) | Dark (OKLCH) | Role |
|---|---|---|---|
| `--bg` | 0.985 0.004 200 | 0.19 0.008 200 | Page background |
| `--surface` | 1 0 0 | 0.225 0.009 200 | Reading column, panels |
| `--sidebar` | 0.965 0.006 200 | 0.165 0.008 200 | Sidebar and rail layer |
| `--ink` | 0.23 0.012 200 | 0.93 0.006 200 | Body text (>= 4.5:1 on bg/surface) |
| `--ink-muted` | 0.45 0.012 200 | 0.74 0.01 200 | Secondary text (>= 4.5:1) |
| `--line` | 0.89 0.008 200 | 0.32 0.01 200 | Hairlines, table rules |
| `--accent` | 0.50 0.09 200 | 0.78 0.09 200 | Links, selection, focus ring |
| `--accent-soft` | 0.95 0.025 200 | 0.30 0.04 200 | Selected row, current nav item background |
| `--warn` | 0.52 0.15 70 | 0.80 0.13 75 | Warnings and errors (with icon + text) |
| `--ok` | 0.50 0.12 150 | 0.78 0.12 150 | Done/success (with label) |
| `--c-input` | 0.55 0.13 255 | 0.75 0.11 255 | Data: input tokens |
| `--c-output` | 0.68 0.14 60 | 0.80 0.12 60 | Data: output tokens |
| `--c-cache-read` | 0.62 0.11 165 | 0.80 0.10 165 | Data: cache read |
| `--c-cache-write` | 0.58 0.13 300 | 0.76 0.10 300 | Data: cache write |

## Typography

- Reading serif: Source Serif 4 (OFL), Latin subset, vendored as woff2 (regular, italic, semibold), for page prose
  (memory content, SKILL.md, ODD documents) at 1.0625rem / 1.6, measure 68ch.
- UI sans: the system stack (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`) for navigation, labels,
  buttons, tables and numbers (`font-variant-numeric: tabular-nums`).
- Mono: `ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace` for code, ids, paths.
- Fixed rem scale, ratio about 1.2: 0.8125 / 0.875 / 1 / 1.0625 (prose) / 1.25 / 1.5 / 1.875rem. Page titles in the
  serif at 1.875rem, weight 600, `text-wrap: balance`; section headings in the sans at 1.25rem / 1rem.

## Layout

- Shell: left sidebar (15rem; collapses below 52rem into a toggle), top bar with the search trigger (Ctrl+K) and
  the date range, content area.
- Text pages: reading column (max 68ch) plus a right rail (18rem) for metadata, links, backlinks and revisions on
  wide screens; the rail moves below the content under 72rem.
- Data pages: full content width, dense tables, sticky header row.
- Home: recent activity as the main column; spending summary and harness health in the rail. No hero-metric tiles.
- Spacing scale (rem): 0.25, 0.5, 0.75, 1, 1.5, 2, 3. Vary it for rhythm; sections separated by space and a hairline,
  not by boxes. Cards only where an item is a real object (a search result group, a settings option).
- Z-index scale: dropdown 10, sticky 20, overlay 30, dialog 40, toast 50, tooltip 60.

## Components

- Links: accent color, underline on hover and focus; wikilinks to missing pages in `--ink-muted` with a dotted
  underline. External links get a small arrow glyph.
- Search palette: native `<dialog>`, results grouped by kind with the kind as a text label, arrow-key navigation.
- Tables: hairline rules, right-aligned tabular numbers, sortable headers with a visible sort indicator.
- Status chips: text label plus a shape (filled dot = done, ring = pending, triangle = warning); color reinforces only.
- Buttons: one shape for the whole surface (6px radius, 1px line border); primary action in accent fill only for
  the confirm step of the settings editor.
- Every interactive element has default, hover, focus-visible (2px accent ring, 2px offset), active, disabled,
  loading states. Loading uses skeleton lines, not spinners in content.
- Empty states teach: say what will appear and how it gets there (e.g. "Memories appear here after mem_save").

## Motion

150-200 ms, ease-out-quart, for state changes only (hover, selection, dialog open, rail toggle). No page-load
choreography. `prefers-reduced-motion: reduce` turns transitions into instant changes.
