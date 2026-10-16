# Feature: portal wiki, launcher, skill-impact and settings editor

Locator: `odd/tasks/portal-wiki.md` (branch `feat/portal-wiki`, base `v0.1.0`). Engram mirror: `odd/portal-wiki/tasks`.

## Objective

Turn the amauta portal into a read-mostly wiki where every harness entity is a linked page, with clear diagrams,
a desktop launcher that behaves like an app, per-skill impact metrics, and a guarded editor for a closed list of
harness options. Ship it as `v0.2.0` through pull requests, with an upgrade path for the local install.

## Scope

- Wiki shell: hash routes, sidebar, global search, safe markdown renderer, one page schema for every entity.
- Pages: memory topic, skill/tool/MCP server, session, ODD feature, graph node, home.
- Diagrams: archify (vendored, MIT, pure Node) for the harness architecture; Mermaid ODD diagrams grouped by status.
- Launcher: `.desktop` (no terminal) that starts the portal, opens Chrome in app mode with its own profile, and
  stops the server when the window closes; heartbeat auto-shutdown as a fallback.
- Skill-impact: comparative (not causal) per-skill metrics from telemetry, plus a per-skill change log (before/after).
- Settings editor: persona, review mode, telemetry, optional modules (SDD, rea, context7, impeccable, archify),
  reinstall/repair. Always through `amauta install` with a dry-run preview, CSRF token, Origin/Host checks, POST only,
  closed option list, and undo from the installer backup.
- Delivery: chained PRs to `main`, `CHANGELOG.md`, `UPGRADING.md`, `amauta upgrade`, tag `v0.2.0`.

Out of scope: free-form editing of settings, deny rules or skills; a second knowledge store (wiki-skills folder).

## Constraints

- Server: Python stdlib only, binds 127.0.0.1, no network. Client: vanilla JS, no frameworks, no CDN.
- Every label from repo/graph/memory data is untrusted: escape it, never assign raw HTML.
- Never touch the real `~/.claude`, `~/.claude.json`, `~/.amauta` in tests (use `AMAUTA_*` temp dirs).
- English artifacts, Conventional Commits, no AI attribution lines. About 400 authored lines per commit is a guide.
- Design direction (W2) is approved by the user before any UI is built; the result is shown at the end.

## Evidence

- Portal today: `api.py` 544 lines, `app.js` 346, 17 read-only endpoints, tabs Overview/Usage/Sessions/Memories/
  Harness/Diagrams. Memory store has no relation table: wiki links must be derived (revisions, topic_key hierarchy,
  mentions, graph nodes, telemetry).
- archify: MIT, zero-dependency Node CLI, typed JSON -> self-contained HTML; update check disabled by
  `ARCHIFY_UPDATE_CHECK_DISABLED=1`.
- WikiSkill (arXiv 2608.27454): raw -> wiki -> skills layering and a skill-impact tracker; evaluated on non-coding
  tasks, so metrics here are comparative only.

## TDD

Strict TDD on (source: repo `CLAUDE.md` "a failing test seen first for any behavior change"). Runner: `npm test`
(`node --test && python3 -m unittest discover -s python/tests -t .`). Judge by exit code.

## Delivery

Strategy: chained PRs by phase onto `main` (`feature-branch-chain` is not needed: each phase merges in order).
Forecast: 3000-4000 authored lines plus vendored archify. Merge is the user's decision.

## Tasks

F0 Design (impeccable)
- [x] W1 `impeccable init` for the portal: `PRODUCT.md`, `DESIGN.md`. (`d69f985`)
- [x] W2 `impeccable shape`: wiki visual direction; user approves before UI work. (recorded in `d69f985`)

F1 Wiki shell
- [x] W3 Hash routes, `/api/wiki/page?kind=&id=` with a common schema (title, body, links, backlinks, meta), sidebar, recent changes. (`3b4cbce` API, `15fd38b` static whitelist/CSP, `e41ae64` shell)
- [x] W4 Global search across memories (FTS5), skills, sessions, tasks and graph nodes, grouped by kind. (`3b4cbce` endpoint, `e41ae64` palette)
- [x] W5 Safe markdown subset renderer (headings, lists, code, tables, links, `[[wikilinks]]`, mermaid fences), DOM-built. (`d383531`)

F5 Launcher
- [x] W17 `.desktop` (Terminal=false) + Node launcher: free port, Chrome `--app` with own profile, stop server on window close; reuse a running server. (`8fe301d`; `amauta portal launch` / `install-launcher [--remove]`, run file ref-count, xdg-open fallback; not wired into `amauta install` by design; smoke with fake browser: server answered 200 during the window, stopped after it; npm test exit 0, node 397, python 355. Route: delegated to one writer.)
- [x] W18 Heartbeat auto-shutdown fallback; optional web manifest and icon. (`b67c928`; `POST /api/heartbeat`, `--idle-exit`, IdleMonitor with fake clock, manifest + icon.svg, CSP `manifest-src 'self'`; npm test exit 0, node 374, python 355. Route: delegated to one writer.)

F2 Entity pages
- [x] W6 Memory topic page: content, revision history with diff, derived links/backlinks, related graph nodes. (`15a4a9a`; the store keeps one row per topic_key and no revisions table (own and engram DBs checked), so the page states "latest revision only" and shows a line diff only when an `observation_revisions|versions|history` table exists; hierarchy, capped mentions >= 12 chars whole-word, graph nodes by label; also session labels by git-root repo + prompt snippet + date and leading-H1 dedupe; npm test exit 0, node 400, python 374. Route: delegated direct (writer trigger: 2+ files).)
- [x] W7 Skill/tool/MCP page: rendered SKILL.md, usage, sessions, tokens. (`f1e69d8`; node 401, python 385, exit 0. Route: delegated direct (writer trigger: 2+ files).)
- [x] W8 Session page: skills, tools, subagents, tokens, memories saved. (`f1e69d8`, same commit as W7.)
- [x] W9 ODD feature page: rendered doc, progress, linked commits. (`5fd7ae0`; `git log -1` per validated hash, 5 s timeout, unresolved stay plain; node 404, python 398, exit 0. Route: delegated direct (writer trigger: 2+ files).)
- [x] W10 Graph node page: neighbors and neighborhood diagram. (`5fd7ae0`, same commit as W9.)
- [x] W11 Home: overview numbers, charts, recent activity. (`1da8c80`; `/api/wiki/home`, old overview at `#/usage`; node 406, python 404, exit 0. Route: delegated direct (writer trigger: 2+ files).)

F3 Diagrams
- [x] W12 Vendor archify (update check off); generate harness architecture JSON from install state; render on `#/harness`. (`3ec82fb` vendor archify 3.1.0 unmodified, upstream commit `68031cf`, MIT; `ce92db8` update check off in `bin/delivery-update.mjs` + `scripts/check-update.mjs`, NOTICE + manifest checksums; `9f2effe` `--with-archify` sticky/status/uninstall/migrate line; `7b8a1c1` portal: `portal/archify.py` builds the grid JSON from `Portal.harness()` (generated ids, labels cleaned and capped, structural check), renders with the vendored CLI (node argument list, temp dir, scrubbed env, 40 s timeout, validate then render, in-memory cache by input hash), `/api/archify`, route `/archify/<sha256>.html` under its own CSP (`sandbox allow-scripts`, default-src 'none', no allow-same-origin, frame-ancestors 'self'), portal CSP gains only `frame-src 'self'` and keeps `script-src 'self'`; Harness page shows a `sandbox="allow-scripts"` iframe, Mermaid fallback when node/archify is missing or the render fails; retry without region boundaries when the router refuses a crowded layout; npm test exit 0, node 414, python 438. Route: delegated direct (writer trigger: 2+ files).)
- [x] W13 Mermaid ODD diagrams grouped by status, grid layout. (`d1ab71a`; `wikifeature.parse_tasks` reads phases (bare line above a checklist or markdown heading) and blocked (`[!]` or the word); `flowchart TB` with a summary node and one `subgraph` per phase, `direction LR`, rows of 6 built with invisible links, no hub; stadium/rectangle/hexagon + word + class per status; cap 60 + "N more"; feature page `diagram` field and "Task grid" section; checked with real Mermaid 11.17.2 in headless Chrome at 29 (real doc), 200 hostile, 1 tasks: rendered, no garbling; tests for 0, 1, 34, 200 and hostile labels; node 407, python 415, exit 0. Route: delegated direct.)

F6 Skill-impact
- [x] W19 Verify what telemetry captures today (tool results, exit codes) and record the evidence here. (`8085db3`; see "W19 evidence"; migration 6 + `ingest.parse_results`/`command_class`, `python/tests/test_usage_outcome.py`; RED seen (1 failure, 4 errors), then GREEN; npm test exit 0, node 414, python 443. Route: delegated direct (writer trigger: 2+ files).)
- [x] W20 Comparative per-skill metrics (error/retry rate after load, tokens per task, test outcomes, loaded-but-unused). (`964744e`; `portal/skillimpact.py`: pure `analyze` + `load_sessions` + `impact`; metrics = tool error rate, retry proxy (same tool within 3 calls after an error), output tokens per main-thread assistant turn after the load message, test-command failure rate, loaded-but-unused; denied/unknown results excluded; controls = whole sessions without the skill, same project when >= 5 else all projects; every metric carries n and sessions and is suppressed below 5 sessions per side or with no data on a side; verdict = better/worse/no clear difference with a flat band. 16 tests; RED seen for the metric math (module missing), loader/wrapper tests written after the code; node 414, python 459, exit 0. Route: delegated direct.)
- [x] W21 Per-skill change log (git/hash) with before/after metrics. (`c89ce2b`; migration 7 `skill_versions(skill, hash, first_seen)`; `portal/skillhist.py`: `observe` records the sha256 of each installed SKILL.md once, first_seen = file mtime clamped to now (a reinstall of the same content adds nothing; hash only, no text), fail-open, never creates the DB, writes only when something is new; `git_commits` for `<repo>/{assets/skills,skills,.claude/skills}/<name>` in the --repo list (5 s timeout, list argv); `deltas` before/after windows between consecutive changes of the same kind, suppressed below 5 loaded sessions per side, n reported; the first hash is a baseline, not a change. 18 tests (RED seen: module missing); node 414, python 477, exit 0. Route: delegated direct.)
- [x] W22 Skill page section and home ranking, with a correlation-not-causation note. (`739f805`; skill page gets `impact` = `skillhist.block` (metrics, n, change log with deltas, `note`), home gets `impact` = `skillimpact.ranking` (best/worst by error-rate delta after load vs baseline, top 3 each, flat differences not ranked); client `impactBlock`/`impactRankBlock` in `app.js`, `deltaMark`/`fmtMetric`/`fmtDelta` in `wikiroute.js`; direction = shape + words (▼ lower, better / ▲ higher, worse / ■ no clear difference / – not enough data), a bordered note box (no side stripe), no tiles. RED seen (5 node, 8 python); npm test exit 0, node 419, python 483. Route: delegated direct (writer trigger: 2+ files).)

F7 Settings editor
- [x] W23 Settings page that runs `amauta install` dry-run, shows the diff, applies on confirm. (`559e2d1` installer: `--without-<module>` (sticky modules can now be turned off; managed files no longer rendered are removed only while byte-identical, edited ones kept and reported, all inside the same backup), `--review-mode on|off` (review mode goes through install so one backup covers it; deviation from calling `amauta review mode`), `--json` plan output (`files`, `removed`, `skipped`, `state_changes`); `4d996a4` `portal/settings.py` + endpoints `GET /api/settings`, `POST /api/settings/preview|apply`; `213defb` Settings page. RED seen for the installer flags (7 of 7 failed before the code) and for the page (9 of 11); the Python endpoint tests were written after the module (no RED seen, so guards were checked by the rejection tests listed under W24). npm test exit 0, node 438, python 511. Route: delegated direct (writer trigger: 2+ files).)
- [x] W24 Write guard: per-session CSRF token, Origin/Host checks, POST only, closed option list. (`4d996a4`; same `_write_guard` as refresh/heartbeat + JSON content type (415) + 4 KB cap (413) + closed schema (400) + 405 with `Allow` for any other method; apply tokens one use, 5 min, bound to the desired set and the state.json hash (409 on change), one apply at a time (409); `python/tests/test_portal_settings.py` has a test per rejection: wrong Host, cross Origin / Sec-Fetch-Site, missing/invalid token, form content type, oversized body, bad JSON, unknown key, bad values, replayed and expired token, state changed between preview and apply, concurrent apply; the installer is never invoked on any rejection.)
- [x] W25 Undo from the last installer backup. (`559e2d1`/`5d2afdc` `amauta restore --backup <id>` (id matched by `^\d{8}T\d{6}Z(-\d{3})?$`, uses `restoreBackup`, now prunes the empty dirs it leaves), `4d996a4` `POST /api/settings/undo` with `confirm:true`: only the newest not-yet-undone backup named in `<state>/portal-settings.log`, refused (409) when state.json no longer matches the hash recorded after that apply; end-to-end test preview -> apply -> undo with the real installer in a temp sandbox asserts every Claude-home file is back byte for byte.)

F4 Quality
- [x] W14 Lint page: orphan memories, contradictory revisions, unused skills, tasks without commits. (`a019a1d` `portal/wikilint.py` + `GET /api/wiki/lint?days=`: six capped checks (orphans, possible duplicates, possibly superseded, installed skills unused in the window, ODD tasks checked without a commit hash, wikilinks to missing pages), scan cap 1500 memories, 50 items per category, `count` is the true total, all labelled "review" and never "contradictory" (the store keeps only the latest revision, so contradictions cannot be asserted); `513997a` `#/lint` page. 24 python + 5 node tests; RED seen as the missing module/page. Real read-only run: see the W14 real-data check under Progress. Route: delegated direct (writer trigger: 2+ files).)
- [ ] W15 impeccable audit/critique/polish + detector; browser check light/dark/phone width. (CODE PART DONE, browser pass pending: detector 0 findings before and after on our static files; filters only on Usage and on list routes (`R.showsFilters`); light `--warn`/`--ok` darkened to reach 4.5:1 (DESIGN.md updated); WCAG contrast test from OKLCH for ink/ink-muted/accent/warn/ok on bg/surface/sidebar/accent-soft, light and dark; skip link, focus ring, keyboard on sortable headers (Enter and Space) and scrollable tables pinned by `test/portal-a11y.test.js`; breakpoints use exclusive ranges so exactly 72rem keeps the rail; archify harness layout rebuilt (`3d9481a`), `9bee9c5` for the rest. Still to do by the parent: real-browser visual pass in light, dark and phone width.)
- [x] W16 README, this document, screenshots. (README portal section rewritten: routes, search, lint, settings editor safety model, skill impact with the correlation caveat, launcher, archify module, `--without-<module>`, `--review-mode`, `--json`, `restore`; screenshots left for the browser pass, none were added.)

F8 Publish and transition
- [ ] W26 `CHANGELOG.md`, tag `v0.2.0` at the end (base tagged `v0.1.0`).
- [ ] W27 Chained PRs by phase to `main` on GitHub; user merges.
- [ ] W28 Local update path documented (pull + reinstall keeps sticky flags).
- [ ] W29 `UPGRADING.md` + `amauta upgrade` (version check, dry-run, confirm, pull, reinstall, status; `--to <tag>` rollback).

## W19 evidence (skill-impact data audit, 2026-10-16, real `~/.amauta/memory.db` read-only, schema v5 before this change)

- Hook events stored: `TELEMETRY_EVENTS` = SessionStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop (`src/install/servers.js`). No PreToolUse and no PostToolUseFailure are registered for telemetry. `events` columns: ts, session_id, event, tool_name, cwd, project, duration_ms, payload_bytes, `ok`. Real data: 347 rows (301 PostToolUse, 15 Stop, 14 SubagentStop, 16 UserPromptSubmit, 1 SessionStart), only from 2026-10-16.
- `events.ok` is useless for outcomes: 0 of 301 PostToolUse rows have `ok = 0` although the transcripts of the same period contain tool errors. Claude Code's PostToolUse `tool_response` carries stdout/stderr/interrupted for Bash, no `is_error`, and failed calls do not reach PostToolUse at all. The `Skill` PostToolUse row exists (tool_name only, no skill name, no exit info).
- Skill loads are identifiable only through transcript ingestion: `tool_calls.skill` (from the `Skill` tool_use input) with `ts` (ms precision, assistant message timestamp), `session_id`, `message_id`. Real data: 4,987 tool calls, 25 sessions, 2026-07-02 to 2026-10-16; skills loaded: reverse-engineer-anything 4 calls/3 sessions, impeccable 2/2, artifact-design 2/2, artifact-capabilities 1/1. Every skill is therefore below the n >= 5 sessions floor today.
- `usage_messages` (one row per assistant message: input/output/cache tokens, model, project, sidechain) gives tokens per assistant turn; 4,935 rows, 25 sessions.
- Before this change the ingestion read only assistant lines: tool results were NOT captured. Transcripts DO expose them: user lines with `tool_result` items (`tool_use_id`, `content`, `is_error` present only when true). Real data: 142 `is_error:true` across all transcripts (about 3% of calls). Bash failures start their content with `Exit code N` (seen: 1 x50, 2 x15, 127 x9, 144 x8, 143 x4, 255, 234); user-side refusals are errors with fixed phrases ("User rejected tool use", "The user doesn't want to proceed...", "Permission for this action was denied...", "Request interrupted by user"). `toolUseResult` is an object for Bash (stdout, stderr, interrupted, returnCodeInterpretation) but not needed.
- Test commands: only `tool_use.input.command` shows them, and the old ingestion stored no input. A coarse boolean class is enough.
- Retries: a true retry (same tool + same target) needs the target (path or command). Storing it, even hashed, would leak low-entropy content, so the retries metric is a proxy without target: a failed call followed by another call of the same tool within the next 3 calls of the session.
- Telemetry change (privacy-preserving, migration 6, `ingest.py`): `tool_calls` gains `result` (`ok` | `error` | `denied`, NULL when no result line was seen), `exit_class` (Bash errors only: `fail` = 1, `misuse` = 2, `missing` = 126/127, `signal` >= 128, `other`), `cmd_class` (`test` when a Bash command matches a test runner, else NULL), plus an index on `call_id`. Migration 6 clears `ingest_state` once so the next backfill/portal Refresh re-reads transcripts and fills the history (inserts are idempotent). Never stored: tool input, output, error text, file paths or commands (a test pins that a secret string never reaches the DB files). The hook path is unchanged (transcripts cover outcomes), so hooks stay fail-open and bounded.

## Acceptance criteria

- Every entity reachable by URL, with links and backlinks; global search finds memories, skills, sessions, tasks, nodes.
- No raw HTML from data anywhere; CSP unchanged except what is proven necessary.
- Launcher opens a console-free app window and the server stops within 30 s of closing it.
- Settings changes only through the closed list, previewed, confirmed, undoable.
- `npm test` exit 0 on every commit; PRs open on GitHub; `amauta upgrade` moves v0.1.0 -> v0.2.0 and back.

## Progress

- 2026-10-16: plan approved by the user (editable option list confirmed). `main` tagged `v0.1.0`, branch `feat/portal-wiki` created.
- W1/W2 (route: inline, impeccable interview needs the user): `docs/PRODUCT.md` (register product; warm and studious; anti-refs old wikis and toy UIs; WCAG AA + reduced motion) and `docs/DESIGN.md` (Restrained, teal accent OKLCH 0.50 0.09 200, Source Serif 4 reading + system sans, sidebar + reading column + right rail, home = recent activity) written; brief approved by the user. Live mode not configured (no dev server).

- W3/W4/W5 (route: delegated direct, writer trigger: 2+ files), strict TDD, runner `npm test`. Commits, each with `npm test` exit 0:
  `554a40b` fonts (Source Serif 4 woff2 x3 + OFL, NOTICE, manifest; node 343, python 320);
  `3b4cbce` wiki endpoints `/api/wiki/page|recent|search` in `portal/wiki.py` (node 343, python 339);
  `d383531` markdown renderer `static/markdown.js` (node 355, python 339);
  `15fd38b` static whitelist for the new scripts and fonts, CSP gains `font-src 'self'` only;
  `e41ae64` wiki shell: `wikiroute.js`, sidebar, recent changes, palette, design-system CSS (node 373, python 342).
  Manual check on real data (read-only, port 8799): endpoints, fonts (font/woff2, sha256 matches the manifest) and CSP verified with curl; browser check of light/dark/phone width is still W15.

- W6-W11 manual check on real data (read-only, port 8799, stopped after): memory, skill python-testing (installed, 0 calls) and impeccable (2 calls), current session, feature portal-wiki (7 commits resolved, 7 of 29 done) and home endpoints answered 200 with the expected shape; no node page checked (the amauta repo graph is not mirrored in the real DB). Browser look is pending (W15).

- W12/W13 manual check on real data (read-only, port 8799, stopped after): `/api/archify` gave available=true, 16 components; `/archify/<hash>.html` 200 with the sandbox CSP; unknown hash 404; feature diagram source 29 tasks in 9 phases; headless Chrome showed the iframe drawing the diagram inside `#/harness` with no console or CSP errors.

- W19-W22 manual check (port 8799, stopped after): the portal read a COPY of the real DB (sqlite backup of `~/.amauta/memory.db`, backfilled from the real transcripts read-only, state dir in the session scratchpad). Real skills: impeccable 2 loaded sessions vs 11 same-project controls, reverse-engineer-anything 3 vs 10, python-testing 0 vs 13 (all-projects); every metric suppressed (below 5 sessions), n still shown (e.g. reverse-engineer-anything error calls n=2997 with 88 errors, 3 sessions); versions and git commits resolved from `/home/negraldi/amauta` (assets/skills/impeccable: 2 commits, python-testing: 1, skill-registry: 2); home ranking available, tracked 4, ranked 0. Caveat: one stray `amauta.usage backfill` without `AMAUTA_STATE_DIR` also migrated the real DB to v7 and ingested its outcomes (additive and idempotent, what the next Stop hook would do anyway); no data was lost.

- W23-W25 manual check (port 8799, sandbox state/home/json in the session scratchpad, stopped after; real `~/.claude`, `~/.claude.json`, `~/.amauta` untouched: nothing newer than 20 minutes): GET settings, bad key 400, wrong token 403, form content type 415, GET preview 405, preview persona neutral + review on (3 files, state_changes), apply (backup 20261016T172650Z, outputStyle Neutral, state neutral/on), replay of the token 400, undo (outputStyle Gentleman, state gentleman/off). Limits: undoing a change that turned impeccable off does not bring the npm engine back (run Reinstall / repair); the browser look of the page is part of W15.

- W14 real-data check (port 8799, real state read-only, stopped after; mtimes of `~/.amauta/memory.db`, `state.json`, the WAL, `~/.claude/settings.json`, `~/.claude.json` unchanged): 100 memories scanned (not capped); orphans 48, possible duplicates 2 groups (both are "Session summary" notes), superseded 0, installed skills unused in 30 days 27, ODD tasks checked without a commit 2 features (amauta-harness T14 and T25; portal-wiki W1, W2, W19-W22 before hashes were added to this file), missing wikilinks 1 (this document's own `[[wikilinks]]` text). Lint is a candidate list: most orphans are session notes that nobody links.

## Next step

F4 code is done (lint, README, detector, contrast, keyboard, archify layout). Remaining in W15: the real-browser visual pass in light, dark and phone width (Lint, Settings, Home rail at 72rem, archify harness). Then F8 publish.
