# gentle-lite

A small Claude Code harness in plain Node.js and Python, modelled on
[gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) (MIT). No compiled
programs of our own, no npm dependencies and Python stdlib only for the core.

## Requirements

- Node.js >= 22 and Python >= 3.11 (`python3`; hooks and servers run it as `python3 -P`). Nothing to install.
- Optional, detected on `PATH` and never vendored: `codegraph` (npm `@colbymchenry/codegraph`) and `graphify`
  (PyPI `graphifyy`). `npx` is used by the opt-in `context7` and `rea` MCP entries.

## What `install` sets up

Into `~/.claude` / `~/.claude.json` / `~/.gentle-lite` (all redirectable, see Safety):

| Piece | Details |
| --- | --- |
| `CLAUDE.md` | four short blocks (orchestrator, persona, memory protocol, codegraph guidance; under a 20k-char budget that `status` checks) between `<!-- gentle-lite:ID -->` markers; your text is kept |
| Assets | output style, skills, agents (judgment-day, review lenses), rendered with model assignments |
| Hooks (all with a `timeout`) | `UserPromptSubmit` skill-registry, `SessionStart`/`Stop` review-stop, telemetry on 5 events, usage on `Stop`/`SubagentStop`, `codegraph prompt-hook` if codegraph exists, `PreToolUse(Agent)` preflight with `--with-sdd` |
| MCP servers | `engram` (our Python memory server; `gentle-memory` if you already have another `engram`), `gentle-lite` (Node: `skill_registry_refresh`, `review_assess`, `review_mode_status`, `odd_tasks_status`), `codegraph` (if installed) |
| Permissions | `ask`: `Bash(git push --force*)`, `Bash(git reset --hard*)`, `Bash(rm -rf*)` (prefix matches only, `rm -fr` or `sudo rm -rf` get past them). `deny` for `Read` and `Edit` of `.env`, `.env.*`, `~/.ssh/**`, `~/.aws/credentials`, `~/.config/gh/hosts.yml`, `*.pem`, `*.key`, `secrets/**`. No `defaultMode`, no allow entries |
| Optional | `--with-sdd` (SDD module), `--with-context7`, `--with-rea` (third-party MCP servers, off by default; choices are sticky until uninstall), `--no-telemetry` |

## Layout

```
bin/gentle-lite.js   CLI entry point
src/cli.js           command router
src/core/            marker injector, JSON merge, atomic writes, backups
src/install/         install / uninstall / status
assets/              vendored orchestrator, persona, skills, agents (see NOTICE)
python/gentle_lite/  memory (MCP server), telemetry, usage, portal, graph, sdd (stdlib only) + tests
src/mcp/             Node MCP server (`gentle-lite` entry)
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
gentle-lite portal    [--port N] [--repo DIR]...      # read-only control portal
gentle-lite codegraph init|status [--cwd DIR]
gentle-lite graphify hook install|uninstall [--cwd DIR]
gentle-lite graphify semantic [--cwd DIR] [--model M] [--timeout SECONDS]    # optional LLM pass, needs ANTHROPIC_API_KEY
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
- `review-stop` (SessionStart/Stop): when review is switched on and this session
  produced a candidate that `review assess` marks as due, blocks the stop once per candidate.
  The switch is off by default; clone-local `off` (in `.git/gentle-lite-rdd-mode`) wins over global. SessionStart keeps the
  baseline only for an explicit `resume`/`compact`; `startup`, `clear`, a missing or an unknown `source` start from the
  current state.

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

## Code graph tools (external, never vendored)

- **codegraph** (npm `@colbymchenry/codegraph`; the unscoped `codegraph` package is a different project).
  `install` registers the `codegraph` MCP entry (`codegraph serve --mcp`) and the `codegraph prompt-hook`
  UserPromptSubmit hook only when `codegraph` is on `PATH` and only if absent; an identical hook or an entry you
  already have is never duplicated, changed or removed. `gentle-lite status` prints an `[optional]` line with the
  install hint when it is missing. `gentle-lite codegraph init [--cwd DIR]` runs `codegraph init -y` there, refusing
  `$HOME`, `/`, temporary directories and directories without a project marker; `codegraph status` shows whether
  `.codegraph/` exists.
- **graphify** (PyPI `graphifyy`, Apache-2.0): `graphify-out/graph.json` stays the source of truth.
  `gentle-lite graphify hook install|uninstall [--cwd DIR] [--state-dir DIR]` manages a marked block in the repo's
  `post-commit` hook (`# >>> gentle-lite graphify >>>` ... `# <<< gentle-lite graphify <<<`; other content is kept and
  `core.hooksPath` is honoured). The block runs in a silent background subshell: `graphify update .` (only if `graphify`
  is on `PATH`, with `GRAPHIFY_QUERY_LOG_DISABLE=1`), then `python3 -P -m gentle_lite.graph sync --repo .`.
  A lock is taken over only when it is older than 15 minutes and its owner (pid file) is gone, with at most three attempts. The pid file also holds a start token (boot id and process start time from `/proc`), so a pid reused after SIGKILL or a reboot counts as gone; without `/proc` only `kill -0` decides;
  a trigger that finds the lock held leaves a `.pending` marker and re-tries the lock once, so a marker is never orphaned.
  The sync replaces the repo's rows in `graph_nodes`/`graph_edges`/`graph_sync` (memory.db schema v5) in one short
  transaction. Query: `python3 -P -m gentle_lite.graph query neighbors <node> [--depth N] --repo DIR` and
  `query path <a> <b> --repo DIR` (recursive CTEs, depth capped at 5 / 8; both answers carry `truncated` when the 20,000-row walk bound was hit, so a `found: false` with `truncated: true` is not a definitive "no path"); the memory MCP server exposes the same as the
  `graph_query` tool (it already owns the SQLite connection). The portal shows stats, node search and neighbors for each `--repo`, plus the SQL table count (non-file nodes of `*.sql` sources), whether a semantic pass is pending and the last semantic run (time and model).
  The `graphify-semantic` skill is the no-API-key alternative: the orchestrator runs `python3 -P -m gentle_lite.graph.semantic_plan plan|validate|merge` (graphify's APIs run in graphify's own interpreter, found from its shebang), dispatches one Haiku subagent per chunk of 20-25 documents in a single message, and merges the valid chunks through graphify's `build_from_json`/`to_json` (shrink guard honoured) before recording the sync with `claude-haiku-5-5`. It consumes the Claude plan's usage limits and asks before running on more than 3 chunks. The skill is installed with the other vendored skills (graphify itself stays optional; `plan` reports it clearly when missing).
  The hook never calls an LLM: after `graphify update .` it runs `graphify check-update .` (local, reads `graphify-out/needs_update`) and records the verdict; a failing check leaves the stored flag alone.
  `gentle-lite graphify semantic [--cwd DIR] [--model M] [--timeout SECONDS]` is the optional semantic pass: it runs `graphify extract <repo> --backend claude --model M` (default `claude-haiku-5-5`, or `GENTLE_LITE_GRAPHIFY_MODEL`; `GRAPHIFY_QUERY_LOG_DISABLE=1`) only when `ANTHROPIC_API_KEY` is set, otherwise it exits non-zero and says so. The key is inherited by that one graphify process only and is never printed, stored or logged; afterwards the graph is mirrored and the run recorded. It takes the same per-repo lock as the post-commit hook (and fails fast if a refresh is running), streams graphify's output, and kills graphify after the timeout (`--timeout` or `GENTLE_LITE_GRAPHIFY_TIMEOUT`, default 1800 s). The hook's pending verdict is the exact `[graphify check-update] Pending non-code changes` line of `graphify check-update`. `gentle-lite status` shows the graphify version, and `status --deep` also runs a one-table `.sql` fixture through `graphify update` in a temp dir to confirm the `[sql]` extractor.

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

## Safety model

- Hooks fail open (always exit 0, empty stdout = no-op) except the SDD preflight, which fails closed for `sdd-*` agents.
- Local only: no network code in telemetry/usage/portal; the portal binds `127.0.0.1` and opens databases read-only.
- User content is preserved (hooks, MCP servers, `permissions`, CLAUDE.md text); files are backed up before
  every write and edited managed files are left alone on uninstall unless `--force`.
- Deliberately absent (unlike gentle-ai): consent envelopes, review receipts/lineage, network telemetry, self-update.

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
`bypassPermissions`; gentle-lite deliberately does not); only the `ask` and `deny` rules above are appended (a rule you already list is never recorded as ours), and uninstall removes just the ones gentle-lite added. `deny_added` entries recorded by pre-T15 installs are never stripped on re-install or uninstall; `status` lists them as kept.
Files gentle-lite installs are tracked by hash: if you edit one, re-install and uninstall keep your
version unless you pass `--force`.

## Tests

```
npm test            # node --test, then python unittest
npm run test:node
npm run test:py
node --test test/e2e.test.js   # end-to-end only
```

`test/e2e.test.js` installs (`--with-sdd`, telemetry on) into a fake HOME seeded with user settings, `claude.json` and
`CLAUDE.md`, runs every registered hook command with `sh -c` and a JSON payload (as Claude Code does), starts the
`engram` and `gentle-lite` MCP servers from their `claude.json` entries (initialize, `tools/list`, one tool call), checks
the telemetry/usage rows in `memory.db`, fetches `/api/overview` from the portal on `127.0.0.1`, and finally uninstalls and
compares the files with their seeds. A fake `codegraph` on `PATH` enables the codegraph hook; nothing touches the real home
and nothing needs the network.

## License

MIT. Vendored upstream assets are credited in [NOTICE](NOTICE).

## Optional SDD module (`install --with-sdd`)

Spec-Driven Development from gentle-ai v3.4.0, installed only on request and removed by `uninstall`
(the choice is sticky across plain re-installs).

- Skills `sdd-*`, agents `sdd-*`, shared contracts and commands renamed to `/lite-sdd-*` (so they never
  collide with a gentle-ai install). Models come from the install state like the other agents.
- `python3 -P -m gentle_lite.sdd status [change] [--cwd DIR] [--json] [--instructions]` and `continue [change]` are
  read-only and reproduce the `gentle-ai.sdd-status` v2 projection over `openspec/changes/<change>/`
  (proposal, specs, design, tasks, apply-progress, verify-report). Only the `openspec` artifact store is supported:
  a declared `engram`/`hybrid` store is reported as blocked. A task that names a path outside the workspace blocks apply
  (`blocked(edit_authority_missing)`); mark read-only inputs with `(read-only)`. There is no consent or grant machinery.
- `python3 -P -m gentle_lite.sdd preflight-hook` is a `PreToolUse` hook for the `Agent` tool: an `sdd-*` subagent is
  dispatched only after the parent asked the three-question `AskUserQuestion` preflight (Interactive|Automatic,
  OpenSpec|Engram|Both, Ask me|Single PR|Auto) and the human answered it in the session transcript; the hook then
  prefixes the `## SDD Session Preflight` block to the prompt. The registered command is a small `sh` guard around the Python
  hook: it runs the hook under `timeout 20` (when `timeout(1)` exists) and prints the hook's output only if it succeeded.
  If `python3` is missing, the module cannot be imported, the hook crashes, exits non-zero or hangs, the guard discards any
  partial output and prints a PreToolUse deny decision, but only when the payload is an `sdd-*` dispatch; other agents
  stay silent (fail open). Residual gaps: no `sh` at all, or a hung hook on a system without `timeout(1)` (Claude Code
  then kills the shell at the 30 s hook timeout and treats it as a non-blocking hook error).
