# gentle-lite

A small Claude Code harness in plain Node.js (>= 22) and Python 3.12, modelled on
[gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) (MIT). No compiled
programs, no npm dependencies for the core.

## Layout

```
bin/gentle-lite.js   CLI entry point
src/cli.js           command router
src/core/            marker injector, JSON merge, atomic writes, backups
src/install/         install / uninstall / status
assets/              vendored orchestrator, persona, skills, agents (see NOTICE)
python/              Python helpers and tests (stdlib only)
test/                node:test suites
odd/tasks/           feature documents
```

## Commands

```
gentle-lite --help
gentle-lite version
gentle-lite install   [--claude-home DIR] [--claude-json FILE] [--state-dir DIR] [--dry-run]
gentle-lite uninstall [same options]
gentle-lite status    [same options]
```

```
gentle-lite skill-registry refresh [--cwd DIR] [--quiet] [--no-gitignore] [--force]
gentle-lite skill-registry list    [--cwd DIR]
gentle-lite review assess [--cwd DIR] [--base-ref REF] [--committed-only] [--json]
#   --base-ref / MCP base_ref accept plain refs only (no leading '-', '..' ranges or whitespace)
#   and are resolved to a commit sha before any git diff
gentle-lite review mode   enable|disable|status [--scope global|clone] [--cwd DIR]
```

Hooks registered in `settings.json` run `node <repo>/bin/gentle-lite.js hook <name>` (absolute
path, no `PATH` dependency). They read the Claude Code hook JSON on stdin, always exit 0 and
fail open; an empty stdout is a no-op.

- `skill-registry` (UserPromptSubmit): refreshes `<project>/.atl/skill-registry.md` only for
  projects that opted in (an existing `.atl/` directory or `.atl/` in `.gitignore`; run
  `gentle-lite skill-registry refresh` once to opt in). Skips `/`, `$HOME`, directories without
  a project marker and a symlinked `.atl`. Home paths are written as `~/...`.
- `review-stop` (SessionStart/Stop): when receipt-driven development is on and this session
  produced a candidate that `review assess` marks as due, blocks the stop once per candidate.
  RDD is off by default; clone-local `off` (in `.git/gentle-lite-rdd-mode`) wins over global.

## Memory (Python, stdlib only)

`python/gentle_lite/memory/` is a small engram-compatible memory server: SQLite + FTS5 at
`<state-dir>/memory.db` (`GENTLE_LITE_STATE_DIR`, default `~/.gentle-lite`), WAL mode,
`PRAGMA user_version` migrations. `install` registers it as MCP server `engram` (so the vendored
prompts using `mcp__engram__*` work unchanged); if you already have a different `engram` entry it is
kept and ours is registered as `gentle-memory` (recorded as `memory_server_key` in `state.json`).
With the engram plugin enabled nothing is registered.

Tools: `mem_save` (same project+scope+`topic_key` updates and bumps the revision), `mem_update`,
`mem_search`, `mem_context`, `mem_get_observation`, `mem_session_start`, `mem_session_end`,
`mem_session_summary`, `mem_save_prompt`, `mem_current_project`. Search terms are quoted, so
FTS5 syntax in a query is plain text. No conflict/judgment machinery (deliberately simpler than engram).

```
PYTHONPATH=python python3 -m gentle_lite.memory serve
PYTHONPATH=python python3 -m gentle_lite.memory import-engram --from ~/.engram/engram.db   # read-only, idempotent
```

## Telemetry (local only)

`install` registers `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop` and `SubagentStop`
hooks that run `env PYTHONPATH=<repo>/python GENTLE_LITE_STATE_DIR=<state> python3 -P -m gentle_lite.telemetry hook`.
Each call appends one row to the `events` table of `memory.db`: time, session id, event, tool name,
cwd/project, payload size, ok flag. Prompt text and tool inputs/outputs are never stored, the hook
always exits 0 with empty stdout, and the package has no network code (a test enforces it).
`install --no-telemetry` skips the hooks (`state.json` records `telemetry: false`); `uninstall` removes them.

```
PYTHONPATH=python GENTLE_LITE_STATE_DIR=<state> python3 -P -m gentle_lite.telemetry report [--days N] [--json]
PYTHONPATH=python GENTLE_LITE_STATE_DIR=<state> python3 -P -m gentle_lite.telemetry prune --days N
```

If an event cannot be written (database locked, full disk) the hook still exits 0 silently but appends one byte to
`<state>/telemetry.dropped`; its size is the dropped-event count shown by `report` and the portal. Events older than
90 days (`GENTLE_LITE_TELEMETRY_RETENTION_DAYS`) are pruned automatically at most once per UTC day.

## Usage ingestion (local only)

With telemetry on, `install` also registers a `Stop` and `SubagentStop` hook (`python3 -P -m gentle_lite.usage hook`)
that reads the `transcript_path` of the payload and stores, per assistant message id (deduplicated), the model,
timestamps and token counts (input, output, cache read, cache write 5m/1h, thinking) in `usage_messages`, plus tool
names in `tool_calls` (Skill names, subagent types and MCP server names only; never prompt text or tool payloads).
Ingestion is incremental through `ingest_state` (byte offset; a shrunk or rewritten file is rescanned).

```
PYTHONPATH=python python3 -P -m gentle_lite.usage backfill [--claude-home ~/.claude]
```

## Control portal (read-only)

```
PYTHONPATH=python python3 -P -m gentle_lite.portal [--port 8765] [--claude-home DIR] [--engram-db FILE] [--repo DIR]...
```

`gentle-lite portal [--port N] [--repo DIR]...` starts the same thing from the CLI (it sets `PYTHONPATH` and the state dir).
Views: Overview (tokens per day stacked by input/output/cache read/cache write, model split, cache hit ratio, sessions
per day, dropped-telemetry counter, optional cost estimate), Usage (skills, tools, MCP servers/tools, subagent types;
sortable), Sessions (per project/session, project and date filters), Memories (own DB with FTS, engram DB read-only,
Claude file memories, graph memory of each `--repo`: stats, node search, neighbors), Harness (state.json, hooks, MCP servers, RDD mode, `odd/tasks` progress).
JSON API plus a single-page UI, stdlib only, no CDN. It binds `127.0.0.1` only (there is no host option), checks the
`Host` header against DNS rebinding, serves a strict CSP (no inline script or style) and opens every database with
`mode=ro` (never created, never migrated). The only write is the "Refresh usage" button, `POST /api/refresh`, which runs
the usage backfill and needs the per-process token embedded in the page plus a same-origin check. Hook command text and
MCP `args`/`env` of other tools are never exposed. Cost estimates stay off unless `<state>/prices.json` exists
(`{"models": {"<model>": {"input": N, "output": N, "cache_read": N, "cache_write": N}}}`, prices per million tokens; a missing key counts as 0, a non-numeric or negative value is reported under `invalid_prices` and that model is not costed).

## Safety: parameterized targets

Nothing is hardcoded to the real home. Every target can be redirected, and tests
only ever use temp directories:

| Option | Environment variable | Default |
| --- | --- | --- |
| `--claude-home` | `GENTLE_LITE_CLAUDE_HOME` | `~/.claude` |
| `--claude-json` | `GENTLE_LITE_CLAUDE_JSON` | `~/.claude.json` |
| `--state-dir` | `GENTLE_LITE_STATE_DIR` | `~/.gentle-lite` |

If only `--claude-home` is given, the other two default to paths inside it
(`<home>/.claude.json`, `<home>/.gentle-lite`), so a sandboxed install never touches the real home.

Every file is backed up under `<state-dir>/backups/<timestamp>/` before it is written.
Existing user content (CLAUDE.md text, hooks, MCP servers, `permissions.defaultMode`)
is preserved. `permissions.defaultMode` is never set or changed (upstream forces
`bypassPermissions`; gentle-lite deliberately does not), and the deny list is merged, not replaced.
Files gentle-lite installs are tracked by hash: if you edit one, re-install and uninstall keep your
version unless you pass `--force`.

## Tests

```
npm test            # node --test, then python unittest
npm run test:node
npm run test:py
```

## License

MIT. Vendored upstream assets are credited in [NOTICE](NOTICE).
