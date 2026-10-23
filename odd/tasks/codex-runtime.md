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
- Runtime tag: hooks and the memory server receive `AMAUTA_RUNTIME=claude|codex` so telemetry and sessions say where
  they came from; nothing else depends on it.

## Tasks

- [x] K1 Codex targets in the installer: AGENTS.md blocks, hooks.json, config.toml MCP (TOML writer with marked
  ownership), skills dir; install/uninstall/status/backup/restore exactly like Claude; tests with temp homes.
  Commits `4f21232` (targets, AGENTS.md, restore), `d55044e` (hooks.json, config.toml, `src/core/toml.js`), `ad81575`
  (skills, `--runtime` CLI, status per runtime, docs). Route: delegated writer. `npm test` exit 0: 679 Node + 759 Python.
- [ ] K2 Parity: mirror the user's other MCP servers and personal skills from Claude to Codex; `status` diff.
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

## Next step

K2 (parity: mirror other MCP servers and personal skills, `status` diff).
