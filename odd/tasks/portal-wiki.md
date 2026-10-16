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
- [x] W1 `impeccable init` for the portal: `PRODUCT.md`, `DESIGN.md`.
- [x] W2 `impeccable shape`: wiki visual direction; user approves before UI work.

F1 Wiki shell
- [ ] W3 Hash routes, `/api/wiki/page?kind=&id=` with a common schema (title, body, links, backlinks, meta), sidebar, recent changes.
- [ ] W4 Global search across memories (FTS5), skills, sessions, tasks and graph nodes, grouped by kind.
- [ ] W5 Safe markdown subset renderer (headings, lists, code, tables, links, `[[wikilinks]]`, mermaid fences), DOM-built.

F5 Launcher
- [ ] W17 `.desktop` (Terminal=false) + Node launcher: free port, Chrome `--app` with own profile, stop server on window close; reuse a running server.
- [ ] W18 Heartbeat auto-shutdown fallback; optional web manifest and icon.

F2 Entity pages
- [ ] W6 Memory topic page: content, revision history with diff, derived links/backlinks, related graph nodes.
- [ ] W7 Skill/tool/MCP page: rendered SKILL.md, usage, sessions, tokens.
- [ ] W8 Session page: skills, tools, subagents, tokens, memories saved.
- [ ] W9 ODD feature page: rendered doc, progress, linked commits.
- [ ] W10 Graph node page: neighbors and neighborhood diagram.
- [ ] W11 Home: overview numbers, charts, recent activity.

F3 Diagrams
- [ ] W12 Vendor archify (update check off); generate harness architecture JSON from install state; render on `#/harness`.
- [ ] W13 Mermaid ODD diagrams grouped by status, grid layout.

F6 Skill-impact
- [ ] W19 Verify what telemetry captures today (tool results, exit codes) and record the evidence here.
- [ ] W20 Comparative per-skill metrics (error/retry rate after load, tokens per task, test outcomes, loaded-but-unused).
- [ ] W21 Per-skill change log (git/hash) with before/after metrics.
- [ ] W22 Skill page section and home ranking, with a correlation-not-causation note.

F7 Settings editor
- [ ] W23 Settings page that runs `amauta install` dry-run, shows the diff, applies on confirm.
- [ ] W24 Write guard: per-session CSRF token, Origin/Host checks, POST only, closed option list.
- [ ] W25 Undo from the last installer backup.

F4 Quality
- [ ] W14 Lint page: orphan memories, contradictory revisions, unused skills, tasks without commits.
- [ ] W15 impeccable audit/critique/polish + detector; browser check light/dark/phone width.
- [ ] W16 README, this document, screenshots.

F8 Publish and transition
- [ ] W26 `CHANGELOG.md`, tag `v0.2.0` at the end (base tagged `v0.1.0`).
- [ ] W27 Chained PRs by phase to `main` on GitHub; user merges.
- [ ] W28 Local update path documented (pull + reinstall keeps sticky flags).
- [ ] W29 `UPGRADING.md` + `amauta upgrade` (version check, dry-run, confirm, pull, reinstall, status; `--to <tag>` rollback).

## Acceptance criteria

- Every entity reachable by URL, with links and backlinks; global search finds memories, skills, sessions, tasks, nodes.
- No raw HTML from data anywhere; CSP unchanged except what is proven necessary.
- Launcher opens a console-free app window and the server stops within 30 s of closing it.
- Settings changes only through the closed list, previewed, confirmed, undoable.
- `npm test` exit 0 on every commit; PRs open on GitHub; `amauta upgrade` moves v0.1.0 -> v0.2.0 and back.

## Progress

- 2026-10-16: plan approved by the user (editable option list confirmed). `main` tagged `v0.1.0`, branch `feat/portal-wiki` created.
- W1/W2 (route: inline, impeccable interview needs the user): `docs/PRODUCT.md` (register product; warm and studious; anti-refs old wikis and toy UIs; WCAG AA + reduced motion) and `docs/DESIGN.md` (Restrained, teal accent OKLCH 0.50 0.09 200, Source Serif 4 reading + system sans, sidebar + reading column + right rail, home = recent activity) written; brief approved by the user. Live mode not configured (no dev server).

## Next step

F1 W3: wiki shell (routes, page schema, sidebar).
