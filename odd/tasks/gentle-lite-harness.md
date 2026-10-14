# Feature: gentle-lite harness

Locator: `odd/tasks/gentle-lite-harness.md` · Engram mirror: `odd/gentle-lite-harness/tasks`

## Objective

Build `gentle-lite`, a Claude Code harness equivalent to gentle-ai, using only Node.js/npm and Python scripts (no compiled binaries). Base on upstream gentle-ai v4 (ODD orchestrator); ship v3 SDD as an optional installable module.

## Problem / why

gentle-ai is a large Go binary (2200+ files, 18 runtime adapters, consent envelopes, receipts, telemetry). The user wants a small, readable, hackable harness, then a simplification pass that may drop signatures, consent and receipt machinery.

## Evidence

- Upstream source: github.com/Gentleman-Programming/gentle-ai (MIT). Shallow clone and v3.4.0 files in the session scratchpad (`gentle-ai-src/`, `v34/`).
- Source spec: scratchpad `gentle-ai-source-spec.md`.
- Binary observation (REA + black-box, no decompilation; Ghidra search timed out): scratchpad `gentle-ai-re-report.md`.

## Scope

In:
- CLI `gentle-lite` (Node): `install`, `uninstall`, `status`, `skill-registry refresh`, `review assess`, `review mode`, hook entrypoints.
- Install core: CLAUDE.md marker injector (`<!-- gentle-lite:ID -->`), JSON deep merge (`__replace__`), atomic writes, file-copy backups + manifest, restore.
- Assets copied from upstream v4 with MIT attribution: orchestrator, persona, output style, skills, agents (judgment-day, review lenses).
- Settings: hooks, permissions overlay that PRESERVES the user's existing `permissions.defaultMode` (upstream resets it to bypassPermissions — deliberate divergence).
- MCP entries in `.claude.json`: engram, context7, codegraph, rea, and the own `gentle-lite` Node MCP server.
- Node MCP server exposing harness tools (skill registry, review assess, ODD/SDD status).
- Hooks: skill-registry refresh (UserPromptSubmit), review stop reminder (SessionStart/Stop).
- Optional SDD module (`--with-sdd`): v3 sdd-* skills/agents/commands/_shared, Python `sdd_status.py`/`sdd_continue`, Python preflight hook.

Out (dropped from upstream): network telemetry (local-only telemetry is in scope, T10), TUI, 18 non-Claude adapters, consent envelopes, lineage/receipts/burn, installer DAG, ownership ledgers, self-update.

## Constraints

- No compiled programs; Node >= 22 (stdlib first) and Python 3.12 stdlib.
- Never touch the real `~/.claude` during development or tests: every write goes through `--claude-home` / `GENTLE_LITE_CLAUDE_HOME` and `--state-dir` / `GENTLE_LITE_STATE_DIR`; tests use temp dirs.
- Real install on this machine is a separate, explicit user decision (it would overlap gentle-ai 3.4.0 currently installed).
- Artifacts in English. Conventional commits, no AI attribution lines.

## TDD

- Mode: strict, ON. Source: user global CLAUDE.md ("Strict TDD Mode: enabled").
- Runners: `node --test` (Node), `python3 -m unittest discover -s python/tests` (Python; pytest not installed).
- Require observed RED before GREEN for each behavior.

## Delivery

- Local repo `~/gentle-lite`, no remote: PR chaining not applicable. Work-unit commits on branch `feat/gentle-lite-harness`.
- Forecast: ~2500-3500 authored lines (excluding copied upstream assets). Delivery strategy: ask-on-risk (default); chain strategy pending only if a remote/PR is added.
- RDD: global on. After each work-unit commit run `gentle-ai review assess --cwd ~/gentle-lite --agent claude-code --base-ref <last reviewed> --committed-only --json` and record tier/outcome.

## Tasks

- [x] T1 Scaffold: package.json (bin, scripts), CLI router, NOTICE/LICENSE (MIT + upstream attribution), README, test harness for both runners. Route: delegated (writer, 2+ files). Commit: `5638e3d`.
- [x] T2 Install core: marker injector, JSON merge, atomic write, backup/restore with manifest. Route: delegated. Commit: `75caf06`.
- [x] T3 Assets + installer: vendor v4 assets, `install`/`uninstall`/`status`, settings hooks + permissions (preserve defaultMode), MCP entries, state.json. Route: delegated. Commit: `ecd0b7e`.
- [x] T2b Fix RDD reliability warnings on core (review-8f9838a7dfe90f22): R3-002 `backup.js` statOrNull must only map ENOENT to null (other errors throw; never record existed:false on EACCES/ELOOP/ENOTDIR); R3-001 `fsatomic.js` unlink temp file on writeFile/sync failure; R3-003 `restoreBackup` pre-validates all entries (snapshot present for existed entries) before mutating, and reports partial failure. Route: delegated. Commit: `b1c88b9`.
- [x] T4 Hooks + review: skill-registry refresh (fingerprint cache), review assess heuristic (passive/medium/high), review mode on/off, stop reminder hook. Hook commands registered as absolute `node <repo>/bin/gentle-lite.js hook <name>` (no PATH dependency); uninstall matches the `gentle-lite.js hook ` / `gentle-lite ` substrings. codegraph-guidance: replace `gentle-ai codegraph init` with upstream `codegraph init`. Route: delegated. Commit: `2b61f1b`.
- [x] T5 Node MCP server `gentle-lite` (stdio) exposing registry/assess/status tools. Route: delegated. Commit: `0cb7011`.
- [x] T4b (commit `44538b5`) Fix RDD warnings from T4 (review-0383217060cd12f0) and T5 (review-31d944ec5806a00e):
  - SECURITY T5 R1-001: validate `base_ref` everywhere it reaches git (MCP `review_assess`, CLI): reject values starting with `-`, containing `..`/`...` range syntax, whitespace or control chars; resolve with `git rev-parse --verify --end-of-options <ref>^{commit}` before use; pass `--end-of-options` / `--` separators to all git invocations.
  - T5 R4-002/R3-004/R2-001: `validateArgs` validates per-tool inputSchema (types, required, absolute `cwd`, existing directory).
  - T5 R4-001/R3-003: `oddTasksStatus` maps only ENOENT to empty; other readdir errors surface as tool errors.
  - T5 R3-001: entrypoint guard compares realpaths. T5 R3-002: all JSON-RPC replies (including -32700/-32600) go through the same ordered write path.
  - T4 R1-001/R1-002: skill-registry hook only writes `.atl/` when the project already opted in (existing `.atl/` dir or `.atl/` already in .gitignore), or via explicit CLI `refresh`; registry paths under $HOME rendered as `~/...`; hook never creates files in arbitrary repos.
  - T4 R4-001/R3-stop-rebaseline-on-compact: SessionStart only writes a baseline on `startup`/`clear` (or when none exists); `resume`/`compact` keep baseline and notified list.
  - T4 R2-stop-baseline-sentinel: replace the empty-diff sentinel with explicit "not a git repo" / "no HEAD" branches + comments.
  - T4 R3-mode-global-missing-statedir: `setMode` creates stateDir before atomic write.
  Route: delegated.
- [ ] T11b Fix RDD warnings from the three T11 reviews (full claims in scratchpad `c9cap3.json`, `c10cap3.json`, `c11cap2.json`, `reviewer_results[].findings[]` with severity WARNING):
  - usage: ingest holds one write transaction up to 3 s (starves telemetry) → commit in small batches; backfill must count `sqlite3.OperationalError` per file instead of aborting; dead argparse `hook` subparser; USAGE_EVENTS push without `??=` guard.
  - portal server/API: negative/invalid Content-Length; `parse_qsl` ValueError and any unexpected view exception → JSON 400/500 instead of dropped connection; `memory_history` connection leak; rename `_compatible`; invalid prices in prices.json must be reported, not silently 0.
  - UI/CLI: `gentle-lite portal` must print the spawn error (e.g. python3 missing); memories `load()`/row handlers catch async errors and check `available` before `facets`; strengthen the vacuous `#usage` UI test assertion.
  Route: delegated.
- [ ] T6 Optional SDD module: v3 assets, Python sdd_status/sdd_continue, Python preflight hook, `install --with-sdd`. Route: delegated.
- [x] T9 (commit `a86c3f0`) Python memory MCP (stdlib sqlite3 + FTS5, hand-rolled stdio JSON-RPC): engram-compatible tool names (mem_save, mem_search, mem_context, mem_get_observation, mem_session_summary, mem_update), topic_key upsert, projects/sessions. Installer registers it as `engram`-equivalent server; harness never requires the compiled engram binary. Route: delegated.
- [x] T10 (commits `a86c3f0` installer hooks + `e945363` package) Local-only telemetry (Python, same SQLite module): hooks SessionStart/UserPromptSubmit/PostToolUse/Stop/SubagentStop append events; no network ever. Route: delegated.
- [x] T11 (commits `bfb055e` usage, `2efa69b` telemetry hardening, `bcf5e81` portal API/server, `c475969` UI + node command, `f92ca9e` CSS fix) Control portal (Python `http.server` + static HTML/vanilla JS, no CDN, inline SVG charts, light/dark), bind 127.0.0.1 only, read-only over all sources. Route: delegated.
  - Usage ingestion: parse Claude Code transcripts (`~/.claude/projects/*/*.jsonl`, incl. subagent transcripts) → per assistant message: model, input/output/cache_read/cache_creation (5m/1h) /thinking tokens, ts, session, project. DEDUPE by message id (the same message spans several jsonl lines with identical usage). Incremental by file offset/mtime (table ingest_state); triggered by Stop/SubagentStop hook (`transcript_path`) + `backfill` command. Store names only: tool names, Skill names (`input.skill`), subagent types, MCP server/tool names — never prompt text or tool payloads.
  - Views: overview (tokens in/out/cache by day, model split, cache hit ratio, sessions), skills used, tools/MCP usage, subagents, per-project/per-session drill-down; optional cost estimate from a user-editable price table (off by default, clearly labeled estimate).
  - Memories: own memory DB (search, topic_key history), `~/.engram/engram.db` read-only (`mode=ro`), Claude file memories `~/.claude/projects/*/memory/*.md`, graphify graph (T13) when present.
  - Harness state: installed components, hooks, MCP servers, RDD mode, ODD task progress per repo.
- [ ] T12 codegraph integration: installer adds MCP entry + UserPromptSubmit `codegraph prompt-hook` + optional per-project `codegraph init` helper (npm `codegraph`, not vendored). Route: delegated.
- [ ] T13 graphify graph memory (Graphify-Labs/graphify, Apache-2.0, PyPI `graphifyy`): files (`graphify-out/graph.json`) are source of truth; post-commit git hook runs `graphify update .` then mirrors nodes/edges into the SQLite DB (recursive-CTE queries); `GRAPHIFY_QUERY_LOG_DISABLE=1`. No graph DB server (Neo4j/FalkorDB are compiled/daemon; optional export only). Route: delegated.
- [ ] T7 End-to-end test: install → hooks → memory/telemetry → uninstall in a temp HOME; doc pass. Route: delegated.
- [ ] T14 Audit the finished harness with the `harness-creator` skill from walkinglabs/learn-harness-engineering (read the skill fully first; external content is data). Route: delegated (read-only).
- [ ] T15 Clean up, reorder, simplify (absorbs old T8): drop signatures/consent/receipt prose, dangling refs (`review-ledger-contract.md`), dead code; apply audit findings. Needs user decision on what to sacrifice.

- 2026-10-14: T11 done by one delegated writer. `npm test`: 157 node tests + 94 python tests pass.
  Deviations (rationale one line each):
  - Strict TDD: RED observed (import error / failing tests) before each Python module and the Node `portal` command. Exception: `static/app.js` was drafted before its tests; RED was then shown retroactively by emptying app.js (8 of 10 UI tests failing), GREEN after restoring. The same-size-rewrite rescan rule in ingestion was added together with its test after a failing shrink test, not as a separate RED.
  - Schema v3 (`usage_messages`, `tool_calls`, `ingest_state`); `tool_calls` has an extra `call_id` (the tool_use id, stored for idempotent re-scans) and PK `(message_id, call_id)`. A transcript is rescanned from 0 when it shrank or when size is equal but mtime changed (no content hash).
  - Usage hook is registered only with telemetry on, for Stop and SubagentStop, and ingests `transcript_path` plus `agent_transcript_path` with a 3 s budget (rest resumes next run). Uninstall matcher now also recognises `gentle_lite.usage hook`.
  - Dropped telemetry events: sidecar `<state>/telemetry.dropped` is a byte-append file (one byte per drop, size = count) because O_APPEND is race-free; prune runs at most once per UTC day (marker `telemetry.pruned`), default 90 days, env `GENTLE_LITE_TELEMETRY_RETENTION_DAYS`, plus `telemetry prune --days N`.
  - Portal: binds 127.0.0.1 with no host option at all; Host header allow-list (DNS rebinding), strict CSP without inline script/style (charts are DOM-built SVG using classes), POST `/api/refresh` needs the per-process token header plus same-origin check. Hook command text of other tools and MCP `args`/`env` are never returned by `/api/harness`. SQLite is opened `mode=ro` and never migrated or created (old schema reports `available: false`).
  - Cost estimate: off unless `<state>/prices.json` exists; cache writes (5m and 1h) share one `cache_write` price. Engram DB views need the engram observation columns; otherwise reported as unavailable.
  - UI XSS is tested at DOM level through a small fake DOM running the real `app.js` under Node `vm` (no browser dependency); also checked once in the built-in browser at 375px (no horizontal scroll after a CSS fix, no console errors).
  - Not done (by scope): graphify view only shows node/edge counts (T13 finishes it); RDD review of the T11 commits not run per instructions.

## Acceptance criteria

- `npm test` and Python unittest pass.
- `gentle-lite install --claude-home <tmp>` produces CLAUDE.md sections, settings hooks, MCP entries, skills, agents; re-running is idempotent; `uninstall` restores the pre-install state.
- Hooks follow the Claude Code hook protocol (stdin JSON, stdout JSON, exit 0).
- MCP server answers `initialize` and `tools/list` over stdio.

## Progress

- 2026-10-14: exploration done (REA + source). Base decision: v4 + optional SDD (user choice). Repo initialized.
- 2026-10-14: T1-T3 done by one delegated writer (strict TDD, RED observed per module, GREEN after). `npm test`: 82 node tests + 1 python test pass. Install/status/idempotent re-run verified in temp dirs only; real `~/.claude` untouched.
  Deviations (rationale one line each):
  - `agent-routing` and `codegraph-guidance` assets are the rendered upstream text taken read-only from the installed CLAUDE.md (upstream renders them in Go, no template file exists); engram protocol is upstream `protocol-slim.md`.
  - Deny list is unioned with the user's (upstream replaces it wholesale); `permissions.defaultMode` is never set at all (upstream sets bypassPermissions).
  - With only `--claude-home` given, `.claude.json` and the state dir default inside it, so a sandboxed install cannot leak into the real home.
  - Managed files are tracked by sha256 in `state.json`: user-edited copies are kept on install/uninstall unless `--force`.
  - Hardcoded `mcp__plugin_engram_engram__` in upstream agents is rewritten to `mcp__engram__` unless the engram plugin is enabled (tool allowlists must match the registered server); agents also get the CodeGraph tool grant and the three footer sections.
  - Only `skill-registry`, `review assess` and `review mode` command names were rebranded to `gentle-lite`; other `gentle-ai review ...` consent/lineage prose is kept verbatim for the T8 simplification pass. `judgment-day` links to the not-vendored `review-ledger-contract.md` (dangling, T8).
  - Hook commands assume `gentle-lite` is on PATH (`npm link`); hook handlers are placeholders (exit 0, empty stdout) until T4.

- 2026-10-14: RDD per work-unit commit (gentle-ai review assess). Whole T1-T3 range START refused: `lens_context_budget_exceeded` (4434 lines; no authority created). User chose per-commit review:
  - `5638e3d` T1: high (executable_mode, process_boundary) → granted → 4 lenses → approved, acknowledged (review-a547fe17c9641782). 10 advisory findings (README describes unimplemented commands, minor CLI nits) → fold into T15.
  - `75caf06` T2: medium → granted → reliability lens → approved, acknowledged (review-8f9838a7dfe90f22). 3 warnings → T2b; 4 suggestions → T15.
  - `ecd0b7e` T3: high, 3526 lines (mostly vendored upstream markdown) — left unreviewed per user choice (would exceed lens budget).
  - `9fd7180` docs: passive, no review.
  - Reviewed boundary for next assess: `75caf06` (ecd0b7e pending/unreviewed).
- 2026-10-14: scope added by user: memory (Python SQLite), local telemetry, explorer, codegraph, graphify, audit, cleanup. Runtime split: Node = installer/CLI/harness MCP; Python stdlib = memory, telemetry, explorer, SDD. Environment note: reviewer transport needs the `claude` CLI logged in (failed once with expired OAuth, retried after login).

- 2026-10-14: T2b, T4, T5 done by one delegated writer. `npm test`: 115 node tests + 1 python test pass.
  Deviations (rationale one line each):
  - T4 implementation was drafted before its tests; RED was then shown retroactively by stashing the new/changed sources (7 failing test files/cases), GREEN after restoring. T2b and T5 were strictly test-first.
  - MCP server is hand-rolled newline-delimited JSON-RPC (no `@modelcontextprotocol/sdk`): four small tools do not justify a dependency; requests are answered in arrival order.
  - Hook commands are `node <abs>/bin/gentle-lite.js hook <name>`; install replaces stale PATH-based `gentle-lite hook ...` entries; uninstall matches via regex (`gentle-lite.js['"]? hook ` or leading `gentle-lite `).
  - `review assess` candidate = tracked changes only (untracked files ignored); passive reason code is `passive_content`; `.gitlab-ci.yml` also counts as CI workflow.
  - `.gitignore` gets `.atl/` only when the dir has `.git` or an existing `.gitignore`; the hook never touches `.gitignore`.
  - `review-stop` also no-ops when `stop_hook_active` is set (loop guard).

- 2026-10-14: RDD for T2b/T4/T5 (per-commit, base = parent):
  - `b1c88b9` T2b: medium, 131 lines → under_budget, no review (pending in slice).
  - `2b61f1b` T4: high (process_boundary), 1042 lines → granted → 4 lenses → approved, acknowledged (review-0383217060cd12f0). 6 warnings → T4b, 13 suggestions → T15.
  - `0cb7011` T5: high (process_boundary) → granted → 4 lenses → approved, acknowledged (review-31d944ec5806a00e). 8 warnings (1 security: git option injection via base_ref) → T4b, 6 suggestions → T15.
  - `3a1cd8d` docs: passive.

- 2026-10-14: T4b, T9, T10 done by one delegated writer. `npm test`: 137 node tests + 33 python tests pass.
  Deviations (rationale one line each):
  - T4b: `base_ref` is whitelisted (`[A-Za-z0-9_@/+^~][...-.]*`, no `..`) and resolved with `rev-parse --verify --end-of-options <ref>^{commit}` to a sha before `git diff`; diffs also end with `--`. Manual check: `--base-ref=--output=/tmp/gl-pwn` exits 1, file not created.
  - T4b: R3-mode-global-missing-statedir was a false positive (`writeFileAtomic` already creates parents); added a regression test (passes without the fix) plus an explicit `mkdir`. The `skill-registry` hook opts in per project (`.atl/` dir or `.atl/` in .gitignore) and refuses a symlinked `.atl` for every caller; the explicit CLI `refresh` and the MCP tool still create `.atl` in a project.
  - T4b: SessionStart with a repo that has no commits now writes a baseline (`head: null`); only a non-git cwd writes none. `resume`/`compact` keep the baseline; `startup`/`clear` rebaseline.
  - T4b: MCP arguments are validated from each tool's `inputSchema` (required, string/boolean types, absolute existing `cwd`); `arguments: null` is now rejected instead of defaulted.
  - T9: no conflict/judgment machinery (deliberate simplification vs engram). Observation `revision` maps from engram `revision_count`; engram ids are not preserved, idempotency is by `sync_id` (synthetic `engram-obs:<id>` when the source has none). Prompts table also has a UNIQUE `sync_id`. `mem_session_summary` also stores a searchable `session_summary` observation.
  - T9: the memory server key is `engram` when free or already ours, else `gentle-memory` (agents then get `mcp__gentle-memory__*`); with the engram plugin enabled nothing is registered. The old compiled-`engram` entry from the T3 install is replaced on re-install only if untouched. Install now also refreshes any of our MCP entries that drifted, and removes ours that are no longer wanted.
  - T10: the telemetry installer pieces (hooks, `--no-telemetry`, `state.telemetry`, their tests) landed in the T9 commit `a86c3f0` because they share `installer.js`; the hooks pointed at a not-yet-existing module for that one commit. Hook commands use `env PYTHONPATH=... GENTLE_LITE_STATE_DIR=... python3 -m gentle_lite.telemetry hook` (each assignment shell-quoted when needed). Telemetry is on by default. Hook busy timeout is 500 ms; project is `basename(cwd)` with no git call.
  - Strict TDD: RED observed for each module before implementation (T4b: 6 failing then 7 with registry/stop tests; T9: import errors for store/server/importer, 7 failing installer tests; T10: import error for the telemetry package). Three T4b tests (valid-refs, regression, mode statedir) passed immediately as guards.

- 2026-10-14: RDD for T4b/T9/T10 (per-commit, base = parent):
  - `44538b5` T4b: high → granted → 4 lenses → approved, acknowledged (review-45c015a3a70dde63). 3 warnings (git < 2.24 lacks `--end-of-options`; validateArgs TYPES map only string/boolean; SessionStart without `source`) → T15.
  - `a86c3f0` T9: high → granted → 4 lenses → correction_required: CRITICAL R1-001 `python3 -m` puts hook cwd on sys.path (malicious repo code execution). Correction `a15a063` (detached, cherry-picked to branch as `b4c4e65`): `-P` for memory server and telemetry hook + behavior test planting a fake `gentle_lite` package in cwd (RED observed: marker written; GREEN after). Targeted validator: `-P` fix validated, but rejected overall because the telemetry module was absent in that isolated commit (it lands in `e945363`) → state `escalated`, no receipt. User accepted the escalation. Validator notes → T15: cover the telemetry hook in the -P test and assert exit status; declare Python >= 3.11 minimum.
  - `e945363` T10: high → granted → 4 lenses → approved, acknowledged (review-2bad28a4eb455bde). Warnings: silent event drop under lock contention, unbounded events growth → T11; README claims (split artifact) → T15.
  - `7f32424` docs: passive.

- 2026-10-14: RDD for T11, grouped per user choice (3 candidates instead of 5):
  - `09a00fb..2efa69b` usage + telemetry hardening: high, 784 lines → granted → 4 lenses → approved, acknowledged (review-65922b1c2a3a0360). 5 warnings → T11b.
  - `2efa69b..bcf5e81` portal API/server: high, 1099 lines → granted → 4 lenses → approved, acknowledged (review-0bc563a152cb1c41). 8 warnings (2 are split artifacts: empty UI in that commit) → T11b.
  - `bcf5e81..f92ca9e` UI + node command: high, 590 lines → granted → 4 lenses → approved, acknowledged (review-42108f6b20982cf5). 8 warnings → T11b.
  - `bf7f6ea` docs: passive.
  - Manual check (parent): portal served real backfilled data from a scratch state dir in the built-in browser (Overview, Usage/skills, Memories with 22 Claude file memories); overview 30-day input total (4,481) vs all-time backfill (101,781) explained by the date range, verified with a read-only SQL query.

## Next step

T11b fixes, then T6 SDD, T12 codegraph, T13 graphify, T7 e2e, T14 audit, T15 cleanup.
