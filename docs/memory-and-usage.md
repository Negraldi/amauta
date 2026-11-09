# Memory, code graph, telemetry and usage

Local stores and the external code graph tools; nothing here uses the network.

## Memory (Python, stdlib only)

`python/amauta/memory/` is a small engram-compatible memory server: SQLite + FTS5 at
`<state-dir>/memory.db` (`AMAUTA_STATE_DIR`, default `~/.amauta`), WAL mode,
`PRAGMA user_version` migrations. `install` registers it as MCP server `engram` (so the vendored
prompts using `mcp__engram__*` work unchanged); if you already have a different `engram` entry it is
kept and ours is registered as `amauta-memory` (recorded as `memory_server_key` in `state.json`).

Memory guard (always on, ADR 0007): every title, content, prompt and session summary the store writes passes through
`python/amauta/memory/guard.py`. Secret-like text (API keys, bearer tokens, private keys, cloud keys, `password=...`)
is refused with the fixed reply `rejected: secret-like content` and nothing is written. Personal identifiers (cedula,
RUC, cards, IBAN, phones, e-mail) are replaced by `[REDACTED_<KIND>]`; the tool reply says how many of each kind, never
which. Memories imported from an existing engram database keep their text as it was.
With the engram plugin enabled nothing is registered.

Tools: `mem_save` (same project+scope+`topic_key` updates and bumps the revision), `mem_update`,
`mem_search`, `mem_context`, `mem_get_observation`, `mem_session_start`, `mem_session_end`,
`mem_session_summary`, `mem_save_prompt`, `mem_current_project`. Search terms are quoted, so
FTS5 syntax in a query is plain text. No conflict/judgment machinery (deliberately simpler than engram).

```
PYTHONPATH=python python3 -m amauta.memory serve
PYTHONPATH=python python3 -m amauta.memory import-engram --from ~/.engram/engram.db   # read-only, idempotent
```

## Code graph tools (external, never vendored)

- **codegraph** (npm `@colbymchenry/codegraph`; the unscoped `codegraph` package is a different project).
  `install` registers the `codegraph` MCP entry (`codegraph serve --mcp`) and the `codegraph prompt-hook`
  UserPromptSubmit hook only when `codegraph` is on `PATH` and only if absent; an identical hook or an entry you
  already have is never duplicated, changed or removed. `amauta status` prints an `[optional]` line with the
  install hint when it is missing. `amauta codegraph init [--cwd DIR]` runs `codegraph init -y` there, refusing
  `$HOME`, `/`, temporary directories and directories without a project marker; `codegraph status` shows whether
  `.codegraph/` exists.
- **graphify** (PyPI `graphifyy`, Apache-2.0): `graphify-out/graph.json` stays the source of truth.
  `amauta graphify hook install|uninstall [--cwd DIR] [--state-dir DIR]` manages a marked block in the repo's
  `post-commit`, `post-merge`, `post-rewrite` and `post-checkout` hooks (`# >>> amauta graphify >>>` ... `# <<< amauta graphify <<<`; other content is kept and
  `core.hooksPath` is honoured), so history that arrives by `pull`/`merge`, `rebase`/`commit --amend` or a branch switch
  is mirrored too (`post-checkout` acts on branch switches only, never on `git checkout -- <file>`). **Auto-connect:** the `SessionStart` hook `graphify-connect` checks the session's git repository; if it has `graphify-out/graph.json` but none of amauta's blocks, it installs the four event hooks and starts one background refresh (the same block a commit would run), so a new graphify project reaches the portal without a manual step. It never touches repositories without a `graph.json` or outside git, never waits for the refresh and fails open. `amauta graphify hook uninstall` records an opt-out (`git config amauta.graphifyHook false` in that repo) that the auto-connect honours; an explicit `install` clears it.
  The block runs in a silent background subshell: `graphify update .` (only if `graphify`
  is on `PATH`, with `GRAPHIFY_QUERY_LOG_DISABLE=1`), then `python3 -P -m amauta.graph sync --repo .`.
  A lock is taken over only when it is older than 15 minutes and its owner (pid file) is gone, with at most three attempts. The pid file also holds a start token (boot id and process start time from `/proc`), so a pid reused after SIGKILL or a reboot counts as gone; without `/proc` only `kill -0` decides;
  a trigger that finds the lock held leaves a `.pending` marker and re-tries the lock once, so a marker is never orphaned.
  The sync replaces the repo's rows in `graph_nodes`/`graph_edges`/`graph_sync` (memory.db schema v5) in one short
  transaction. Query: `python3 -P -m amauta.graph query neighbors <node> [--depth N] --repo DIR` and
  `query path <a> <b> --repo DIR` (recursive CTEs, depth capped at 5 / 8; both answers carry `truncated` when the 20,000-row walk bound was hit, so a `found: false` with `truncated: true` is not a definitive "no path"); the memory MCP server exposes the same as the
  `graph_query` tool (it already owns the SQLite connection). The portal shows stats, node search and neighbors for each `--repo`, plus the SQL table count (non-file nodes of `*.sql` sources), whether a semantic pass is pending and the last semantic run (time and model).
  The `graphify-semantic` skill is the no-API-key alternative: the orchestrator runs `python3 -P -m amauta.extras.graphify_semantic plan|save-chunk|validate|merge` (graphify's APIs run in graphify's own interpreter, found from its shebang), dispatches one Read-only `graphify-extractor` Haiku subagent per chunk (balanced, at most 25 documents each) in a single message, saves each reply with `save-chunk` (subagents never write files; documents are treated as untrusted), and merges the valid chunks through graphify's `build_from_json`/`to_json` (shrink guard honoured) before recording the sync with `claude-haiku-5-5`. It consumes the Claude plan's usage limits and asks before running on more than 3 chunks. The skill is installed with the other vendored skills (graphify itself stays optional; `plan` reports it clearly when missing).

  PowerPoint: graphify does not read `.pptx`, so `plan` first writes a Markdown sidecar for every deck (Python stdlib only: `zipfile` + `xml.etree`; slide text in presentation order under `## Slide N`, speaker notes under `### Notes`) to `graphify-out/converted/<stem>_<sha256(relative path)[:8]>.md`, the same name graphify uses for `.docx`/`.xlsx`, rewritten only when the deck is newer, and adds it to the plan as a document. Symlinks, special files, `node_modules`/`.git`, decks over 100 MB and XML with DOCTYPE/ENTITY declarations are skipped; the deck itself is never modified. `amauta status --deep` lists PPTX as always available.
  The hook never calls an LLM: after `graphify update .` it runs `graphify check-update .` (local, reads `graphify-out/needs_update`) and records the verdict; a failing check leaves the stored flag alone.
  `amauta graphify semantic [--cwd DIR] [--model M] [--timeout SECONDS]` is the optional semantic pass: it runs `graphify extract <repo> --backend claude --model M` (default `claude-haiku-5-5`, or `AMAUTA_GRAPHIFY_MODEL`; `GRAPHIFY_QUERY_LOG_DISABLE=1`) only when `ANTHROPIC_API_KEY` is set, otherwise it exits non-zero and says so. The key is inherited by that one graphify process only and is never printed, stored or logged (output is masked by exact match: the whole key and a key truncated at the end of the output are removed, but a fragment of the key printed on its own mid-stream cannot be recognised); afterwards the graph is mirrored and the run recorded. It takes the same per-repo lock as the post-commit hook, implemented once in `python/amauta/graph/lock.py` (and fails fast if a refresh is running), streams graphify's output, and kills graphify after the timeout (`--timeout` or `AMAUTA_GRAPHIFY_TIMEOUT`, default 1800 s). The hook's pending verdict is the exact `[graphify check-update] Pending non-code changes` line of `graphify check-update`. `amauta status` shows the graphify version, and `status --deep` also runs a one-table `.sql` fixture through `graphify update` in a temp dir to confirm the `[sql]` extractor.
  Formats beyond the base install (all optional, install once): `pipx install "graphifyy[sql,anthropic,pdf,office]"` then `pipx inject graphifyy tree-sitter-language-pack`. The extras add SQL, PDF (`pdf`) and Word/Excel (`office`: `.docx`/`.xlsx` are converted to markdown sidecars in `graphify-out/converted/` for the semantic pass); the injected grammar pack is what lets graphify parse R (`.r`/`.R`). C++, Python and JavaScript work with the base install. `amauta status --deep` reports R, PDF, DOCX and XLSX as available/NOT available (or unknown when graphify's launcher is not a python script) with the exact fix command.
  `.Rmd` is not classified by graphify. To index it, add `language.rmd=.qmd` to the `.graphifyrc` at the repo root (graphify reads it only there); amauta never writes into your repo for this. `.csv`, `.parquet`, `.xls` and `.doc` are not supported by graphify.

## Telemetry (local only)

`install` registers `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop` and `SubagentStop`
hooks that run `env PYTHONPATH=<repo>/python AMAUTA_STATE_DIR=<state> python3 -P -m amauta.telemetry hook`.
Each call appends one row to the `events` table of `memory.db`: time, session id, event, tool name,
cwd/project, payload size, ok flag. Prompt text and tool inputs/outputs are never stored, the hook
always exits 0 with empty stdout, and the package has no network code (a test enforces it).
`install --no-telemetry` skips the hooks (`state.json` records `telemetry: false`); `uninstall` removes them.

```
PYTHONPATH=python AMAUTA_STATE_DIR=<state> python3 -P -m amauta.telemetry report [--days N] [--json]
PYTHONPATH=python AMAUTA_STATE_DIR=<state> python3 -P -m amauta.telemetry prune --days N
```

If an event cannot be written (database locked, full disk) the hook still exits 0 silently but appends one byte to
`<state>/telemetry.dropped`; its size is the dropped-event count shown by `report` and the portal. Events older than
90 days (`AMAUTA_TELEMETRY_RETENTION_DAYS`) are pruned automatically at most once per UTC day.

## Usage ingestion (local only)

With telemetry on, `install` also registers a `Stop` and `SubagentStop` hook (`python3 -P -m amauta.usage hook`)
that reads the `transcript_path` of the payload and stores, per assistant message id (deduplicated), the model,
timestamps and token counts (input, output, cache read, cache write 5m/1h, thinking) in `usage_messages`, plus tool
names in `tool_calls` (Skill names, subagent types and MCP server names only; never prompt text or tool payloads).
Ingestion is incremental through `ingest_state` (byte offset; a shrunk or rewritten file is rescanned).

```
PYTHONPATH=python python3 -P -m amauta.usage backfill [--claude-home ~/.claude] [--runtime claude|codex|all] [--codex-home ~/.codex]
```

Codex usage goes to the same tables with `runtime = 'codex'` (a `runtime` column added to `usage_messages` and `events`,
default `claude`; added without touching `user_version`). The Codex `Stop`/`SubagentStop` hook (installed with
`AMAUTA_RUNTIME=codex`) imports the finished rollout under `<codex home>/sessions/`; `backfill --runtime codex|all`
imports them all (default stays Claude only). One row per model response (`response_id`): input = `input_tokens` minus
`cached_input_tokens`, cache read = `cached_input_tokens`, cache write = `cache_write_input_tokens`, output =
`output_tokens`, thinking = `reasoning_output_tokens`. Prompt text and tool output in a rollout are never read into the
database. The portal filters sessions and usage by runtime (All / Claude Code / Codex); Codex models have no price
here, so they show tokens only.
