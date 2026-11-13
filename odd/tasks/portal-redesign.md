# Feature: Portal redesign

## Objective

Rebuild the portal UI (python/amauta/portal/static) with a job-based information architecture and a fresh
visual pass under impeccable, keeping the stdlib server, CSP, static allowlist, i18n and no-dependency rules.

Scope: static/ (index.html, app.js, wikiroute.js, page-*.js, style.css, i18n json), the static allowlist in server.py,
portal tests that assert on navigation, docs/portal.md, docs/DESIGN.md. Out of scope: API endpoints and data model.

TDD: on. Runners: `npm test` (node:test, portal UI tests) and `PYTHONPATH=python python3 -m pytest python/tests -q -k portal`.

## Tasks

- [x] T0 Shape: inventory, IA proposal (archify sitemap), design brief confirmed by the user
- [x] T1 Routing core: new hub map, breadcrumbs, legacy-hash redirects, filters scoped to Activity (tests first)
- [x] T2 Shell + identity tokens (moved from T8: DESIGN.md table, style.css, theme.js BASES change together): grouped sidebar, top bar (breadcrumb, search, theme quick toggle, refresh), sidebar footer cleanup
- [x] T3 Project hub: project page tabs (overview, features, graph, pipelines, sessions, memories)
- [x] T4 Knowledge: memory tabs (memories, files, quality), single graph page, segment state in the hash
- [x] T5 Activity: usage, sessions, one tools-and-skills table
- [x] T6 Harness wiki: overview, unified catalog, security (group label "Harness wiki", informative, not Knowledge)
- [ ] T7 Settings: preferences, projects and siblings, appearance (themes, language)
- [ ] T8 Visual pass: tokens, type, states, dark-aware diagrams; impeccable audit and polish
- [ ] T9 Docs: docs/portal.md routes table, DESIGN.md, CHANGELOG

## Acceptance criteria

- Every current route still resolves (old hashes redirect), every page reachable from the sidebar in at most two clicks.
- Item pages show a breadcrumb to their hub; no feature is rendered in two places.
- Node and Python portal tests green; CSP and allowlist unchanged except new static files.
- WCAG 2.2 AA contrast, keyboard navigation, reduced motion; light and dark checked in the browser.

## Baseline critique (impeccable, 2026-11-09, 25/40)

Snapshot: .impeccable/critique/2026-11-09T07-16-23Z__python-amauta-portal-static.md. Must be fixed by the redesign:
- C1 guide tables: wikilink `|` inside table cells (markdown.js splitRow) -> T8 harden.
- C2 usage chart: input/output first, cache behind a toggle, continuous date axis, accessible per-day values -> T5.
- C3 harness overview: one-line health, readable diagram (natural size, scroller), hooks table with handler and status -> T6.
- C4 target size >= 24px for links, nav and table rows (WCAG 2.2 2.5.8) -> T2/T8.
- C5 one date and number format everywhere, plurals via tn, enums mapped to labels, Harness/Lint translated -> T8.
- C6 search palette closes on first Esc and on route change; graph nodes ranked/capped -> T2.
- C7 error panel with a next step instead of raw err.message -> T2.
Target after redesign: >= 32/40, no P1.

## Decisions (user, 2026-11-09)

- IA confirmed: Today; Work; Knowledge; Activity; Harness wiki; foot Guide and Settings.
- New visual identity: cochineal-red accent (~oklch(0.50 0.15 22)), indigo second color for data only, pure neutral
  surfaces (white / chroma-0 near-black), monospace system font for titles and numbers, system sans for UI, vendored
  Source Serif 4 for long prose only. Errors stay amber with icon and text; red is links, selection and focus only.
  No new fonts or libraries.
- Scope: T1-T9 production-ready, one commit per task on feat/portal-redesign; push and PR stay with the user.
- Baseline impeccable critique of the current portal runs before T1 (two isolated assessments).

## Progress

- 2026-11-09 T0: worktree ~/amauta-portal-redesign on feat/portal-redesign from origin/main 304fc34. Inventory done
  (Explore mapper, delegated: 19 static files, 4k lines). Route: inline for planning, writers delegated per task.
- 2026-11-09 T1 committed e65cf63 (verified by coordinator: portal node suites 331/331, LANG=C checks green, no .py touched; route: delegated writer) (delegated writer). Navigation model as data in wikiroute.js (R.NAV, hubOf, tabOf, crumbs,
  redirectOf, routeHash, usageSegment); app.js renders the grouped sidebar, breadcrumb, tabs and an error panel with
  Retry / Go to Today; old hashes rewritten with replaceState; ?seg= drives Tools and skills; palette closes on Esc and
  on route change; Memory no longer reads the hidden Project filter. RED seen first (test/portal-nav.test.js, 14/15
  failing), then GREEN: portal node suites 331/331, Python portal tests 492 OK (`-t .`), simplicity ratchet green.

- 2026-11-09 T2 (route: delegated writer). "Andean ledger" tokens in DESIGN.md, style.css and theme.js BASES (pure
  neutral surfaces, cochineal accent 22 for links/selection/focus, indigo/ochre/slate/violet data); titles, brand and
  figures in the system mono (600, -0.02em, balance), Source Serif 4 only in .prose. Shell: sidebar = brand + groups
  (sentence-case muted labels, current item tint + accent + 600, foot pinned under a hairline); recent list and pickers
  removed from the sidebar; top bar = Menu, search, status, Refresh, Display ([popover] with theme, Edit themes,
  language; bottom sheet on phones; closes on route change). Breadcrumb with CSS separators, underline tabs, one
  button shape (a.button too), error panel with an amber triangle, 24px targets (`--hit`), toast on --z-toast.
  Status colors kept off the selection tint and the sidebar layer (approved light warn is 4.50:1 on --sidebar; the run
  console moved to --surface). RED first (test/portal-shell.test.js 11/11 failing), then GREEN: portal node 341/341,
  Python portal 492 OK, npm test node 895/895 (Python: only the known date-dependent test_pipelines failure).

- 2026-11-09 T2 verified by coordinator (portal 341/341). Fix: light --warn 0.55 -> 0.535 so it reaches 4.5:1 on every
  surface (it was 4.4998 on --sidebar, 4.45 on --accent-soft); the strict a11y contrast test is restored, not relaxed.

- 2026-11-09 T3 (route: delegated writer). #/project/<name> is a hub with ?tab= (overview default, never written;
  R.PROJECT_TABS, R.projectTab, R.TAB_KEYS); crumbs Work / Projects / <name> (/ tab). Features (#/feature/p/n) and graph
  nodes (#/node/repo::id) crumb through the hub (?tab=features / ?tab=graph) and light Projects in the sidebar. Overview:
  plural-aware summary (tn), ODD progress, graph freshness with Sync now / Connect, rail with Path, Found by and backlinks
  only (Links list and per-kind lists removed). Features (/api/odd filtered, bar + label, task diagrams), Graph
  (graphRepo for this repo, link to #/node), Pipelines (/api/pipelines filtered by path or name), Sessions (/api/sessions
  ?project=, shared sessionColumns in app.js), Memories (/api/memories?project=); each tab has skeleton, teaching empty
  state and an error panel with Retry. #/project is a table: name, ODD progress bar, graph chip (dot/ring + text), last
  activity (YYYY-MM-DD from the newest session); siblings below in compact cards. RED first (test/portal-project-hub
  .test.js 20/21 failing), then GREEN: portal node 362/362, Python portal 492 OK, simplicity green (baseline shrank).
  Changed expectations: feature crumb hash now ?tab=features; the list no longer shows session counts (summary moved to
  the hub); graph chip text "Mirrored <date>"/"Not mirrored"; i18n number test uses the ODD figures.

- 2026-11-09 T3 38b2f94 verified by coordinator (portal 362/362, browser: hub tabs, crumbs, plurals). T8 note: progress
  bars use --accent; move to --ok / data color (accent is links, selection, focus only).

- 2026-11-09 T4 (route: delegated writer). #/memory: the Own/Engram switch is a pair of links (aria-current="true"), the
  store lives in ?source=engram; search filters as you type (200 ms debounce, Enter at once, no Search button, stale
  answers dropped); teaching empty state (mem_save). The graph panel and the memory-files table left the memory page.
  #/memfile shows only the memory-files table (count sentence, teaching empty state). #/lint is titled "Memory quality"
  with one lead sentence (review prompts, never verdicts). #/node is the one cross-repo explorer: repo picker (choice kept
  in state for the session), then that repo's search, neighbours and diagram (graphExplorer replaces graphifyPanel).
  Palette (C6): R.rankResults puts graph nodes after every other kind and caps them at 5 (R.NODE_SEARCH_CAP). style.css
  split: page components (impact, settings, theme editor, pipelines, guide) moved to style-pages.css (index.html link,
  server.py STATIC_FILES entry). RED first (test/portal-knowledge.test.js 9/9 failing), then GREEN: portal node 371/371,
  Python portal 492 OK, simplicity green (baseline shrank). Changed expectations: memory source and graph tests moved to
  links / #/node; the failing-search test presses Enter; CSS tests read both stylesheets.

- 2026-11-09 T5 (route: delegated writer). #/usage leads with one "You spent ..." sentence (plus "Estimated cost" when
  prices are on); the chart moved out of app.js into page-activity.js: input and output by default, cache read/write
  behind a visible "Include cache" checkbox (state kept for the session), continuous date axis (fillDays, empty days as
  zero columns), marks in a stretching SVG with 1px surface gaps, axis labels as HTML at 12px (also at 375px), hover
  title per day, and a "Values per day" details/summary table in date order. Data colors are the --c-* tokens only.
  #/session uses app.js sessionColumns(); the projects table that silently set the filter is gone (the Project filter is
  the one control). #/tool is titled "Tools and skills"; the segments are links (aria-current="true") in a nav, state in
  ?seg=. Activity page heads show the filters in words ("30 days · all projects · all runtimes"). RED first
  (test/portal-activity.test.js 7/7 failing), then GREEN: portal node 378/378, simplicity green (baseline shrank).
  Changed expectations: the usage lead sentence text; the ?seg= test checks links with aria-current instead of buttons.
  Dataviz validator on the data tokens: light input/output pass; cache read (slate, C 0.02) fails the chroma floor and
  is 2.66:1 on white (relieved by the per-day table), and the dark steps sit outside the validator's lightness band
  (L 0.72-0.80): retune in T8 if wanted (DESIGN.md table and theme.js BASES change together).

- 2026-11-12 T6 (route: delegated writer). #/harness leads with one health sentence ("amauta 0.9.1 is installed; 38
  components, 2 need attention (plugin disabled).", tn plurals, from /api/harness + /api/harness/components; without the
  catalog just "amauta X is installed."), install facts as a dl (version, review mode, telemetry as chips, persona,
  modules, managed files; no cards), the Mermaid session flow behind "Show architecture diagram" in a focusable
  role=region sideways scroller drawn at its viewBox width (diagramBox(..., natural)); archify stays one link. Hooks
  table: Event, Handler (catalog title "<event> (<matcher>) · <name>" -> "name (matcher)", links to the hook page),
  Source, Status (● runs / ○ plugin disabled); fallback to /api/harness hooks. The MCP table and the install
  component list left the overview (the catalog has them). #/component is the one Catalog (skills from /api/skills as a
  "Skills" group, kind links with counts in ?kind=<any catalog kind> via R.CATALOG_KINDS, text filter, All view caps a
  kind at 8 with "Show all <kind> (n)", Refresh descriptions after the filter box; only one list failing shows the
  other plus the error panel). viewSkillCatalog/viewComponents removed. Catalog item pages (incl. mcp and tool items)
  crumb Harness wiki / Catalog / <kind> (#/component?kind=) / <page title>. Item pages: the "Source of these facts"
  section and the rail Source row are dropped when What it does names the source; Command moves to a wrapped code
  block in the main column; explain.none invites a request. #/security: one sentence (on/total protections, found/total
  checkers), protection chips, yes/no chips in the checker table. document.title follows the first h1 on every page.
  RED first (test/portal-harness-wiki.test.js 16/16 failing), then GREEN: portal node 394/394, Python portal 492 OK,
  simplicity green (baseline shrank), npm test node 948/948 (Python: only the known test_pipelines failure).
  Changed expectations: mcp/tool item pages hub to Catalog (tabOf null); item crumbs have the kind crumb; Security
  "privacy hook is off" sentence -> chip; hook page no longer repeats "Source of these facts"; skills-ui tests read the
  unified catalog (one "Skills (n)" group, "No component matches"); i18n DYNAMIC allows catalog.kind.*; dead keys removed.
  Browser (temp fixture server on :8797, the :8790 dev server was not answering): harness, catalog, ?kind=skill, skill
  and hook items, security in light/dark and 375px: no page overflow, no console errors.

## Next step

T7 Settings: preferences, projects and siblings, appearance (themes, language). Carry-overs: restart the dev server on
:8790 (it was down during T6); the health sentence counts harness components only (the catalog total also has skills);
T8: progress bars on --accent, data token chroma/lightness per the dataviz validator, filter-state wraps under the title
on narrow content widths, .archify-frame CSS is now unused, the Spanish status words (activado/desactivado) are
gendered in other places.
