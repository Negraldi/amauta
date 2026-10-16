# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [0.2.0] - unreleased

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
