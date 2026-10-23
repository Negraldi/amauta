# Feature: Codex runtime built on the Claude installer

Locator: `odd/tasks/codex-runtime.md` (branch `feat/codex-runtime` from `feat/graphify-hook-events` `2991ddc`, worktree
`~/amauta-codex`). Engram mirror: `odd/codex-runtime/tasks`.

## Objective

Claude Code and Codex share the same harness: the same memory (one memory.db, same visibility), the same MCP servers,
the same skills, the same hooks and the same always-on instructions. User decision 2026-10-22: start Codex support
again from the Claude implementation; the earlier dual-runtime branch (`feat/dual-runtime-migration`, `213dea8`, and its
trimmed copy `feat/dual-runtime-release`) is archived, not merged. Its v9 canonical identity split memories into two
partitions (Codex could not read Claude's memories); this design has no such split.

## Design

- One manifest, two targets. Every Claude asset maps to a Codex target with the same content:
  `~/.claude/CLAUDE.md` blocks -> `~/.codex/AGENTS.md` blocks; `settings.json` hooks -> `~/.codex/hooks.json` (same
  hook schema); `~/.claude.json` `mcpServers` -> `~/.codex/config.toml` `[mcp_servers.<same name>]`; `~/.claude/skills`
  -> `~/.agents/skills` (same set).
- Memory: same server (`engram` name, `python3 -P -m amauta.memory serve`), same label-based project semantics as
  Claude (v0.3.x). memory.db stays at user_version 9 on the user's machine; v0.3.x code ignores the extra columns and
  tables (checked: the migration loop is empty for 9 > 7).
- Parity tools: `amauta install --runtime codex|claude|both` (default both when Codex is present); MCP servers and
  personal skills that the user added to Claude are mirrored to Codex (skills by symlink, single source);
  `amauta status` compares both runtimes and lists differences.
- No master runtime (K2). Managed skills are rendered once into the amauta store `<state dir>/skills/<name>`; both
  `<claude home>/skills/<name>` and the Codex skills dir link to it. Personal skills stay where the user made them and the
  other runtime gets a symlink (never copied). MCP stdio servers sync both ways (3-way merge against a hashed base in
  `<state dir>/mcp-sync.json`; keys `command/args/env` map, others stay on their side; conflicts are reported, never
  overwritten). Unavoidable copies (config.toml tables, AGENTS.md blocks, hooks.json) are kept in step by `amauta sync` and
  a silent SessionStart `sync-check` that compares a source fingerprint (`<state dir>/sync.json`); `status` reports drift
  and a parity section. amauta-managed resources (engram, amauta, opt-in servers, blocks, hooks) stay one-way.
- Runtime tag: hooks and the memory server receive `AMAUTA_RUNTIME=claude|codex` so telemetry and sessions say where
  they came from; nothing else depends on it.

## Tasks

- [x] K1 Codex targets in the installer: AGENTS.md blocks, hooks.json, config.toml MCP (TOML writer with marked
  ownership), skills dir; install/uninstall/status/backup/restore exactly like Claude; tests with temp homes.
  Commits `4f21232` (targets, AGENTS.md, restore), `d55044e` (hooks.json, config.toml, `src/core/toml.js`), `ad81575`
  (skills, `--runtime` CLI, status per runtime, docs). Route: delegated writer. `npm test` exit 0: 679 Node + 759 Python.
- [x] K2 Parity and sharing: neutral skill store + links (incl. impeccable/archify, personal skills both ways), two-way
  3-way MCP sync, memory entry identical (runtime tag only), `amauta sync` + SessionStart `sync-check` + drift in status,
  parity section. Commits `b9635aa` (mirror + runtime tag), `7e7b47e` (store, links, MCP sync), plus the sync/parity
  commit `17d1aea`. Route: delegated writer. Memory visibility pinned by a Python test (it passed without code
  change: the server ignores AMAUTA_RUNTIME). The skill-store code was written before its tests (TDD deviation, tests
  added right after and a RED seen for the portal change); other parts RED first.
- [ ] K3 Codex usage: ingest `~/.codex/sessions` token usage into telemetry with `runtime=codex`; portal filters by
  runtime.
- [ ] K4 Switch the live machine: reinstall Claude from `~/amauta` (no path to `~/amauta-dev`), install Codex, retire
  `~/amauta-dev` and `~/amauta-dual`; real check (Codex reads Claude's "quipu", Claude reads Codex's "chasqui").
- [ ] K5 Docs, CHANGELOG, v0.4.0.

## Acceptance criteria

- A memory saved in one runtime is found by the other in the same project (real check).
- `amauta status` shows the same MCP servers, skills, hooks and instruction blocks for both runtimes.
- No config points to `~/amauta-dev` or `~/amauta-dual`.
- `npm test` exit 0 on every commit, RED seen first, no leaked temp dirs.

## Checks

TDD on (strict). Runner `npm test` in `~/amauta-codex`.

## Progress

- 2026-10-22: K1 done (3 commits above). Codex state in `<state dir>/codex-state.json`; ownership of MCP tables by recorded value (like Claude), no markers in TOML; hooks identified by command; `--json` keeps the Claude shape plus a `codex` key.
- 2026-10-22: plan written after the real check exposed the partition bug; R3a writer stopped; worktree created.

- 2026-10-23: K2 done (see the task line).

## Next step

K3 (Codex usage ingestion with runtime=codex). Open from K2: Codex-only install with impeccable does not run the npm engine; Codex has no SubagentStop event (the telemetry/usage hooks on it are written but never fire).
