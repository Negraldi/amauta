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

- [ ] P1 Rail/meta layout and localized number/date formatting across pages.
- [ ] P2 Skills wiki catalog and skill page summary; built-in skills handled.
- [ ] P3 Memory rows open their wiki pages (own, Engram, file memories).
- [ ] P4 Projects: discovery, project pages, ODD per project, launcher repos, Settings project paths, graph empty state, Diagrams page removed.
- [ ] P5 Themes: picker, custom theme files, in-portal editor, guarded save/import/export.
- [ ] P6 English/Spanish UI switch.
- [ ] P8 Harness wiki: hooks, MCP servers and tools, connectors, built-in tools, agents, commands, plugins, output
  styles; refresh and request-explanation flows.
- [ ] P7 Docs, CHANGELOG, version 0.3.0, PR (last).

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

## Next step

P1-P3 writer.
