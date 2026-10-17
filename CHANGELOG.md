# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [0.3.1] - 2026-10-17

### Added

- Project paths in `<state>/portal.json` and in Settings may live outside `$HOME` (for example `/mnt/datos/...`). They must be absolute, existing and resolved; `/`, `$HOME` itself and system trees (`/proc`, `/sys`, `/dev`, `/run`, `/etc`, `/usr`, `/bin`, `/sbin`, `/lib*`, `/boot`, `/var`, `/tmp`, `/snap`, `/root`) are refused. Auto-discovery still looks only inside `$HOME`.
- Components of plugins disabled in `enabledPlugins` (hooks, MCP servers and tools, agents, commands, skills, output styles) are labelled "Plugin disabled: does not run" in pages and catalogs.

### Fixed

- "Refresh descriptions" failed with "response too large" for MCP servers with large tool lists (rea, 170 tools). Limits are now 16 MB per line, 32 MB per response and 500 tools; the cache still keeps only names, capped descriptions and parameter names.
- `npm test` failed once `~/.amauta/portal.json` listed projects: two portal spawn tests read the real state directory. They no longer do.
- The test suite left its temporary directories in `/tmp` (about 2,000 directories and 630 MB over three days); they are now removed when each test process exits.

## [0.3.0] - 2026-10-17

### Added

- Skills wiki: `#/skill` lists every skill (installed, plugin, project `.claude/skills` of known projects, and built into Claude Code), grouped by source and filterable. Each skill page opens with "What it does" and "When it triggers", then the full `SKILL.md`; built-in skills say plainly that Claude Code ships them with no local file.
- Memory rows (own store, Engram read-only, file memories) open their wiki page directly.
- Projects: discovery from `--repo`, from the `repos` listed in `<state>/portal.json` (`{"repos": [...], "auto_discover": true}`) and, while `auto_discover` is on, from the git roots of your session working directories (existing directories under `$HOME` only). `#/project` lists them and each project page shows its ODD features with progress, sessions, memories and graph status, with a how-to when graph memory is empty. Settings gained a Projects section that adds and removes project paths through a guarded write to `portal.json`. `amauta portal launch` now forwards the configured repos.
- Themes: a top-bar picker (System, Light, Dark and your own themes), custom theme files in `<state>/themes/*.json` (name, base, validated color tokens only) and an in-portal editor at `#/themes` with live preview, WCAG contrast warnings in words, save, delete, import and export. The theme files API (`GET /api/themes`, guarded `POST /api/themes` and `/api/themes/delete`) is confined to the themes directory.
- English and Spanish UI: a top-bar language switch for the portal chrome (navigation, headings, labels, buttons, empty states, errors, settings descriptions). The default follows the browser language and the choice is remembered. Memories, `SKILL.md` and ODD documents stay as written; dates are always `YYYY-MM-DD`.
- Harness wiki (`#/component` and one page per component): hooks, MCP servers, MCP tools, connectors seen in sessions, Claude Code built-in tools (curated English and Spanish catalog), agents, commands, plugins and output styles. Each page says what it does and when it runs and names the source of each fact; MCP configs show env and header names only, never values.
- Refresh descriptions (`POST /api/harness/refresh`): asks configured local stdio MCP servers for `tools/list` (read-only, 10 s timeout per server, no remote connectors) and caches the result under the state directory.
- Explanation requests (`POST /api/harness/explain`) queue a request in `<state>/wiki/requests.jsonl`; the new `amauta-wiki-explain` skill processes the queue in a Claude Code session and writes notes with the hash of their source. The portal never calls a model. The lint gained a "Stale explanations" check (seven checks in total).

### Changed

- Numbers are grouped in the language of the UI and dates and date-times are always `YYYY-MM-DD` and `YYYY-MM-DD HH:MM` everywhere (tables, rails, charts, lists), never raw ISO strings.
- The architecture diagram stays on the Harness page and ODD progress lives on project and feature pages.
- Hook pages are titled `<Event> (matcher) · <name>` (curated amauta name, else the script file name, else the first command word) instead of a raw command prefix; the full masked command stays on the page.
- Theme import is one "Import theme file" button that opens a visually hidden file input.

### Fixed

- Skill page rail: values no longer wrap one character per line; numbers and dates are formatted.
- Dates never break inside the token (sidebar "Recent changes", table cells and rails keep `YYYY-MM-DD` and the time together).
- Four-digit numbers are grouped in Spanish (`1.766`); the browser's Intl skips the separator for those by default.
- File paths in the rail break only after a slash, never in the middle of a word.
- Built-in skills no longer show "Installed: no" with no description.
- The launcher-started portal knows your projects, so ODD tasks and graph memory are no longer empty.
- Settings > Projects no longer shows the text "null" after a reload.

### Removed

- The separate Diagrams page and `GET /api/diagrams`: it duplicated other pages. `#/diagrams` redirects to `#/harness`.

## [0.2.0] - 2026-10-16

### Added

- Wiki portal: hash-routed pages for memories, skills, tools, MCP servers, sessions, ODD features and graph nodes, with links and backlinks, a recent-changes rail, a home page with spending and harness health, a safe Markdown renderer (wikilinks, Mermaid fences, no raw HTML) and the Source Serif 4 reading font (OFL-1.1, vendored).
- Global search (Ctrl+K) across memories, skills, sessions, tasks and graph nodes.
- Lint page: orphan notes, possible duplicates, possibly superseded notes, unused skills, ODD tasks checked without a commit, and links to missing pages. All findings are review candidates, never verdicts.
- Skill impact: per-skill change log (installed `SKILL.md` hashes and git commits) and a comparative effect on tool outcomes, with small-sample suppression and an explicit correlation caveat. Usage ingestion records outcome classes (ok, error, denied, exit class, test-command flag) without storing any content (telemetry schema v7, additive).
- Desktop launcher: `amauta portal --app`, `amauta portal install-launcher`, heartbeat and idle exit so the server stops after the app window closes, web app manifest and icon.
- Settings editor: change persona, review mode and optional modules from the portal through a closed option list, with a dry-run preview, a one-time apply token, double confirmation, a backup and a preview-then-confirm undo. Write guard: per-session CSRF token, Origin/Host checks, size and content-type limits.
- Settings editor security review follow-up: undo re-runs the installer with the logged previous values instead of restoring snapshots, the installer runs in its own process group and is killed on timeout, previews are capped, and `managed_files` keys and backup manifest entries outside the install scope are rejected.
- Optional archify skill (`install --with-archify`, vendored unmodified apart from a disabled update check; see `NOTICE`) and a Harness page architecture diagram drawn by it in a sandboxed iframe under its own CSP, with a Mermaid fallback.
- Optional impeccable design skill checks used for the portal design pass (WCAG contrast test, keyboard access, skip link, detector with no findings).
- New CLI flags: `install --without-<module>`, `install --review-mode on|off`, `install --json`, `restore --backup <id>`.
- `amauta upgrade [--to <tag>] [--dry-run] [--yes]`: moves a local install to the latest release tag (or another tag) and reinstalls. See `UPGRADING.md`.

### Changed

- Portal layout: sidebar, reading column and right rail, light and dark themes, filters only where they apply.
- The portal CSP gained `font-src 'self'` and `frame-src 'self'` only; scripts stay `'self'`.

## [0.1.0] - 2026-10-16

### Added

- Initial public release: a small Claude Code harness in plain Node.js and stdlib Python. Idempotent `install`, `status` and `uninstall` with backups, marker-delimited CLAUDE.md blocks, JSON merge into `settings.json` and `~/.claude.json`, output styles, skills, agents and permission rules.
- Hooks (fail open): skill registry, review Stop reminder, telemetry, usage ingestion.
- Memory MCP server with SQLite storage, local telemetry and usage ingestion, `review assess`, graph tools (codegraph, graphify) and the optional SDD module.
- Local control portal with read-only views of memory, skills, usage and the harness.
