# amauta

A small Claude Code harness in plain Node.js and Python, modelled on
[gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) (MIT). No compiled
programs of our own, no npm dependencies and Python stdlib only for the core.

## Requirements

- Node.js >= 22 and Python >= 3.11 (`python3`; hooks and servers run it as `python3 -P`). Nothing to install.
- Optional, detected on `PATH` and never vendored: `codegraph` (npm `@colbymchenry/codegraph`) and `graphify`
  (PyPI `graphifyy`). `npx` is used by the opt-in `context7` and `rea` MCP entries.

## What `install` sets up

Into `~/.claude` / `~/.claude.json` / `~/.amauta` (all redirectable, see Safety):

| Piece | Details |
| --- | --- |
| `CLAUDE.md` | four short blocks (orchestrator, persona, memory protocol, codegraph guidance; under a 20k-char budget that `status` checks) between `<!-- amauta:ID -->` markers; your text is kept |
| Assets | output style, skills, agents (judgment-day, review lenses), rendered with model assignments |
| Stack skills (original to amauta) | `cpp-testing`, `python-testing`, `node-testing`, `r-testing` (testing patterns for C++, Python, Node.js, R), `tabular-data` (Excel, Parquet, CSV, TXT), `doc-formats` (md, Rmd, html, pdf, docx, pptx), `mermaid-diagrams` (when and how to draw Mermaid in documentation) |
| Hooks (all with a `timeout`) | `UserPromptSubmit` skill-registry, `SessionStart`/`Stop` review-stop, telemetry on 5 events, usage on `Stop`/`SubagentStop`, `codegraph prompt-hook` if codegraph exists, `PreToolUse(Agent)` preflight with `--with-sdd` |
| MCP servers | `engram` (our Python memory server; `amauta-memory` if you already have another `engram`), `amauta` (Node: `skill_registry_refresh`, `review_assess`, `review_mode_status`, `odd_tasks_status`), `codegraph` (if installed) |
| Permissions | `ask`: `Bash(git push --force*)`, `Bash(git reset --hard*)`, `Bash(rm -rf*)` (prefix matches only, `rm -fr` or `sudo rm -rf` get past them). `deny` for `Read` and `Edit` of `.env`, `.env.*`, `~/.ssh/**`, `~/.aws/credentials`, `~/.config/gh/hosts.yml`, `*.pem`, `*.key`, `secrets/**`. No `defaultMode`, no allow entries |
| Optional | `--with-sdd` (SDD module), `--with-context7`, `--with-rea` (third-party MCP servers, off by default; choices are sticky until uninstall), `--with-impeccable` (design skill, see below), `--with-archify` (diagram skill, see below), `--no-telemetry` |

## Upgrading

See [UPGRADING.md](UPGRADING.md) (`amauta upgrade --dry-run`, then `amauta upgrade`; rollback with `amauta upgrade --to <tag>`). Release notes are in [CHANGELOG.md](CHANGELOG.md).

## Layout

```
bin/amauta.js   CLI entry point
src/cli.js           command router
src/core/            marker injector, JSON merge, atomic writes, backups
src/install/         install / uninstall / status
assets/              vendored orchestrator, persona, skills, agents (see NOTICE); stack skills are original
python/amauta/  memory (MCP server), telemetry, usage, portal, graph, sdd (stdlib only) + tests
src/mcp/             Node MCP server (`amauta` entry)
test/                node:test suites
odd/tasks/           feature documents
```

## Commands

```
amauta --help
amauta version
amauta install   [--claude-home DIR] [--claude-json FILE] [--state-dir DIR] [--dry-run] [--json]
                 [--with-sdd|rea|context7|impeccable|archify] [--without-<module>] [--review-mode on|off]
amauta restore   --backup ID [same dirs] [--json]    # undo an install from its backup (ids: YYYYMMDDTHHMMSSZ)
amauta uninstall [same options]
amauta status    [same options]
```

```
amauta portal    [--port N] [--repo DIR]...      # local wiki portal (read-mostly)
amauta portal launch [--idle-exit S]             # app window (Chrome --app), stops the server when closed
amauta portal install-launcher [--remove]        # desktop entry (menu launcher), separate from `amauta install`
amauta codegraph init|status [--cwd DIR]
amauta graphify hook install|uninstall [--cwd DIR]
amauta graphify semantic [--cwd DIR] [--model M] [--timeout SECONDS]    # optional LLM pass, needs ANTHROPIC_API_KEY
```

```
amauta mermaid check FILE.md...               # validate ```mermaid fences (syntax only, no browser); exit 1 on errors
amauta skill-registry refresh [--cwd DIR] [--quiet] [--no-gitignore] [--force]
amauta skill-registry list    [--cwd DIR]
amauta review assess [--cwd DIR] [--base-ref REF] [--committed-only] [--json]
#   --base-ref / MCP base_ref accept plain refs only (no leading '-', '..' ranges or whitespace)
#   and are resolved to a commit sha before any git diff
amauta review mode   enable|disable|status [--scope global|clone] [--cwd DIR]
```

Hooks registered in `settings.json` run `node <repo>/bin/amauta.js hook <name>` (absolute
path, no `PATH` dependency). They read the Claude Code hook JSON on stdin, always exit 0 and
fail open; an empty stdout is a no-op.

- `skill-registry` (UserPromptSubmit): refreshes `<project>/.atl/skill-registry.md` only for
  projects that opted in (an existing `.atl/` directory or `.atl/` in `.gitignore`; run
  `amauta skill-registry refresh` once to opt in). Skips `/`, `$HOME`, directories without
  a project marker and a symlinked `.atl`. Home paths are written as `~/...`.
- `review-stop` (SessionStart/Stop): when review is switched on and this session
  produced a candidate that `review assess` marks as due, blocks the stop once per candidate.
  The switch is off by default; clone-local `off` (in `.git/amauta-rdd-mode`) wins over global. SessionStart keeps the
  baseline only for an explicit `resume`/`compact`; `startup`, `clear`, a missing or an unknown `source` start from the
  current state.

## Memory (Python, stdlib only)

`python/amauta/memory/` is a small engram-compatible memory server: SQLite + FTS5 at
`<state-dir>/memory.db` (`AMAUTA_STATE_DIR`, default `~/.amauta`), WAL mode,
`PRAGMA user_version` migrations. `install` registers it as MCP server `engram` (so the vendored
prompts using `mcp__engram__*` work unchanged); if you already have a different `engram` entry it is
kept and ours is registered as `amauta-memory` (recorded as `memory_server_key` in `state.json`).
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
  `post-commit` hook (`# >>> amauta graphify >>>` ... `# <<< amauta graphify <<<`; other content is kept and
  `core.hooksPath` is honoured). The block runs in a silent background subshell: `graphify update .` (only if `graphify`
  is on `PATH`, with `GRAPHIFY_QUERY_LOG_DISABLE=1`), then `python3 -P -m amauta.graph sync --repo .`.
  A lock is taken over only when it is older than 15 minutes and its owner (pid file) is gone, with at most three attempts. The pid file also holds a start token (boot id and process start time from `/proc`), so a pid reused after SIGKILL or a reboot counts as gone; without `/proc` only `kill -0` decides;
  a trigger that finds the lock held leaves a `.pending` marker and re-tries the lock once, so a marker is never orphaned.
  The sync replaces the repo's rows in `graph_nodes`/`graph_edges`/`graph_sync` (memory.db schema v5) in one short
  transaction. Query: `python3 -P -m amauta.graph query neighbors <node> [--depth N] --repo DIR` and
  `query path <a> <b> --repo DIR` (recursive CTEs, depth capped at 5 / 8; both answers carry `truncated` when the 20,000-row walk bound was hit, so a `found: false` with `truncated: true` is not a definitive "no path"); the memory MCP server exposes the same as the
  `graph_query` tool (it already owns the SQLite connection). The portal shows stats, node search and neighbors for each `--repo`, plus the SQL table count (non-file nodes of `*.sql` sources), whether a semantic pass is pending and the last semantic run (time and model).
  The `graphify-semantic` skill is the no-API-key alternative: the orchestrator runs `python3 -P -m amauta.graph.semantic_plan plan|save-chunk|validate|merge` (graphify's APIs run in graphify's own interpreter, found from its shebang), dispatches one Read-only `graphify-extractor` Haiku subagent per chunk (balanced, at most 25 documents each) in a single message, saves each reply with `save-chunk` (subagents never write files; documents are treated as untrusted), and merges the valid chunks through graphify's `build_from_json`/`to_json` (shrink guard honoured) before recording the sync with `claude-haiku-5-5`. It consumes the Claude plan's usage limits and asks before running on more than 3 chunks. The skill is installed with the other vendored skills (graphify itself stays optional; `plan` reports it clearly when missing).

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
PYTHONPATH=python python3 -P -m amauta.usage backfill [--claude-home ~/.claude]
```

## Control portal (local wiki)

A local wiki over everything the harness knows: memories, skills, tools, MCP servers, sessions, ODD features and code-graph nodes,
each a linked page with backlinks. Stdlib Python server plus a vanilla JS single-page UI; no CDN, no network, binds `127.0.0.1` only.

```
amauta portal [--port 8765] [--repo DIR]... [--claude-home DIR] [--engram-db FILE] [--idle-exit S]
amauta portal launch [--idle-exit S]       # opens an app window (Chrome --app) and stops the server when it closes
amauta portal install-launcher [--remove]  # desktop entry; not part of `amauta install`
```

(`PYTHONPATH=python python3 -P -m amauta.portal ...` is the same server without the CLI wrapper.)

### Routes

| Route | Page |
|---|---|
| `#/` | Home: recent activity by day; rail with spending, skill-impact ranking, harness health |
| `#/memory[/id-or-topic_key]` | Memory: text, derived links and backlinks, same-topic rows, related graph nodes |
| `#/skill\|tool\|mcp[/name]` | Rendered `SKILL.md`, usage over time, sessions, attributed tokens, impact |
| `#/session[/id]` | Skills, tools, subagents, tokens and memories of one session |
| `#/feature[/name]` | ODD document, progress, resolved commits, status-grouped task diagram |
| `#/node[/repo::id]` | Graph node, grouped neighbours, neighbourhood diagram |
| `#/usage` | Token charts, model split, cache hit ratio, cost estimate (Range and Project filters live here) |
| `#/harness`, `#/diagrams` | Install state and architecture diagram; Mermaid diagrams (see below) |
| `#/lint` | Review candidates (see below) |
| `#/settings` | Guarded settings editor (see below) |

Search with `Ctrl+K` or `/`: one query across memories (FTS5), skills, tools, MCP servers, sessions, features, tasks and graph nodes.
Memory links are derived, because the store keeps no relation table: `[[wikilinks]]` (`[[topic]]`, `[[kind:id|label]]`), the `topic_key`
hierarchy, whole-word mentions (12+ characters) and graph labels. The store keeps only the latest revision of a memory; the page says so.
All text from memories, repos and graphs is rendered through text nodes by a small markdown subset (no raw HTML), under a strict CSP.

### Lint (`#/lint`, `GET /api/wiki/lint?days=30`)

Counts and links for six checks, all capped and read-only. They are prompts to review, never verdicts.

| Check | Meaning |
|---|---|
| Orphan memories | No wikilink, topic neighbour or mention connects them to another page |
| Possible duplicates | Same or near-identical title under different `topic_key`s (same project) |
| Possibly superseded | Same type and topic prefix, similar title, a newer save |
| Installed skills never used | No load in the window (needs usage data) |
| ODD tasks checked without a commit | No commit hash on the task line or in a progress line naming its id |
| Wikilinks to missing pages | Target is not a memory, skill, tool, MCP server, session, feature or node |

### Settings editor (`#/settings`)

Changes a closed list of options, and nothing else: persona (`gentleman`/`neutral`), review mode, telemetry, the optional modules
(`sdd`, `rea`, `context7`, `impeccable`, `archify`) and "reinstall / repair". The portal never edits a harness file itself; every change
goes through `amauta install`.

1. **Preview** runs `amauta install --dry-run --json` and shows the files that would be written, removed or kept (edited files are kept).
2. **Apply** needs the one-time token from that preview (valid 5 minutes, bound to the chosen options and the `state.json` hash, one apply
   at a time) plus an explicit confirmation. The installer backs up first and reports the backup id.
3. **Undo** previews and re-runs the same install with the settings that were in place before the newest portal change (its own token, lock and fresh backup); it never restores file snapshots, so edits made since to `~/.claude.json`, `settings.json` or `CLAUDE.md` survive, and it is refused when the settings changed since. `amauta restore --backup <id>` stays a CLI-only expert tool.

Guards: POST only, JSON only (4 KB cap), per-process token header, `Host` and `Origin` checks, closed schema (unknown keys and values are
rejected), options reach the installer as argv entries (no shell). Limit: undoing a change that turned `impeccable` off does not bring its
npm engine back; run reinstall / repair.

### Skill impact (comparative, not causal)

Skill pages and the Home rail compare sessions that loaded a skill with sessions that did not: tool error rate, retries (same tool within
3 calls after an error), output tokens per turn after the load, test-command failure rate and loaded-but-unused. Every number carries
`n` and the sessions behind it; a side with fewer than 5 sessions is suppressed ("not enough data"); small differences read "no clear
difference". **Correlation caveat:** skills are loaded for harder or different tasks, so a worse number is not proof the skill hurts. A per-skill change
log (sha256 of each installed `SKILL.md` and the git commits touching it) lets you read before and after windows. Telemetry stores outcome
classes only (ok/error/denied, exit class, "is a test command"), never tool input, output, paths or commands. Opening a skill page records the
hash of its installed `SKILL.md` (hash and first-seen time, no text) in `memory.db`; that is the one write a page view can cause (the guarded POSTs are listed under Security).

### Archify (harness architecture)

When the optional archify module is installed (`install --with-archify`), `#/harness` draws the architecture with the vendored archify CLI:
hooks above the hub in lifecycle order, installed assets and state stores beside it, MCP servers below, one line per group. The generated
JSON uses generated ids and capped labels, is rendered in a temp dir with a scrubbed environment, and is shown in a `sandbox="allow-scripts"`
iframe from its own route (`/archify/<hash>.html`) under a separate CSP. Without node or the module the page falls back to the Mermaid diagram.

### Launcher

`amauta portal launch` picks a free port on 127.0.0.1, starts the portal detached (log in `<state>/portal/portal.log`, run file
`<state>/portal/run.json`) and opens Google Chrome/Chromium (`AMAUTA_BROWSER` overrides) as an `--app=` window with its own profile
(`<state>/portal/browser-profile`). When the window closes the server gets SIGTERM (SIGKILL after 5 s) unless another launcher is still
attached; a second launch reuses the running server; without a Chromium-family browser it falls back to `xdg-open`. The page sends a
heartbeat every 10 s and a launched server (`--idle-exit`, default 30 s) exits once the heartbeats stop. `install-launcher` writes
`~/.local/share/applications/amauta-portal.desktop` (override: `--applications-dir` or `AMAUTA_APPLICATIONS_DIR`) with `Terminal=false`.

### Security

The server checks the `Host` header against DNS rebinding, serves a strict CSP (scripts from this origin only, no eval, nothing loaded from or
sent to another origin; inline styles are allowed because Mermaid writes them into its SVG) and opens every database with `mode=ro` (never
created, never migrated). Writes are limited to three guarded POST endpoints: Refresh usage (`/api/refresh`, the usage backfill),
the heartbeat, and the settings editor above; each needs the per-process token and a same-origin check. Hook command text and MCP
`args`/`env` of other tools are never exposed. Cost estimates stay off unless `<state>/prices.json` exists
(`{"models": {"<model>": {"input": N, "output": N, "cache_read": N, "cache_write": N}}}`, prices per million tokens; a missing key counts as 0, a non-numeric or negative value is reported under `invalid_prices` and that model is not costed).

### Diagrams (Mermaid)

The portal ships a vendored, unmodified Mermaid build (`python/amauta/portal/static/mermaid.min.js`, MIT, version and sha256 in `NOTICE` and
`assets/manifest.json`; no CDN) that is loaded only when a diagram is first drawn. It runs with `securityLevel: 'strict'` and
`startOnLoad: false`, and the returned SVG is adopted as DOM nodes, never as an HTML string. Mermaid source is generated server-side
(`python/amauta/portal/diagrams.py`): node ids are generated, and every label that comes from a repo, a graph or the install state is quoted and
entity-escaped (quotes, brackets, backticks, `<`, `>`, newlines, `#`, `;`) and truncated, so a hostile label cannot add nodes or `click` directives. Where it shows:

- Harness page: the install architecture. Feature and project pages: one task-progress flowchart per `odd/tasks/*.md` (green done, orange pending, capped at 40 tasks). The old Diagrams page is gone; `#/diagrams` redirects to Harness.
- Memories, graph memory: selecting a node also draws its neighborhood (nearest 30 nodes and up to 30 edges; `GET /api/graph/diagram`).
- Memories: the portal shows markdown as plain text, and now also draws the first five ```` ```mermaid ```` fences of the selected file or memory below it.

The Content-Security-Policy had to loosen one directive for this: `style-src 'self' 'unsafe-inline'` (verified in Chromium: Mermaid applies inline `<style>`
and `style=` attributes while drawing; with `style-src 'self'` the diagrams render unstyled). `script-src` stays `'self'`.

### Writing and validating diagrams in documentation

The `mermaid-diagrams` skill (installed with the other skills) tells the agent when a diagram earns its place, which type to use (flowchart, sequence,
ER, state, class, gantt), the syntax traps (quoting labels, the reserved word `end`, node ids) and to keep diagrams small; GitHub renders
```` ```mermaid ```` fences natively.

`amauta mermaid check FILE.md...` validates every fence and exits 1 with `file:line` on a syntax error. Feasibility finding: `mermaid.parse()` runs under
plain Node in a bare `node:vm` context with no DOM, jsdom or browser, once the bundled DOMPurify (which is a bare stub without a DOM) is given
no-op `addHook`/`sanitize` stand-ins on that throwaway context; this covers flowchart, sequence, ER, state, class and gantt. It checks syntax only: layout
and rendering still need a browser (the portal or GitHub). The stand-ins are tied to the pinned Mermaid version; a test parses real diagrams of every type, so an upgrade
that breaks them fails the suite.

## Safety model

- Hooks fail open (always exit 0, empty stdout = no-op) except the SDD preflight, which fails closed for `sdd-*` agents.
- Local only: no network code in telemetry/usage/portal; the portal binds `127.0.0.1`, opens databases read-only and writes only through guarded POSTs (see Security above).
- User content is preserved (hooks, MCP servers, `permissions`, CLAUDE.md text); files are backed up before
  every write and edited managed files are left alone on uninstall unless `--force`.
- Deliberately absent (unlike gentle-ai): consent envelopes, review receipts/lineage, network telemetry, self-update.

## Safety: parameterized targets

Nothing is hardcoded to the real home. Every target can be redirected, and tests
only ever use temp directories:

| Option | Environment variable | Default |
| --- | --- | --- |
| `--claude-home` | `AMAUTA_CLAUDE_HOME` | `~/.claude` |
| `--claude-json` | `AMAUTA_CLAUDE_JSON` | `~/.claude.json` |
| `--state-dir` | `AMAUTA_STATE_DIR` | `~/.amauta` |

If only `--claude-home` is given, the other two default to paths inside it
(`<home>/.claude.json`, `<home>/.amauta`), so a sandboxed install never touches the real home.

Every file is backed up under `<state-dir>/backups/<timestamp>/` before it is written.
Existing user content (CLAUDE.md text, hooks, MCP servers, `permissions.defaultMode`)
is preserved. `permissions.defaultMode` is never set or changed (upstream forces
`bypassPermissions`; amauta deliberately does not); only the `ask` and `deny` rules above are appended (a rule you already list is never recorded as ours), and uninstall removes just the ones amauta added. `deny_added` entries recorded by pre-T15 installs are never stripped on re-install or uninstall; `status` lists them as kept.
Files amauta installs are tracked by hash: if you edit one, re-install and uninstall keep your
version unless you pass `--force`.

## Migrating from gentle-ai

`scripts/migrate.sh` replaces gentle-ai with amauta for Claude Code (they do not coexist). Close Claude Code, then run it from a terminal:

```
scripts/migrate.sh            # dry run: prints every action, changes nothing
scripts/migrate.sh --execute  # asks y/N before each phase
```

Phases: preflight, backup (`~/amauta-migration/<timestamp>/backup.tar.gz` with sha256), engram memory import, `gentle-ai uninstall --agent claude-code` (gentle-ai asks its own confirmation), disable the `engram@engram` plugin, `amauta install --with-sdd --with-rea --with-context7 --with-impeccable`, verification. Re-running resumes unfinished phases; after a finished run it does nothing, and after a rollback a new `--execute` starts a NEW run directory (an existing `backup.tar.gz` is never overwritten). The backup directory is `0700` and its files `0600`. gentle-ai's own uninstall prompt runs on your real terminal and is not logged. To undo: `scripts/rollback.sh ~/amauta-migration/<timestamp>` (restores config, only `mcpServers` of `~/.claude.json`, never `~/.claude/projects`; replaced files are moved aside, not deleted; works even if amauta was never installed; the backup directory is kept and marked `rolled-back`). `--assume-yes` exists only for the automated tests.

## Tests

```
npm test            # node --test, then python unittest
npm run test:node
npm run test:py
node --test test/e2e.test.js   # end-to-end only
```

`test/e2e.test.js` installs (`--with-sdd`, telemetry on) into a fake HOME seeded with user settings, `claude.json` and
`CLAUDE.md`, runs every registered hook command with `sh -c` and a JSON payload (as Claude Code does), starts the
`engram` and `amauta` MCP servers from their `claude.json` entries (initialize, `tools/list`, one tool call), checks
the telemetry/usage rows in `memory.db`, fetches `/api/overview` from the portal on `127.0.0.1`, and finally uninstalls and
compares the files with their seeds. A fake `codegraph` on `PATH` enables the codegraph hook; nothing touches the real home
and nothing needs the network.

## Optional diagram skill (`install --with-archify`)

The [archify](https://github.com/tt-a1i/archify) skill (MIT, credited in [NOTICE](NOTICE), commit and checksums in `assets/manifest.json`),
installed only on request into `~/.claude/skills/archify`. The agent writes typed JSON and `bin/archify.mjs` validates it and renders a
self-contained HTML diagram (10 diagram types). It is pure Node with no npm dependencies, vendored as upstream published it except for the
update check, which is permanently off (the skill never touches the network). Sticky until uninstall; `amauta status` checks the CLI is there.
The portal uses the same CLI to draw the harness architecture on the Harness page when it is installed.

## Optional design skill (`install --with-impeccable`)

The [impeccable](https://github.com/pbakaus/impeccable) design skill (Apache-2.0, credited in [NOTICE](NOTICE)), installed only on
request, sticky until `uninstall`, which removes it together with its engine.

- Skill `impeccable` = upstream `skill-v3.9.1`: `craft`, `shape`, `critique`, `audit`, `polish`, `live` and the other design
  commands. Its helper scripts are plain Node with no npm dependencies and include their own static anti-pattern detector, so the
  skill works even if the engine install below fails.
- Engine: `npm install --prefix <state dir>/impeccable impeccable@3.6.1 --omit=optional --ignore-scripts --no-audit --no-fund`
  (pinned; needs `npm` on PATH and network once). The skill calls it as `node <state dir>/impeccable/node_modules/impeccable/cli/bin/cli.js detect|ignores`.
  An npm failure keeps the skill installed, prints the reason and exits 1; rerun `amauta install` to retry. `status` reports the engine
  version and flags a missing or different one.
- 3.x versus 4.x: impeccable 4.x moved its engine to a Rust binary (about 40 verbs), so it cannot run in a harness with no compiled code
  of its own. 3.x is the last pure-JavaScript line and therefore lacks what 4.x added. Not in this install: the `pin`, `unpin` and `hooks`
  commands (they write project hooks that point at a project-local skill copy), URL scanning (needs puppeteer, left out on purpose),
  self-update (`amauta install` is the update path; the boot script's once-a-day version poll is disabled), and anything specific to 4.x.

## License

MIT. Vendored upstream assets are credited in [NOTICE](NOTICE).

## Optional SDD module (`install --with-sdd`)

Spec-Driven Development from gentle-ai v3.4.0, installed only on request and removed by `uninstall`
(the choice is sticky across plain re-installs).

- Skills `sdd-*`, agents `sdd-*`, shared contracts and commands renamed to `/amauta-sdd-*` (so they never
  collide with a gentle-ai install). Models come from the install state like the other agents.
- `python3 -P -m amauta.sdd status [change] [--cwd DIR] [--json] [--instructions]` and `continue [change]` are
  read-only and reproduce the `gentle-ai.sdd-status` v2 projection over `openspec/changes/<change>/`
  (proposal, specs, design, tasks, apply-progress, verify-report). Only the `openspec` artifact store is supported:
  a declared `engram`/`hybrid` store is reported as blocked. A task that names a path outside the workspace blocks apply
  (`blocked(edit_authority_missing)`); mark read-only inputs with `(read-only)`. There is no consent or grant machinery.
- `python3 -P -m amauta.sdd preflight-hook` is a `PreToolUse` hook for the `Agent` tool: an `sdd-*` subagent is
  dispatched only after the parent asked the three-question `AskUserQuestion` preflight (Interactive|Automatic,
  OpenSpec|Engram|Both, Ask me|Single PR|Auto) and the human answered it in the session transcript; the hook then
  prefixes the `## SDD Session Preflight` block to the prompt. The registered command is a small `sh` guard around the Python
  hook: it runs the hook under `timeout 20` (when `timeout(1)` exists) and prints the hook's output only if it succeeded.
  If `python3` is missing, the module cannot be imported, the hook crashes, exits non-zero or hangs, the guard discards any
  partial output and prints a PreToolUse deny decision, but only when the payload is an `sdd-*` dispatch; other agents
  stay silent (fail open). Residual gaps: no `sh` at all, or a hung hook on a system without `timeout(1)` (Claude Code
  then kills the shell at the 30 s hook timeout and treats it as a non-blocking hook error).
