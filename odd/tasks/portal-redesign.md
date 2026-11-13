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
- [x] T7 Settings: preferences, projects and siblings, appearance (themes, language)
- [x] T8 Visual pass: tokens, type, states, dark-aware diagrams; impeccable audit and polish
- [x] T9 Docs: docs/portal.md routes table, DESIGN.md, CHANGELOG
- [x] T10 Runtime-agnostic harness wiki (user, 2026-11-13: "the harness must be agnostic, Claude or Codex"): neutral copy where a claim holds for both runtimes; Overview and Catalog also inventory the Codex target (instruction blocks, hooks, MCP servers, skill links) with a runtime marker per entry
- [ ] T11 Critique follow-ups (user, 2026-11-13: "complete the impeccable critique"): confirm on Remove, graph default view, one name per page, one tab vocabulary, P3 items; then a re-critique
- [x] T12 Memory keeps its spaces (user, 2026-11-13): mem_save refuses bodies whose spaces were stripped and tells the agent to resend; Memory > Quality flags the ones already stored; POSIX-only leftovers in settings.py

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

- 2026-11-12 T6 e04dcec (route: delegated writer). #/harness leads with one health sentence ("amauta 0.9.1 is installed; 38
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

- 2026-11-13 T7 157423f (route: delegated writer; commit "feat(portal): settings with preferences, projects and appearance tabs"). #/settings is one page with three tabs in ?tab= (R.SETTINGS_TABS,
  R.settingsTab; preferences is the default and never written): Preferences (options grouped under Behavior, Hooks and
  privacy, Optional modules; the "changed, was X" mark is ink-muted, not accent; preview/apply/undo unchanged with inline
  status/alert), Projects and siblings (saved paths + auto-discover and a siblings table with Remove, one shared
  /api/projects fetch, a teaching empty state, a failure shows the tab error panel with Retry), Appearance (theme editor
  as an h2 section plus a language select #set-lang). Tab bodies load inside tabPanel (skeleton, error + Retry).
  #/themes redirects to #/settings?tab=appearance (MOVED_LISTS); there never was a #/siblings route. Breadcrumb Settings /
  <tab>. The Display popover's Edit themes link points to ?tab=appearance. The settings nav tabs and the themes kind left
  wikiroute.js (397 lines). RED first (test/portal-settings-tabs.test.js 13/13 failing), then GREEN: portal node 407/407,
  simplicity green (page-settings long lines 28 -> 25). Changed expectations: NAV settings has no tabs; #/themes crumbs end
  in set.tab.appearance; projects and siblings settings tests boot ?tab=projects; the theme tabs test checks the redirect
  and the Appearance tab link; i18n DYNAMIC allows set.tab.*; dead keys sib.none, sp.pathLabel, kind.themes removed.

- 2026-11-13 T8 fix part (route: delegated writer; T8 stays open for the audit and re-critique). Per item:
  (1) C1: markdown.js splitRow copies a closed `code` span or [[wikilink]] whole, so its | no longer splits a cell; every
  #/guide table checked in the browser (no raw [[ ]], every row has the header's cell count).
  (2) C5: counts that can be one go through tn() (skills calls/sessions in the catalog, graph nodes/edges/SQL tables,
  schedule minutes/hours, archify components, lint memories, preview minutes, catalog intro); memory types (memtype.*)
  and redaction kinds (redact.*) shown with labels through app.js enumLabel (unknown values as sent); the home feed
  groups the digits the server writes ("11.356 mensajes"); Spanish on/off are "en uso"/"fuera de uso", option values
  "Sí"/"No" (help texts too), "plugin fuera de uso"; kind.harness/nav.harnessPage "Resumen del harness", kind.lint
  "Calidad de la memoria" (en "Memory quality"); tú -> usted in three Spanish texts.
  (3) progress bars use --ok; a running pipeline step uses --c-input. (4) data tokens retuned (DESIGN.md, style.css,
  theme.js BASES): light cache-read 0.60 0.035 250, cache-write 0.55 0.13 310; dark input 0.74 0.11 275, cache-read
  0.60 0.03 250, cache-write 0.66 0.14 310; all >= 3:1 on bg and surface, >= 0.11 apart in OKLab (test-pinned).
  (5) filter state: one nowrap span per part, .page-head row-gap. (6) the guide article is .prose (serif, measure
  var(--measure) = 68ch). (7) .archify-frame and .sr-only (merged into .visually-hidden) removed; no other dead class.
  (8) the harness health sentence counts skills + catalog groups like the Catalog; skills failing only drops them.
  (9) siblings table: "cuts/ACTIVE (at most 35 days old)" when max_age_days is set. (10) Mermaid gets the current
  tokens as hex (darkMode from bg), server classDef colors are mapped to tokens client-side, diagrams redraw on a theme
  or OS scheme change; .diagram uses page tokens. (11) links in p/li/dd/td get 3px inline padding (24px hit area, no
  layout shift); the auto-discover checkbox sits in a 24px label; browser-measured: no standalone target under 24px on
  the main pages at 1280px. (12) sweep at 1280px and 375px (dark and light): no page overflow.
  RED first (test/portal-visual-pass.test.js 16/16 + 1 classDef test, markdown C1 1/1), then GREEN.
  Changed expectations: harness health counts skills (6 components; Spanish "fuera de uso"); Spanish settings values
  "fuera de uso"; project memories show "Decision"; security shows "National ID (cédula)"; i18n DYNAMIC allows memtype/
  redact; a11y diagram test now checks the card uses page tokens (the light pin is gone); shell test token values.
  Not fixed (server text, out of scope): session titles "<model>, N messages" are composed in English by wikisess.label;
  graph node kinds (graphify) and pipeline modes (user-defined) stay raw; diagrams.py _STYLE comment still says white card.

- 2026-11-13 T8 polish round (route: delegated writer). Independent re-critique: 29/40 (target >= 32, no P1). Per letter:
  a done: phone menu closes on Esc and on a scrim tap (focus back to Menu, aria-expanded kept), and on navigation as before.
  b done: app.js scrollBox(); the skill impact table and the home spending tables sit in scroll boxes (every page table now
  does). c done: ::placeholder is --ink-muted at opacity 1 (measured 6.41:1 light, 8.29:1 dark on --surface). d done:
  --line-strong = color-mix(in oklch, var(--ink-muted) 70%, var(--bg)) for inputs, selects, textareas and buttons; not a 15th
  table token; measured 3.54:1 bg / 3.30:1 surface light, 4.25 / 4.05 dark (native checkboxes keep the browser's border).
  e done: Run is a plain button, the accent fill only on "Run now". f done: steps in declared order, "stage N" in words when
  steps run side by side, "(not in this mode)" instead of a strike-through. g skipped: the server sends the day keys (UTC
  SQL), out of scope. h done: pages without item pages turn an extra path into the not-found panel (wikiroute NO_ITEMS).
  j done: title (with lead), then tabs, on every tabbed page; Tools and skills dropped the h2 repeating the segment; lint
  uses pageHead. k done: origins read "added with --repo / saved in Settings / found in your sessions"; Msgs -> Messages;
  SKILL.md rail keys labelled (meta.*), true/false -> yes/no, an argument hint breaks after each "|"; guide crumb ends with
  the page title; a page titled "amauta" gets "Project amauta - amauta"; ODD percents through Intl (fmtPercent digits);
  the Appearance help points to Display in the top bar; path placeholders translated. l done: saved paths are a two-column
  table. m done: Home leads with the harness health sentence linked to #/harness (the rail health block is gone). n done:
  Esc/backdrop return focus to the search button, rows no longer repeat the group label, a "Pages" group from R.NAV.
  o done: .scroll is sideways only (no 75vh inner scrollers). p done: netError()/errorNote() wrap network and part
  failures in translated text with the raw reason as detail. P3: phone top bar one row (51px), hub/page tabs one
  scrolling row, memory list newest first, memory file sizes in B/KB/MB; skipped: home session link text (the title is
  composed by the server) and the graph filter for vendored/minified nodes (not cheap without API fields).
  Palette code moved from app.js to boot.js (app.js 346 lines). RED first: test/portal-t8-polish.test.js 18/18 failing,
  then GREEN. Changed expectations: nav tabs come after the header; DAG test checks declared order and stages; buttons use
  --line-strong; palette rows start with the title; home health is the lead sentence; settings tests find the siblings
  table by content (saved paths are a table too); "found in your sessions"; Spanish percent "62 %" via Intl; i18n DYNAMIC
  allows meta.*; dead keys home.agents, home.harnessDetails, home.health removed. Browser: 375px and 1280px, dark and
  light, no page overflow (incl. #/skill/impeccable), no nested vertical scrollers, menu closes by Esc and scrim.
- 2026-11-13 T9 (route: delegated writer). docs/portal.md: shell section (grouped sidebar, breadcrumb, Ctrl+K Pages group, Display
  popover, phone menu), routes table (group, page, hash, tabs and query, content) and legacy-hash redirect table checked against
  wikiroute.js (R.NAV, LEGACY, ACTIVITY_TABS, MOVED_LISTS, PROJECT_TABS, SETTINGS_TABS, SEGMENTS, CATALOG_KINDS); stale
  sections renamed (Quality, Settings tabs, siblings in Settings > Projects and siblings). DESIGN.md: phone scrim, page-head
  pattern, Home rail, --ok for progress. CHANGELOG entry under Unreleased. Guide pages (en and es: portal, extras, pipelines,
  siblings) updated for the new navigation and labels.
- 2026-11-13 T8 final polish (route: delegated writer; T8 stays open). Second independent re-critique: 30/40, no P1 (target
  >= 32). Per number: 1 done: Home page head (h1 + health lead) above a .page.home grid whose rail comes first in the DOM
  (right column when wide via grid-column/row, above the feed under 72rem); the feed shows 5 days, Show more adds 5 and moves
  focus to the first new day. 2 done: server diagram labels translated client-side before Mermaid draws (app.js
  localizedSource: a quoted label the srv catalog knows is swapped, entity codes decoded and re-encoded, any other label
  left byte for byte; 30 catalog entries, a Python test checks every fixed label of odd_progress and workflow); "1 call"
  (wikiusage.calls, used by wikiusage and wiki search); session titles re-composed client-side (sessionTitle: "<model>,
  N messages" in the UI language, digits grouped; link(), palette rows and the session h1); memtype labels for project,
  user, feedback, manual, tool_use, file_change, file_read, command, search, prompt; palette groups plural sentence case;
  "Instalación de amauta"; graph.semantic split into two sentences; per-kind not-found titles (notfound.<kind>, "Memoria no
  encontrada"); "Ajustes" -> "Configuración" (sec.lead, nav.group.foot, guide pages); guide/es: arnés -> harness, tú ->
  usted throughout, "Tu directorio de Claude" -> "Su"; hooks table shows "amauta hooks" with the matcher as a muted detail.
  3 done: memory, memory files, quality (prompts + scope as one lead) and settings have a lead; the Activity filter-state
  line is gone (the filter bar says it); no kind label above item titles (breadcrumb names it). 4 done: node rows "title ·
  basename", path cut from the left (36 chars), same title + file collapsed, group count adjusted (boot.js nodeRows).
  5 done: api.py LOCAL_DAY = date(ts, 'localtime') for the daily keys and the from/to/days range (only _range and the
  overview daily query); Home spending windows (wikihome) and per-item usage sparklines (wikiusage._daily) still use UTC
  substr: left, outside the usage chart. 6 done: .rail-link 24px. 7 done: dark palette backdrop and phone scrim
  oklch(0 0 0 / .55). 8 done: menu open focuses the first nav link, #view, search, #topbar-end and #filters get inert;
  closing (Esc, scrim, navigation, widening past 52rem) restores. 9 done: phone bottom-sheet rule and comment removed
  (popover under Display). 10 done: boot.js knownTab + readRoute replaceState for an unknown or foreign ?tab=. 11 done:
  stage glued with no-break spaces inside the step label; in-mode steps ink, off-mode muted. 12 done: a cut front-matter
  value ends at a word with an ellipsis (server). 13 left as is. 14: server attribution, not a client bug (hub tab: all
  time, only messages with u.project = name, model = max of those rows; #/session: the chosen range, max(project)); the hub
  tab's sentence now says so. 15 done: DESIGN.md 3.54/3.30 light, 4.25/4.05 dark.
  RED first: test/portal-final-polish.test.js 19/19 failing (then the guide and dictionary register tests 1/1 each), Python
  6 failing (local day, two diagram-label catalog tests, ellipsis, "1 call" x2). GREEN: portal node 464/464, simplicity/
  odd-format/architecture 10/10 (page-wiki long lines 46 -> 45), Python portal tests OK. Changed expectations: "1 calls" ->
  "1 call" (wiki usage, wiki search); filter-state tests replaced by "the head does not repeat the filter bar"; hooks row
  "amauta Bash"; emoji test allows U+2713 (the done mark in diagram labels); top bar ids include topbar-end; stage regex
  accepts the no-break space; Home status sits in the page head; "A semantic pass is pending."; not-found titles; palette
  groups "Skills (1)", "Memories (2)"; i18n DYNAMIC allows notfound.*. Browser (dev server :8790, static only) at 1100,
  1280 and 375 px, light and dark: no page overflow, head order h1/lead/tabs, rail above the feed at 1100 and right at
  1280, menu focus/inert, popover under Display, unknown tabs normalized. The dev server needs a restart for the Python
  changes (local usage days, "1 call", ellipsis).
- 2026-11-13 T10 (route: delegated writer; strict TDD, node --test + python3 -P -m unittest). Commits: a1ad440 (part 0:
  Codex home order AMAUTA_CODEX_HOME > <custom claude home>/.codex > CODEX_HOME > ~/.codex in Node and Python, empty
  values unset, portal build_config, Windows default interpreter `python`), c6d45e5 (part A: Settings passes --codex-home
  and --codex-skills-dir when a Codex home exists, sandbox rule pinned, Codex plan/backup shown, codex_backup logged),
  d3d1508 (part B: wikicodex.py, runtimes per catalog entry and skill, Runtime meta row, Overview runtimes table,
  Security Codex panel), 80e3250 (part C: copy). RED seen per part: paths-codex/platform 2 failing; test_paths 4; settings
  codex 3; settings UI 2; wiki codex 7 + i18n 1; security codex 2; codex UI 3. GREEN: portal node 469/469, ratchet 10/10,
  checks 5/5 (LANG=C), install/codex/paths/hooks suites 189/189, Python portal 510 OK, paths/usage/memory OK. Not covered:
  instruction blocks are on the Overview, not catalog entries (a new kind would grow wikiroute.js past 400); no runtime
  filter; Codex-only MCP servers are not probed by Refresh descriptions; Windows behavior unverified on a Windows machine.
- 2026-11-13 T12 (route: delegated writer; strict TDD, python3 -P -m unittest). Detector memory/spacing.py (pure): judged
  only with >= 80 Latin letters after removing fenced/inline code and URLs, exempt when >= 20% of letters are CJK/Thai/
  kana/Hangul; flagged when letters per space-separated word >= 12 AND >= 15% of letters sit in lowercase runs >= 16.
  Server refuses mem_save, mem_update, mem_save_prompt, mem_session_summary, mem_session_end ("the text has almost no
  spaces; send it again as normal prose with spaces between words"); one sentence in the mem_save description, no
  instruction-block text. Lint category "unspaced" (en + srv-es). settings.py: oscompat.kill_tree and child_env (platform
  injected). RED: spacing 1 error (missing module), server 2 failures, lint 2 failures + 2 errors, i18n 1, oscompat 5
  errors. GREEN: test_mem* 34 OK, test_portal* OK, oscompat OK, node 1018/1018, ratchet 10/10.

### T8 close and T10 verification (coordinator, 2026-11-13)

- Final independent impeccable re-critique: 30/40, no P0 or P1 (baseline 25/40; rounds 29, 30, 30). The 32/40 target
  set by the coordinator was not reached. Measured: 0 contrast failures in light and dark, 0 overflow at 375px, no
  absolute ban present.
- Coordinator re-ran after T10 (d063754): Node full suite 1018/1018 with LANG=C, portal suites 469/469, structure
  10/10, Python test_p*.py 654 with the one known pre-existing failure (test_pipelines DeclaredScheduleTest).
- Live check against real data: Overview lists Claude Code and Codex (both installed), Catalog marks 5 hooks and 5 MCP
  servers as shared and 1 MCP server as Codex only; no page overflow at 1024, 800 or 375px.
- Not a portal defect: memory bodies shown without spaces are stored that way (151 of the latest 200, one project,
  one Codex session); the memory guard keeps spaces.

## Next step

All tasks checked. Push and PR are the owner's decision. Open follow-ups, none started:
- Critique P2: one-click "Remove" in Settings > Projects and siblings has no confirm or undo; the graph table opens on
  vendored minified symbols; three names for the home page (Today / Home / Recent activity); three tab styles.
- Settings > Appearance has no theme picker (only the Display popover).
- T10 leftovers: personal-skill links have no copy fallback where symlinks fail; `os.killpg` in settings.py is
  POSIX-only and ENV_KEEP drops USERPROFILE and SYSTEMROOT; nothing was run on a real Windows machine.
- Memory: flag or refuse bodies saved without spaces (Memory > Quality lint, mem_save warning).
