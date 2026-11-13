# Design

Visual system for the amauta portal (the local wiki). Strategy and audience live in `PRODUCT.md`.

## Visual Theme

"Andean ledger": a sober ledger kept by a careful scribe. Pure neutral surfaces (white and a chroma-0 near-black) carry
the reading; color arrives only as a quiet undertone taken from two Andean dyes. Cochineal red marks where you are and
what you can follow (links, the current selection, the focus ring); indigo and ochre are kept for data. Dense tabular
layout for data, a generous measure for prose. Light and dark follow the operating system and are designed with equal
care. Scene: one person, in an app window next to their editor, at any hour, reading what their harness has learned.

Anchors: a well-kept account book (ruled hairlines, exact monospaced figures), a good Wikipedia article (measure and
hierarchy), Stripe docs (sober tables), Linear (a quiet shell that disappears into the task).

## Color

Restrained: pure neutral surfaces (chroma 0) and near-neutral ink and hairlines tinted 0.003-0.008 toward the cochineal
hue 22, plus one accent. No cream, sand or beige body background. The cochineal accent is used ONLY for links, the
current selection and focus; it never marks an error or a warning. Warnings and errors stay amber (`--warn`) and always
come with an icon or shape and text. Data colors (indigo input, ochre output, slate cache read, muted violet cache
write) are reserved for token series. Status never relies on color alone (always a label, icon or shape). The
selection tint (`--accent-soft`) carries ink, muted ink or the accent, never a status color.

| Token | Light (OKLCH) | Dark (OKLCH) | Role |
|---|---|---|---|
| `--bg` | 1 0 0 | 0.13 0 0 | Page background |
| `--surface` | 0.975 0 0 | 0.17 0 0 | Panels, controls, table headers |
| `--sidebar` | 0.965 0.003 22 | 0.11 0 0 | Sidebar and filter bar layer |
| `--ink` | 0.22 0.005 22 | 0.93 0.004 22 | Body text (>= 4.5:1 on bg/surface) |
| `--ink-muted` | 0.47 0.008 22 | 0.74 0.008 22 | Secondary text (>= 4.5:1) |
| `--line` | 0.9 0.004 22 | 0.28 0.004 22 | Hairlines, table rules, control borders |
| `--accent` | 0.50 0.155 22 | 0.74 0.12 22 | Cochineal: links, selection, focus ring |
| `--accent-soft` | 0.95 0.025 22 | 0.27 0.05 22 | Selected row, current nav item background |
| `--warn` | 0.535 0.13 70 | 0.80 0.13 75 | Warnings and errors (with icon + text) |
| `--ok` | 0.50 0.11 150 | 0.78 0.12 150 | Done/success and progress bars (with label) |
| `--c-input` | 0.45 0.13 275 | 0.74 0.11 275 | Data: input tokens (indigo) |
| `--c-output` | 0.62 0.13 60 | 0.80 0.12 60 | Data: output tokens (ochre) |
| `--c-cache-read` | 0.60 0.035 250 | 0.60 0.03 250 | Data: cache read (neutral slate) |
| `--c-cache-write` | 0.55 0.13 310 | 0.66 0.14 310 | Data: cache write (muted violet) |

The four data colors reach 3:1 on `--bg` and `--surface` in both schemes (non-text contrast) and stay at least 0.1 apart in OKLab, so a stacked bar reads without its legend.

Control boundaries use `--line-strong`, which is not a table token: style.css derives it as `color-mix(in oklch, var(--ink-muted) 70%, var(--bg))`, so custom themes get one too. It measures 3.54:1 on `--bg` and 3.30:1 on `--surface` in light, 4.25:1 and 4.05:1 in dark (WCAG 1.4.11). Placeholder text is `--ink-muted` at full opacity.

### Themes

The portal ships Light and Dark (the table above) and follows the system by default. A custom theme is one JSON file in `<state>/themes/<slug>.json`:

```json
{"name": "Night", "base": "dark", "tokens": {"bg": "#101010", "accent": "oklch(0.8 0.1 30)"}}
```

- Exactly `name` (1-60 characters), `base` (`light` or `dark`) and `tokens`; nothing else is accepted.
- Allowed tokens are the 14 in the table above (`bg`, `surface`, `sidebar`, `ink`, `ink-muted`, `line`, `accent`, `accent-soft`, `warn`, `ok`, `c-input`, `c-output`, `c-cache-read`, `c-cache-write`). A token left out falls back to the base theme.
- A value is `oklch(L C H)` (L 0-1, C 0-0.5, H 0-360) or `#rrggbb`, so no value can carry other CSS.
- The editor warns in words, never blocking, when `ink` or `ink-muted` on the background is below 4.5:1 or `accent` is below 3:1 (the focus ring must stay visible). Diagrams follow the theme: Mermaid is drawn with the current `bg`, `surface`, `ink`, `ink-muted` and `line` (as hex) and drawn again when the theme changes.

### Language

English and Spanish apply to the portal chrome only (navigation, headings, labels, buttons, empty states, errors). Memories, `SKILL.md` and ODD documents are shown as written. Dates are always `YYYY-MM-DD` (date-times `YYYY-MM-DD HH:MM`, 24 h) in both languages and never break across lines; numbers are grouped with the separator of the chosen language.

## Typography

- Titles and numbers: the system mono (`ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`), weight 600,
  `letter-spacing: -0.02em` (never tighter), `text-wrap: balance`. Page titles at 1.5rem / 1.25 (1.25rem on phones);
  figures in summary values and numeric table cells, with `font-variant-numeric: tabular-nums`. The brand mark too.
- UI sans: the system stack (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`) for navigation, labels,
  buttons, tables and section headings, at 0.9375rem / 1.6 (the 1.6 line gives inline links a 24px line).
- Reading serif: Source Serif 4 (OFL), Latin subset, vendored as woff2 (regular, italic, semibold), ONLY for long prose
  (memory content, SKILL.md, ODD documents, the guide) at 1.0625rem / 1.6, measure 68ch.
- Mono is also the face for code, ids and paths.
- Fixed rem scale, ratio about 1.2: 0.8125 / 0.875 / 0.9375 (UI) / 1.0625 (prose) / 1.25 / 1.5rem. Section headings in
  the sans at 1.25rem / 1rem. No new fonts.

## Layout

- Shell: left sidebar (15rem) with the brand, the job groups (a small sentence-case muted label each, never an
  uppercase eyebrow) and a foot group (Guide, Settings) pinned to the bottom under a hairline; below 52rem it becomes
  an off-canvas panel behind the Menu toggle, with a scrim (a deeper black in dark); opening it moves focus to its first link
  and makes the page behind it inert; Esc, a tap on the scrim or navigating closes it and focus returns to Menu. Top bar: Menu
  (narrow screens), the search trigger (Ctrl K), and on the right the Refresh button and a Display button that opens a native
  popover with theme, Edit themes and language, anchored under the button on every width.
  The Range / Project / Runtime filter bar shows on the Activity list routes only. No horizontal page scroll at 375px.
- Page head pattern on every page: breadcrumb, the title (h1), its one-sentence lead, then the tabs, then the content. No
  kind label above the title (the breadcrumb names the kind); the Activity filter bar is not repeated in words.
- Item pages open with a breadcrumb (CSS-drawn separators, muted ancestors, the current page in ink); hub pages with
  several views show tabs underlined under the current one (`aria-current`), never pills.
- Tabs or a segmented control: Tabs are views of one page, kept in the URL (`?tab=`), underlined, at most one row per
  page, right under the lead. A segmented control is a filter of the same list (memory source, tool kind, catalog kind,
  pipeline category): one bordered group with the selected segment tinted, the same look whether its segments are links
  kept in the URL (`aria-current="true"`) or buttons (`aria-pressed`). It never wraps a lone segment onto its own row; it
  scrolls sideways instead.
- Text pages: reading column (max 68ch) plus a right rail (18rem) for metadata, links, backlinks and revisions on
  wide screens; the rail moves below the content under 72rem.
- Data pages: full content width, dense tables, sticky header row.
- Today (the home page, one name in the nav group, nav item and title): the harness health sentence leads as plain text
  with a link on the component count (warning tone only when something needs attention), recent activity is the main column (the five most recent days, then Show more),
  pipelines, spending and skill impact sit in the rail; under 72rem the rail comes before the feed (it is first in the DOM).
  No hero-metric tiles.
- Spacing scale (rem): 0.25, 0.5, 0.75, 1, 1.5, 2, 3. Vary it for rhythm; sections separated by space and a hairline,
  not by boxes. Cards only where an item is a real object (a search result group, a settings option).
- Z-index scale: dropdown 10, sticky 20, overlay 30, dialog 40, toast 50, tooltip 60.

## Components

- Links: accent color, underline on hover and focus; wikilinks to missing pages in `--ink-muted` with a dotted
  underline. External links get a small arrow glyph.
- Search palette: native `<dialog>`, results grouped by kind under a plural label ("Memories (4)"), arrow-key navigation;
  graph node rows name their file and show its path cut from the left.
- Tables: hairline rules, right-aligned tabular numbers, sortable headers with a visible sort indicator.
- Status chips: text label plus a shape (filled dot = done, ring = pending, triangle = warning); color reinforces only.
- Buttons (and links styled as `a.button`): one shape for the whole surface (6px radius, 1px line border); hover
  darkens the border, active fills with the line color; primary action in accent fill only for a confirm step.
- Target size (WCAG 2.2 2.5.8): nav items, tabs, breadcrumb links, buttons, selects and palette rows have a
  `min-block-size` of 24px (`--hit`); links in table cells and lists add 4px block padding; prose lines are >= 24px. A
  checkbox sits inside its label (`label.check`, one 24px pointer target) and is drawn at 18px.
- Error panel: a bordered panel with an amber triangle and the words, a plain reason, and two ways on (Retry, Go to
  Today).
- Every interactive element has default, hover, focus-visible (2px accent ring, 2px offset), active, disabled,
  loading states. Loading uses skeleton lines, not spinners in content.
- Wide diagrams (the harness architecture): drawn at their natural size inside a labelled, keyboard-focusable sideways
  scroller, so labels keep their 13px; "Fit to width" is an optional overview (a pressed-state toggle, same label in both
  states). Never shrink a diagram by default: fitting a 1962px drawing into a 703px column drew its labels under 5px.
- Empty states teach: say what will appear and how it gets there (e.g. "Memories appear here after mem_save").

## Motion

150-200 ms, ease-out-quart, for state changes only (hover, selection, dialog open, rail toggle). No page-load
choreography. `prefers-reduced-motion: reduce` turns transitions into instant changes.
