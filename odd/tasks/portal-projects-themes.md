# Feature: portal projects, skills wiki, themes and language

Locator: `odd/tasks/portal-projects-themes.md` (branch `feat/portal-projects-themes`, base `v0.2.0`). Engram mirror:
`odd/portal-projects-themes/tasks`.

## Objective

Fix the layout problems the user reported on v0.2.0 and extend the portal into a view of the harness and all of its
projects: a skills wiki that explains what every skill does, memory rows that open their wiki page, ODD tasks per
project, user themes (light/dark/custom files, editable in the portal) and an English/Spanish UI switch. Ship as
`v0.3.0` in one PR.

## Problem / evidence (user screenshots, 2026-10-16)

- Skill page right rail: values wrap one character per line ("20 / 26- / 09-..."); numbers and dates are raw
  (`319906`, `2026-09-20T01:44:09.739Z`).
- Built-in skills (e.g. `artifact-capabilities`) show "Installed: no" and no description.
- Memories list: clicking a title opens the old detail view instead of the wiki page.
- Diagrams: "No odd/tasks/*.md with tasks found (use --repo)": the launcher starts the portal without `--repo`, so it
  knows no project; graph memory is empty for the same reason.

## Scope

- P1 Layout and formatting: rail definition lists never wrap per character; localized number and date formatting
  everywhere (tables, meta, charts); audit every page for the same defect.
- P2 Skills wiki: `#/skill` catalog of every skill (installed, plugin, project `.claude/skills` of known projects,
  used-but-unlocatable built-ins) grouped by source, with description, trigger and usage; each skill page opens with a
  "What it does / When it triggers" summary, then the full SKILL.md; built-ins say plainly that Claude Code ships them
  with no local file.
- P3 Memory rows (amauta memory, Engram read-only, file memories) open their wiki page directly.
- P4 Projects: discovery from `--repo`, a config file (`~/.amauta/portal.json` `repos`), and opt-in auto-discovery of
  git roots from session working directories (existing dirs under `$HOME` only); `#/project` list and per-project pages
  with ODD features and progress, sessions, memories and graph status; Diagrams ODD per project; the launcher passes
  the configured repos; Settings can add/remove project paths (guarded write to `portal.json`). Graph empty state
  explains how to populate it. Remove the separate Diagrams page (user, 2026-10-16: it duplicates other pages):
  architecture moves to the Harness page, ODD progress to project/feature pages, graph to node pages; `#/diagrams`
  redirects to `#/harness`.
- P5 Themes: picker in the top bar (System / Light / Dark / custom); custom theme files `~/.amauta/themes/*.json`
  (name, base light|dark, validated token values from DESIGN.md only); in-portal editor with color inputs and live
  preview that saves/imports/exports theme files through a guarded endpoint (slug names, confined dir, schema).
  Viewer choice persisted in localStorage (fallback safe).
- P6 Language: English / Spanish UI switch for portal chrome (navigation, headings, labels, buttons, empty states,
  errors, settings descriptions); user content (memories, SKILL.md, ODD docs) stays as written. Neutral professional
  Spanish. Persisted like the theme; default from the browser language.
- P8 Harness wiki: pages for every harness component, not only skills: hooks (event, matcher, command, script
  summary), MCP servers (config without env values or secrets, plus their tools), MCP tools, connectors (claude.ai
  remote MCP seen in sessions), Claude Code built-in tools, agents and commands (frontmatter), plugins (manifest),
  output styles. Each page: "What it does / When it runs", source of the fact, usage, backlinks. Maintenance in three
  layers: (1) derived facts rebuilt on every request from the real files; (2) "Refresh descriptions" button: guarded
  POST that asks configured local stdio MCP servers for `tools/list` (read-only, timeout, no remote connectors, no env
  secrets logged) and caches the result under the state dir; (3) "Request explanation" button: guarded POST that
  enqueues a request in `<state>/wiki/requests.jsonl`; a shipped skill (`amauta-wiki-explain`) processes the queue in a
  Claude Code session and writes notes to `<state>/wiki/notes/<kind>/<id>.md` with the source hash; wiki lint flags
  notes whose source changed. Built-in tools ship with a curated EN/ES catalog. The portal never calls a model.
- P7 Docs, CHANGELOG 0.3.0, version bump, one PR to `main` (runs last).

## Constraints

Same as `portal-wiki.md`: Python stdlib, vanilla JS, DOM built with createElement/textContent, strict CSP, 127.0.0.1,
never write real `~/.claude`, `~/.claude.json`, `~/.amauta` in tests, English artifacts, Conventional Commits, no AI
attribution in commits, strict TDD (`npm test`).

## Tasks

- [x] P1 Rail/meta layout and localized number/date formatting across pages. `4e8cdf7` (route: delegated single writer; strict TDD, RED seen first, npm test exit 0, node 485 / python 549).
- [x] P2 Skills wiki catalog and skill page summary; built-in skills handled. `37aebfd` (delegated writer; exit 0, node 491 / python 559 tests incl. new files).
- [x] P3 Memory rows open their wiki pages (own, Engram, file memories). `efd7e45` (delegated writer; exit 0).
- [x] P4 Projects: discovery, project pages, ODD per project, launcher repos, Settings project paths, graph empty state, Diagrams page removed. `a9278fa` `d090621` `1e08ff4` (delegated writer; npm test exit 0, node 510 / python 591, re-run by orchestrator).
- [x] P5 Themes: picker, custom theme files, in-portal editor, guarded save/import/export. `ef0d28d` (server API + theme.js helpers; npm test exit 0, node 525 / python 609) `0c47f7f` (picker, editor, CSS; exit 0, node 548 / python 609). Route: delegated writer; strict TDD, RED seen first for each test file.
- [x] P6 English/Spanish UI switch. `c814217` (single commit, about 2200 lines because of the dictionaries; npm test exit 0, node 581 / python 614). Route: delegated writer; strict TDD, RED seen first.
- [x] P8 Harness wiki: hooks, MCP servers and tools, connectors, built-in tools, agents, commands, plugins, output styles; refresh and
  request-explanation flows. `b5466a6` (component discovery, masking, pages and catalog for hook/mcp/agent/command/plugin/outputstyle; exit 0, node 588 / python 651)
  `f32a95c` (built-in tool catalog EN/ES, MCP tools, connectors; exit 0, node 591 / python 667) `c27cd3b` (refresh descriptions from local stdio servers;
  exit 0, node 595 / python 686) `e313815` (explanation requests, notes, CLI, skill, stale-note lint; exit 0, node 604 / python 709). Route: delegated writer;
  strict TDD, tests first for each commit (RED seen as import errors / 404 / missing keys before the code was wired).
- [ ] P7 Docs, CHANGELOG, version 0.3.0, PR (last). Done: [x] polish fixes `3cfece0` (dates nowrap, es number grouping, paths with wbr, human hook titles, one import button), [x] CHANGELOG/UPGRADING/README/DESIGN/PRODUCT (docs commit), [x] version 0.3.0 (`chore(release)`); open: PR to `main` (orchestrator).

## Acceptance criteria

- No per-character wrapping at any width; numbers grouped, dates readable.
- Every skill the user has used or installed has a page that says what it does.
- Every hook, MCP server/tool, connector, built-in tool, agent, command and plugin has a page; refresh and
  request-explanation work from the portal without the portal calling a model.
- Clicking any memory opens its wiki page.
- The launcher-started portal shows ODD tasks for every configured project.
- Theme and language switch instantly, persist, and custom themes can be created in the portal.
- `npm test` exit 0 on every commit.

## Progress

- 2026-10-16: plan written from the user's report; branch created from `v0.2.0`.
- 2026-10-16: user asked to drop the Diagrams page; folded into P4 and sent to the running writer.
- 2026-10-16: wiki for hooks/MCP/connectors/tools/agents/commands proposed as a separate v0.4.0 feature (awaiting user).
- 2026-10-16: user chose one release: harness wiki added as P8 in v0.3.0; P7 runs last.

- 2026-10-16: scope change from the user applied in `a9278fa`: the Diagrams page and /api/diagrams are removed (`#/diagrams` redirects to Harness; ODD diagrams only on project and feature pages).
- 2026-10-16: P1-P4 done. Manual check on port 8799 with a temp state dir (copy of memory.db, portal.json listing this repo): /api/projects found 1 project (amauta: config + discovered, 3 features, 63 of 71 tasks, 1 session, 1 memory, graph not mirrored); project page, skill catalog (86 skills), built-in skill page, memory wiki page and memfile page all answered.

- 2026-10-16: P5 done. `GET /api/themes`, guarded `POST /api/themes` and `POST /api/themes/delete` (same guard, closed schema, slug-only paths, no symlinks, 50 theme cap, atomic writes). Top-bar picker (System, Light, Dark, custom) persists in localStorage with a safe fallback; the `#/themes` page edits name, base and the 14 DESIGN.md tokens with live preview, WCAG contrast warnings in words (ink and ink-muted below 4.5:1; accent below 3:1 so the focus ring stays visible), save, delete with confirmation, import and export. Diagram cards pin the light tokens so Mermaid stays readable under any theme. Manual check on port 8793 with a temp state dir: GET list, guarded POST 200, POST without token 403, invalid token value 400 with code `theme.value`, traversal slug 400, delete 200; server stopped.
- 2026-10-16: P6 done. `static/i18n.js` (en and es dictionaries, `t`, `tn`, `ts`). Server-provided chrome text stays English in Python and is translated by the client through an exact-text catalog (`srv`, `{x}` for variable parts; a Python test pins it against the strings in `python/amauta/portal`); user content is never translated. Switch re-renders the current route, sets `<html lang>`, persists in localStorage (safe fallback), default from `navigator.language`. Dates stay `YYYY-MM-DD`; numbers use the chosen locale. Also fixed a P4 defect found on the way: Settings > Projects passed `null` to `replaceChildren`, which a browser writes as the text "null".
- Not translated on purpose: Mermaid/archify diagram labels and session titles built by the server (for example "unknown project", "N messages"), which are generated data.

- 2026-10-17: P8 done. `#/component` catalog (139 components on the real Claude home: 19 hooks, 5 MCP servers, 41 MCP tools, 7 connectors, 34 built-in tools,
  20 agents, 11 commands, 1 plugin, 1 output style) and a page per component with "What it does / When it runs" and the source of each fact. MCP configs show
  type, command and masked arguments plus env and header NAMES only (`wikisecret.py`). `POST /api/harness/refresh` (same guard, closed schema, 1 KiB body)
  starts configured command-based servers only, 10 s per server, process group killed, cache in `<state>/wiki/mcp-tools.json`; `POST /api/harness/explain`
  queues `<state>/wiki/requests.jsonl`; shipped skill `amauta-wiki-explain` plus `python3 -P -m amauta.portal.wikiexplain list|write` write notes with the
  source hash; lint flags stale or orphaned notes. Manual check on port 8791 with a temp state dir (copy of memory.db), real Claude home read-only: no env
  value of any MCP server appears in any page, explain POST 403 without token and 200 with it (deduplicated), `list` then `write` then the page showing the
  note, lint reports the note after its hash is changed. Refresh was exercised only against the fake server in tests, never the real config.
- Behavior changes in existing tests (intentional): the tool, mcp and wiki-search tests now expect the harness `summary`, `explain`, `refresh` keys, the
  `mcptool` links and the catalog tools in search; the lint test expects seven categories.

- 2026-10-17: real-browser polish pass fixed in `3cfece0` (strict TDD, RED seen first: 8 new tests failed, then green). Root cause of the ungrouped `1766` was Intl in es (minimum grouping digits), not a missing server `fmt` hint; the server already marks numbers, and a new test pins every numeric meta value. P7: docs and version done; PR pending. npm test exit 0 (node 613 / python 712).

- 2026-10-17: orchestrator browser re-check (temp state, port 8766): dates whole, paths break at slashes, Spanish grouping; hook titles still showed `· [` for an extensionless quoted script and `in=$(cat);` for an inline snippet: fixed inline with TDD (RED seen) in `7e7fc03` and `04aff8b`. One unrelated flaky failure seen once in `test_graphify_lock` (stale-lock race, 0/15 on rerun, untouched by this branch; follow-up task suggested). Final npm test exit 0 (node 613 / python 714).

## Next step

Open PR to main; user merges; tag v0.3.0.
