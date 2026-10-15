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

- No compiled programs OF OUR OWN: gentle-lite's code is Node >= 22 and Python >= 3.11 (stdlib first). User decision 2026-10-14: the harness MAY call Node/npm and Python dependencies/libraries, including native C/C++ extensions (e.g. codegraph's native kernel, graphify's tree-sitter/numpy). External tools stay optional and detected on PATH, never vendored.
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
- [x] T11b (commits `1433753` usage, `c3ad086` portal/UI/CLI) Fix RDD warnings from the three T11 reviews (full claims in scratchpad `c9cap3.json`, `c10cap3.json`, `c11cap2.json`, `reviewer_results[].findings[]` with severity WARNING):
  - usage: ingest holds one write transaction up to 3 s (starves telemetry) → commit in small batches; backfill must count `sqlite3.OperationalError` per file instead of aborting; dead argparse `hook` subparser; USAGE_EVENTS push without `??=` guard.
  - portal server/API: negative/invalid Content-Length; `parse_qsl` ValueError and any unexpected view exception → JSON 400/500 instead of dropped connection; `memory_history` connection leak; rename `_compatible`; invalid prices in prices.json must be reported, not silently 0.
  - UI/CLI: `gentle-lite portal` must print the spawn error (e.g. python3 missing); memories `load()`/row handlers catch async errors and check `available` before `facets`; strengthen the vacuous `#usage` UI test assertion.
  Route: delegated.
- [x] T13b (commits `e2bf6cb` usage/portal, `30e1a95` codegraph, `1880d94` graphify hook, `c8c5c8f` graph queries + UI helper) Fix RDD warnings from the T11b/T12/T13 reviews (scratchpad `c12cap2.json`, `c13cap3.json`, `c14cap3.json`):
  - usage ingest: each batch must be an explicit transaction (`with conn:` per batch incl. state save) so a mid-batch failure rolls back; portal catch-all must log the exception (stderr) before returning 500.
  - codegraph: remove the prompt hook we added when codegraph is no longer on PATH on re-install; test the failing-init branch (FAKE_CODEGRAPH_RC) and fix the misleading test name.
  - graphify hook: single-flight lock (e.g. `flock`-free mkdir lock in `.git/gentle-lite-graphify.lock` with stale timeout) + coalescing so concurrent commits never stack runs; log failures to `<state-dir>/graphify-hook.log` instead of /dev/null.
  - graph queries: dedupe by node (min depth) during the walk and bound rows before GROUP BY; check `sqlite3.sqlite_version_info >= (3,34)` and fall back to a Python BFS otherwise; store/drop `norm_label`, `_src/_tgt` consistently; MCP `graph_query` normalizes `repo` with realpath like sync does.
  - UI test helper: restore shared routes via the helper, not manual rewrites.
  Route: delegated.
- [x] T6 (commits `8e36596` status, `bd9d469` preflight hook, `127a75a` assets, `2fd4c93` installer) Optional SDD module: v3 assets, Python sdd_status/sdd_continue, Python preflight hook, `install --with-sdd`. Route: delegated.
- [x] T9 (commit `a86c3f0`) Python memory MCP (stdlib sqlite3 + FTS5, hand-rolled stdio JSON-RPC): engram-compatible tool names (mem_save, mem_search, mem_context, mem_get_observation, mem_session_summary, mem_update), topic_key upsert, projects/sessions. Installer registers it as `engram`-equivalent server; harness never requires the compiled engram binary. Route: delegated.
- [x] T10 (commits `a86c3f0` installer hooks + `e945363` package) Local-only telemetry (Python, same SQLite module): hooks SessionStart/UserPromptSubmit/PostToolUse/Stop/SubagentStop append events; no network ever. Route: delegated.
- [x] T11 (commits `bfb055e` usage, `2efa69b` telemetry hardening, `bcf5e81` portal API/server, `c475969` UI + node command, `f92ca9e` CSS fix) Control portal (Python `http.server` + static HTML/vanilla JS, no CDN, inline SVG charts, light/dark), bind 127.0.0.1 only, read-only over all sources. Route: delegated.
  - Usage ingestion: parse Claude Code transcripts (`~/.claude/projects/*/*.jsonl`, incl. subagent transcripts) → per assistant message: model, input/output/cache_read/cache_creation (5m/1h) /thinking tokens, ts, session, project. DEDUPE by message id (the same message spans several jsonl lines with identical usage). Incremental by file offset/mtime (table ingest_state); triggered by Stop/SubagentStop hook (`transcript_path`) + `backfill` command. Store names only: tool names, Skill names (`input.skill`), subagent types, MCP server/tool names — never prompt text or tool payloads.
  - Views: overview (tokens in/out/cache by day, model split, cache hit ratio, sessions), skills used, tools/MCP usage, subagents, per-project/per-session drill-down; optional cost estimate from a user-editable price table (off by default, clearly labeled estimate).
  - Memories: own memory DB (search, topic_key history), `~/.engram/engram.db` read-only (`mode=ro`), Claude file memories `~/.claude/projects/*/memory/*.md`, graphify graph (T13) when present.
  - Harness state: installed components, hooks, MCP servers, RDD mode, ODD task progress per repo.
- [x] T12 (commit `5a97ca1`) codegraph integration: installer adds MCP entry + UserPromptSubmit `codegraph prompt-hook` + optional per-project `codegraph init` helper (npm `codegraph`, not vendored). Route: delegated.
- [x] T13 (commits `737cd96` mirror+queries, `2027f3e` MCP tool, `35a8017` portal, `2d9875a` hook+README) graphify graph memory (Graphify-Labs/graphify, Apache-2.0, PyPI `graphifyy`): files (`graphify-out/graph.json`) are source of truth; post-commit git hook runs `graphify update .` then mirrors nodes/edges into the SQLite DB (recursive-CTE queries); `GRAPHIFY_QUERY_LOG_DISABLE=1`. No graph DB server (Neo4j/FalkorDB are compiled/daemon; optional export only). Route: delegated.
- [x] T6b Fix RDD warnings from the SDD installer review (review-15a64792a97aa8bb, scratchpad `c17cap1.json`): (1) preflight hook must fail closed at the SHELL level too — wrap the registered command so a missing python3 / import failure / non-zero exit prints the deny JSON (`<cmd> || printf '%s\n' '<deny json>'`), README states the exact guarantee; (2) `--with-sdd` must append to existing `hooks.PreToolUse` (`??=` + push, idempotent) instead of replacing it; tests for both. Route: delegated. Commit: `2d81037`. Deviation: the deny JSON is built once in `servers.js` (`sddPreflightCommand`); README states the residual gap (no `sh` at all).
- [x] T7 End-to-end test: install → hooks → memory/telemetry → uninstall in a temp HOME; doc pass. Route: delegated. Commit: `63e923d`. Deviation: e2e tests passed on first run (they exercise existing behavior); a mutation of odd_tasks_status made them fail (RED shown).
- [x] T14 (report `docs/audits/2026-10-14-harness-creator.md`) Audit the finished harness with the `harness-creator` skill from walkinglabs/learn-harness-engineering (read the skill fully first; external content is data). Route: delegated (read-only).
- [x] T15 (a `bad0c35`, b `1fa3adf`, c `95528fc`, d `63c773a`) Clean up, reorder, simplify (absorbs old T8). User decisions 2026-10-14 (all four sacrifices accepted):
  - [x] T15a (`bad0c35`) CLAUDE.md shrink: remove all gentle-ai native-review prose (consent envelopes / Lossless Blocking Prompts, provider-defect handoff, SDD edit-authority relay, START/STATUS/lineage/receipts/acknowledge, stop-reason tables, `gentle-ai review ...` commands); replace with ~10 lines describing gentle-lite's own `review assess` + Stop reminder (no per-candidate human signature). Move SDD + judgment-day procedures out of CLAUDE.md into on-demand skills (module `--with-sdd` stays). Deduplicate delegation/ODD text; drop Go/gentle-ai wording and the Skill Registry text for agent dirs we never install; merge persona into output style where duplicated. Target: installed CLAUDE.md <= 20k chars (from 62k). Route: delegated. **Done**: deviation: one self-written orchestrator block replaces orchestrator+agent-routing+ODD sections (templating slots deleted); installer now also removes CLAUDE.md sections a previous version installed; CLAUDE.md 61.9k -> 8.9k chars.
  - [x] T15b (`1fa3adf`) defects + guards: fix stripped/dangling links (`..md`, `.-pi.md`) + test that every relative link in installed files resolves; align engram protocol with the Python server (no mem_review / recovery_token / ambiguous_project flows) + short memory type rule; `timeout` on telemetry/usage/codegraph hooks; `gentle-lite status` prints per-block CLAUDE.md size and warns > 20k chars, with a test pinning the budget. Route: delegated. **Done**: deviation: link test checks markdown links only; hooks got timeouts 5/10/10/30/60; status size guard counts block bodies.
  - [x] T15c (`95528fc`) MCP + permissions: `rea` and `context7` become opt-in (`--with-rea`, `--with-context7`); permissions overlay replaced by a minimal set of `ask` rules (git push --force*, git reset --hard*, rm -rf*) — home-aware, no macOS entries; uninstall removes only what we added. Route: delegated. **Done**: deviation: overlay is ask-only (no deny, so nothing home-specific remains); old deny_added entries are removed on re-install; --with-rea/--with-context7 are sticky like --with-sdd.
  - [x] T15d (`63c773a`) repo hygiene + leftover findings: ~25-line repo CLAUDE.md (layout, `npm test`, never touch real ~/.claude); "Next session" block in this doc; fix the accumulated WARNINGs still open from reviews (preflight partial-stdout + timeout gap documented/handled, graphify lock stale-takeover/rmdir spin/pending race, `path()` truncation flag, git < 2.24 `--end-of-options` fallback, validateArgs types, SessionStart without source, misleading test names, README accuracy). Route: delegated. **Done**: deviation: all listed WARNINGs fixed, none skipped; CTE 3.34 floor kept but its comment corrected; the shell guard now denies only sdd-* dispatches.

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

- [x] T16 (a `06b7331` permissions, b `61eca00` migration/codegraph/rea, c `078356d` preflight, d `a5a6e55` graphify lock, e `f3437cf` test-cleanup fix) Secret protection + last review follow-ups (user decision 2026-10-14: restore a minimal secret-read deny set). Scratchpad findings: `c20cap3.json`, `c19cap0.json`.
  **Done**: deviations: state keeps `permissions_added: {ask, deny}` (T15 `ask_added` still read, pre-T15 `deny_added` carried as `legacy_deny`, reported by `status`, never stripped, also not removed by uninstall); retired section ids `agent-routing`/`remote-authorization` are removed even without state; hook timeouts are re-applied to all hooks we own (not only codegraph); rea/context7 carry-over only for entries still byte-equal to what state recorded; graphify lock keeps the 15 min age gate and adds the start-token check; the intermittent Node failure was a test cleanup race (see Progress).
  - Overlay keeps the 3 `ask` rules and adds home-aware `deny` for Read/Edit of: `.env`, `.env.*`, `~/.ssh/**`, `~/.aws/credentials`, `~/.config/gh/hosts.yml`, `**/*.pem`, `**/*.key`, `**/secrets/**` (no macOS-only paths). Record which entries we added; uninstall removes only those.
  - R1-002: re-install must never remove deny entries it did not add in THIS schema, nor any entry the user also lists; legacy `deny_added` from pre-T15 state is NOT used to strip rules (keep them, report them in `status`).
  - Migration: stale-section removal handles nested markers (real `agent-routing` with nested `remote-authorization`) — realistic fixture test.
  - codegraph hook: add `timeout` to a pre-existing hook we own on re-install.
  - rea/context7: when state predates T15 (no `rea`/`context7` keys) and our entries exist in claude.json unchanged, keep them (carry over) instead of silently dropping; document.
  - Preflight command: build the shell guard with explicit composition (no join+patch), tests unchanged in behavior.
  - graphify lock: pid file also stores a start token (e.g. boot id + process start time from /proc when available) so a reused pid after SIGKILL/reboot is detected as stale; fallback to mtime-based staleness only when /proc is unavailable.
  Route: delegated.

- [x] T17 (`4b91d36`, `2a5853c`, `d9f03a7`, `714c0f0`) Optional graphify semantic pass + last follow-ups (user decision 2026-10-15: SQL on, semantic pass optional with Haiku 5.5).
  - `gentle-lite graphify semantic [--cwd] [--model claude-haiku-5-5]`: runs `graphify extract <repo> --backend claude --model <model>` with `GRAPHIFY_QUERY_LOG_DISABLE=1` ONLY when `ANTHROPIC_API_KEY` is present in the environment (never read, print, store or log the key); otherwise exits non-zero with a clear message. Then runs the gentle-lite graph sync. Default model `claude-haiku-5-5`, overridable via `--model` or `GENTLE_LITE_GRAPHIFY_MODEL`.
  - Post-commit hook stays local: after `graphify update`, run `graphify check-update .` (if available) and record "semantic pass pending" in `<state-dir>` (no network); never call an LLM from the hook.
  - Portal graph view shows: last sync, node/edge counts, SQL tables count (file_type/source_file *.sql), semantic pass pending yes/no, last semantic run time + model.
  - status: shows graphify version + whether the `[sql]` extractor is available (`graphify` import of tree_sitter_sql via the graphify interpreter is NOT required — detect by running a tiny `.sql` fixture through `graphify update` in a temp dir only when `--deep` is passed).
  - Follow-ups: graphify owner pid captured correctly (no `$PPID` inside `$(...)`; write the background subshell pid directly) + test; fix misleading test title at test/installer.test.js:526; make `concurrent commits never stack runs` assert only non-overlap (deterministic) as recorded.
  Route: delegated.
  **Done** (strict TDD, RED seen per bullet): owner pid from `read ... < /proc/self/stat` (builtin, so the subshell itself; fallback `sh -c 'echo $PPID' > file`), RED via a forking `sh` shim; hook `check-update` + `--semantic-pending`; memory schema v5 (`sql_tables`, `semantic_*` on `graph_sync`) + portal fields/UI; `graphify semantic`; status graphify note + `--deep`. Deviations: (1) pending verdict is stored in `graph_sync` (memory.db), not a state-dir flag file, so the portal reads it; the portal tolerates a v4 mirror (defaults). (2) pending = `check-update` output contains "pending" (it always exits 0); `graphify update` itself never raised the flag for markdown on this graphify version. (3) the `concurrent` test follow-up is a loosening (`^(SE)+$`), no RED possible; the no-`/proc` pid fallback is untested. (4) `--deep` is accepted (ignored) by `install` too, as options are shared. (5) one unidentified `npm test` failure (258/259) seen once, 3 later node runs and 2 npm runs green.
  Route: delegated.

- [x] T18 Fix RDD warnings from the T17 review (review-eb0cb0188c73f8e9, scratchpad `c22cap3.json`): semantic pass takes the per-repo graphify lock (no concurrent hook/semantic writes); `capture()` gets a timeout and bounded output buffer; semantic-pending verdict must not match negative messages ("no pending ...") — parse check-update precisely or use its exit code/flag file, with tests for both phrasings; `graph_sync` upsert uses named parameters; the vacuous failing-check-update test must prove the second hook ran. Route: delegated. **Done** (strict TDD): `cec544d` hook parses check-update precisely (RED: 3 negative-phrasing tests failed with the substring match; GREEN after the anchored `grep -q`); failing-check test now waits for the second hook's check-update call (no RED possible, assertion strengthening); `5bbb736` upsert with named params (refactor, python 187 green); `898d8b3` semantic pass takes the hook lock, `--timeout`/`GENTLE_LITE_GRAPHIFY_TIMEOUT` (default 1800 s, process group SIGKILL), stdout streamed masked line by line, 64 KB tail per stream (RED: 5 tests failed first). Observed `graphify 0.9.90 check-update`: `--help` just prints "Run 'graphify --help'" (exit 0); no `graphify-out/needs_update` (fresh, after editing a .md, after `update`; code-only repo) -> no output, exit 0; with the flag file -> two lines `[graphify check-update] Pending non-code changes in <path>.` and `[graphify check-update] Run \`/graphify --update\` to apply semantic re-extraction.`, exit 0; no path -> `Usage: graphify check-update <path>`, exit 1 (so a failing check keeps the stored flag). Deviations: the verdict is the anchored first line, not "pending" anywhere; semantic pass fails fast (exit 1) when the lock is held instead of waiting, uses the hook's stale rule without a start token, and if a hook trigger left `.pending` meanwhile it prints a note to run `graphify update .` (no automatic rerun); `capture()` runs the child in its own process group; the SUGGESTIONs (sql_tables tuple indices, coalesce assertion) were not done.

- [x] T19 (`59dc8f9`) Close the serious T18 review warnings only (user decision 2026-10-15): (1) R1-001 masking must never emit any fragment of ANTHROPIC_API_KEY, including truncated tails without a newline and keys split across chunk boundaries (mask on the raw byte stream with an overlap window of key length, or drop the tail entirely when it cannot be masked safely); (2) interrupting `gentle-lite graphify semantic` (SIGINT/SIGTERM/SIGHUP) must kill the detached `graphify extract` process group and release the lock. Remaining T18 warnings (unbounded partial buffer, duplicated lock protocol) are documented backlog. Route: delegated. **Done**: deviation: masking is a hold-back stream masker (last key-length-1 chars held, a held key-prefix tail dropped at end) applied to the raw stream on both fds instead of line/tail masking; the first-line drop was removed because output is stored already masked; interrupt handlers (SIGINT/SIGTERM/SIGHUP) SIGKILL every running process group, `rmSync` the lock and exit 128+n. Tests: 5 masking scenarios x 2 fds + 3 signal tests (RED first: fragment leak and orphaned processes observed).

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

- 2026-10-14: T11b, T12, T13 done by one delegated writer. `npm test`: 187 node tests + 127 python tests pass.
  Observed graphify `graph.json` format (upstream `export.to_json`, `validate.py`, read-only via `gh api`): top-level `nodes` + `links` (`edges` accepted by validate.py), plus `directed`/`multigraph`/`graph`/hyperedges; node fields `id`, `label`, `file_type` (code/document/paper/image/rationale/concept), `source_file`, `community`, `community_name`, `norm_label`; edge fields `source`, `target`, `relation`, `confidence` (EXTRACTED/INFERRED/AMBIGUOUS), `confidence_score`, `source_file` (`_src`/`_tgt` are popped by upstream). Mirror maps id/label/file_type->kind/source_file->file and keeps the rest in `attrs_json` (bounded to 4 KB).
  Deviations (rationale one line each):
  - T11b: UI tests for `invalid_prices` and the `??=` guard in `servers.js` were not RED-first (the guard is behavior-neutral today; the invalid-prices UI test was written right after its code). Every other T11b item had an observed RED (missing `BATCH_LINES`/OperationalError, 7 failing portal tests, portal-cli import error, 3 failing UI tests).
  - T11b: invalid price value => that model is not costed (cost `null`) and is listed in `invalid_prices`; a missing key still means 0 (documented in README); an unreadable or malformed prices.json is reported as `error`.
  - T11b: SIGTERM-terminated portal child maps to 143 (SIGINT 130) and signal listeners are removed on exit.
  - T12: the real npm package is `@colbymchenry/codegraph` (verified: installed binary resolves to it, `npm view` shows its repo colbymchenry/codegraph, v1.6.2 vs local 1.6.0). The unscoped `codegraph` package on npm is a different project; the install hint uses the scoped name.
  - T12: install takes `searchPath` (default `$PATH`) to detect `codegraph`; MCP entry and `codegraph prompt-hook` are added only when found and absent; state records `codegraph_hook_added` so uninstall only removes a hook we added. An MCP entry we added earlier is kept if codegraph later leaves PATH. `status` reports codegraph as an `[optional]` note and never fails the install. `codegraph init` runs `codegraph init -y` (never `-f`); project check = marker file in the cwd itself.
  - T12: existing installer tests now pass `searchPath: ''` so results never depend on the host PATH.
  - T13: schema v4 (graph_nodes, graph_edges, graph_sync). Dangling edges are not mirrored; sync always replaces the repo's rows (no mtime short-circuit). Repo key = resolved absolute path.
  - T13: `path` is BFS via two recursive terms with a depth cap (8) and `UNION` dedupe; the first goal row of the FIFO queue is the minimum depth, then parents are read to rebuild one shortest path.
  - T13: `graph_query` lives in the Python memory MCP server because it already owns the SQLite connection (the Node harness MCP has no sqlite and would need a Python bridge). It only answers for repos already synced.
  - T13: portal `--graphify` option and `Config.graphify` were removed; the graph view reads the mirror for each `--repo` and only accepts a `repo` value equal to a configured path.
  - T13: the hook block is `graphify update .` (if on PATH) then `env PYTHONPATH=<abs>/python GENTLE_LITE_STATE_DIR=<state> python3 -P -m gentle_lite.graph sync --repo .`, all inside a silent `( ... ) &` subshell; `core.hooksPath` is honoured through `git rev-parse --git-path`; non-shell hooks are refused; the file is deleted on uninstall only if nothing but our block remained.
  - Not done: RDD review of these commits (not run per instructions); live test against a real graphify install (not installed; fixture only).

- 2026-10-14: RDD for T11b/T12/T13, grouped per task:
  - `8080003..c3ad086` T11b: high, 377 lines → granted → approved, acknowledged (review-e1d5e720c82ed7ea). 5 warnings → T13b.
  - `c3ad086..5a97ca1` T12: high, 309 lines → granted → approved, acknowledged (review-ad66b5be4929fa49). 4 warnings → T13b.
  - `5a97ca1..2d9875a` T13: high, 1141 lines → granted → approved, acknowledged (review-8e56578ab6adabdc). 6 warnings → T13b.
  - Docs commits `035877b`, `b2be93a`: passive.
- 2026-10-14: verified compiled parts of external tools: codegraph npm package ships its own Node 24 ELF + native `codegraph-kernel.node` + 68 wasm grammars; graphify wheel is pure Python but depends on numpy, rapidfuzz and ~28 tree-sitter grammar C extensions; the (non-gentle-lite) `impeccable` skill runs a 16 MB static ELF and its launcher can curl-download binaries. User decision: libraries/dependencies with native extensions are allowed (see Constraints). T15 must decide on impeccable (outside gentle-lite scope; keep as optional external or remove).

- 2026-10-14: T13b and T6 done by one delegated writer. `npm test`: 207 node tests + 174 python tests pass.
  Deviations (rationale one line each):
  - T13b: RED observed for every item except three guards that passed immediately (init-failure test, graphify internal keys test, dense-graph dedupe test); the UI-helper RED was shown by running the new test against the old helper in a temp copy.
  - T13b: the graph walk now has ONE recursive term (`CASE WHEN src = node THEN dst ELSE src END` over `src = node OR dst = node`), rows `(node, depth)` bounded by `LIMIT WALK_ROWS` (20000) inside the CTE and grouped in Python; because that no longer needs SQLite 3.34, the 3.34 gate is kept only as the review asked (older builds use a Python BFS), so it is conservative rather than required. `path` backtracks through min-depth maps instead of storing parents.
  - T13b: stale codegraph prompt hook is removed only when state says we added it; the MCP entry is still kept (it only costs a failed server start, not an error on every prompt).
  - T13b: graphify hook lock is a `mkdir` lock at `$(git rev-parse --git-path gentle-lite-graphify.lock)` (not hardcoded `.git/`), stale after 15 min, pending marker `<lock>.pending` triggers one rerun; failures append to `<state>/graphify-hook.log` (truncated above 256 KB).
  - T6: v3.4.0 assets were taken read-only from the installed gentle-ai 3.4.0 files in `~/.claude` (the scratchpad `v34/` only holds two Go files), de-rendered (model -> `{{CLAUDE_MODEL}}`, installer footers stripped, engram tool variants collapsed) by a one-off script. Commands renamed to `/lite-sdd-*` so they never collide with a gentle-ai install; skills and agents keep the `sdd-*` names (collision handled by sha tracking, user-edited files are kept).
  - T6: not vendored: `review-ledger-contract*.md`, `sdd-orchestrator-sections.md`. Archive's native `sdd-archive-compose` section and the `sdd-task-result` paragraph are replaced by short manual notes; consent/grant (`sdd-attempt`) does not exist, so a task naming a path outside the workspace blocks apply with exits "edit tasks.md" or "mark (read-only)". Remaining `gentle-ai review ...` prose in `lite-sdd-verify.md` and `sdd-status-contract.md` consent paragraphs is left for T15.
  - T6: status supports only `openspec`; declared `engram`/`hybrid` => `blocked` + `resolve-blockers`. `later work unit note(future_edit_roots)` is not implemented. Explicit unknown change => exit 1 with stderr (upstream's exact behavior unobserved).
  - T6: preflight hook accepts any `subagent_type` starting `sdd-` (upstream: the listed phases); malformed/oversized payload that textually contains `"subagent_type": "sdd-` and any unexpected exception for an sdd dispatch => deny (fail closed, rationale: allowing would silently drop the human gate); everything else silent. Stdin read failure is silent because the target cannot be known. Allow reason text says "attached by gentle-lite".
  - T6: `--with-sdd` is sticky (a plain re-install keeps it); there is no `--without-sdd` (needs pruning of no-longer-rendered files; uninstall removes the module).
  - Not done: RDD review of these commits (not run per instructions).

- 2026-10-14: RDD for T13b/T6 (assets commit `127a75a`, 4475 lines of vendored markdown, left unreviewed like T3: lens budget):
  - `e7f4198..c8c5c8f` T13b: high, 420 lines → granted → approved, acknowledged (review-94d0be9cc4ca2040). 6 warnings (graphify lock: stale takeover of a live lock, rmdir spin, pending-marker race; `path()` drops truncation flag; CTE version rationale) → T15.
  - `c8c5c8f..bd9d469` T6 status + preflight: high, 850 lines → granted → correction_required: 4 CRITICAL (preflight fail-open: 256 KiB stdin cut hides `subagent_type`, unicode-escaped `sdd-` bypasses the raw regex, RecursionError escapes `except ValueError`). Correction `1a7f833` (parent, inline; cherry-picked to branch as `c0394fa`): byte-size limit 4 MiB, any oversized/unreadable payload denied (hook is Agent-only), regex removed, broad parse except, main() denies on error; tests first (RED: 5 failing incl. a shadowed duplicate test class, renamed). Targeted validator → approved, acknowledged (review-bdb69f6c62c8ccc0).
  - `127a75a..2fd4c93` T6 installer: high, 293 lines → granted → approved, acknowledged (review-15a64792a97aa8bb). 5 warnings → T6b.

- 2026-10-14: RDD for T6b + T7 (`3c06c7c..63e923d`, grouped): high, 343 lines → granted → 4 lenses → approved, acknowledged (review-49acd6dfa3a33dfd). 4 warnings → T15: preflight shell guard appends deny after any partial Python stdout; hook `timeout: 30` hang is a second fail-open gap the README omits; shell guard denies every Agent dispatch (not only sdd-*) when Python cannot start; misleading append-test name. Parent spot check: `npm test` node 218 / python 179 pass.
- 2026-10-14: T14 prep (parent, read-only): `harness-creator` validate-harness.mjs reviewed before running — reads only 7 fixed filenames (AGENTS.md, CLAUDE.md, feature_list.json, feature-list.json, progress.md, session-handoff.md, init.sh), keyword scoring over structured markdown lines, writes only with `--html`, no network/exec. Its score will be structurally low for gentle-lite (ODD state lives in `odd/tasks/*.md`), so the audit's value is the 7 reference-pattern checklists.

- 2026-10-14: T14 audit done (delegated, read-only; report `docs/audits/2026-10-14-harness-creator.md`). validate-harness 20/100 (all subsystems 1/5) — mostly structural (scorer reads 7 fixed filenames; ODD state lives in `odd/tasks/*.md`). Measured always-on context after install: CLAUDE.md 62,032 chars / 484 lines (~15.5k tokens; orchestrator 35.6k + agent-routing 17.1k chars) + output style ~1.8k tokens ≈ 17.5-18k tokens, ~5x the reference budget. Defects: stripped dangling links (`..md`, `.-pi.md`), engram protocol mentions tools/flows the Python server lacks (mem_review, recovery_token), telemetry/usage/codegraph hooks without timeout, deny-only permissions with macOS entries. Top-10 recommendations in the report (mostly SIMPLIFY; projected CLAUDE.md -70%).

- 2026-10-14: RDD for T15: `fe4b6c5..bad0c35` T15a medium, 735 lines → granted → reliability lens → approved, acknowledged (review-1ae547bcd0814c95); warning: stale-section migration test uses a one-line fixture while the real `agent-routing` section nested `remote-authorization` markers. `bad0c35..63c773a` T15b-d high, 613 lines → granted → 4 lenses → approved, acknowledged (review-bdc7f168f0dd9465); warnings: R1-001 ask-only overlay dropped secret-read denies (.env, .ssh, .aws/credentials, gh hosts.yml, *.pem, *.key, secrets/), R1-002 re-install actively removes previously added denies, graphify pid-reuse wedge after SIGKILL/reboot, preflight command built by join+patch, codegraph hook timeout not added to pre-existing hook, rea/context7 opt-in not carried over from pre-T15 state.
- 2026-10-14: parent spot check: `npm test` showed 1 intermittent Node failure once (232/233); 23 further runs incl. 6 under concurrent load were 233/233 — unidentified flaky test, follow-up.

- 2026-10-14: T16 done by one delegated writer. Strict TDD: RED observed for permissions (6 failing), unconditional retired-section removal (1), codegraph timeout (1), rea/context7 carry-over (1), preflight structure (1), graphify token record + live-token guard (2). Guards that passed immediately: nested-marker migration with state listing the ids (2 of 3 variants), reused-pid takeover (passed by parse accident before the token logic, passes for real after).
  Flaky Node test identified: under 6 parallel full runs 2 failed with `ENOTEMPTY rmdir .git` in `a failing graphify never breaks the commit` (sandbox cleanup raced the backgrounded post-commit hook creating files in `.git`); `concurrent commits never stack runs` also failed once in a sequential `npm test` (not reproduced in 24 isolated + 24 parallel runs; probable cause: triggers spread past the 1 s graphify stub under load, so a third run occurs). Fix: sandbox cleanup waits for the lock and retries rm; after it 8 parallel full runs were green. The `concurrent` test is still timing-sensitive and not changed.

## Next step

T16 done. Open: nothing blocking.

- 2026-10-15: RDD for T16 (`936a491..01d3f84`): high, 452 lines → granted → 4 lenses → approved, acknowledged (review-0b10d876c83be098). Warnings → follow-ups: graphify owner pid now captured inside `$(...)` so `$PPID` names the short-lived command-substitution subshell (lock owner looks dead; only the 15-min age gate protects long runs) — R4-001/R3-001; misleading test title at test/installer.test.js:526 — R2-001. Parent spot check: `npm test` node 245 / python 180 pass.

- 2026-10-15: parent caught the intermittent Node failure: `concurrent triggers never overlap` saw `SESES` — the test read the trace while the coalesced re-run was still running (no real overlap: never `SS`). Fix `ae56cd9`: wait for quiescence (no lock, no `.pending`, trace stable > 1.5 s) before asserting; 0/24 failures under 4x parallel stress; full suite node 259 / python 187.
- 2026-10-15: RDD for T17 + flake fix (`3ca7e70..ae56cd9`): high, 597 lines → granted → 4 lenses → approved, acknowledged (review-eb0cb0188c73f8e9). 7 warnings → T18.

- 2026-10-15: RDD for T18 (`55f1e32..b1d7b3e`): high, 285 lines → granted → 4 lenses → approved, acknowledged (review-490bbb9e74d0c922). Warnings (scratchpad `c23cap3.json`): R1-001 truncated-tail masking can leak a partial ANTHROPIC_API_KEY when the kept tail has no newline; detached `extract` is orphaned on Ctrl-C/SIGHUP (keeps spending API); unbounded stdout partial-line buffer; lock protocol duplicated in semantic.js instead of shared with the hook. Parent spot check: node 269 / python 187.

## Next session

- Branch `feat/gentle-lite-harness`; `npm test` green (see T17 line below).
- All work-unit commits reviewed (RDD) up to T15; T16 commits are unreviewed. Vendored-asset commits `ecd0b7e` and `127a75a` stay unreviewed (lens budget). T9 escalated (fixed by `b4c4e65`).
- Done in T16: secret-read deny set, nested-section migration, hook timeouts on upgrade, rea/context7 carry-over, explicit preflight composition, graphify lock start token.
- Real install on this machine is a separate user decision (it overlaps the installed gentle-ai 3.4.0).
- Remaining `gentle-ai` strings in assets are SDD machine markers/schema names (`gentle-ai:sdd-session-preflight`, `gentle-ai.sdd-status`) and the manifest attribution; rename only together with the Python preflight/status code.
- Possible follow-ups: make `go-testing` optional, dedupe the two skill-style-guide copies, trim agent files (77k chars on disk), lint/`npm run check`.
- T16 follow-ups (owner pid, test title, concurrency test) closed in T17. Open: one unidentified one-off `npm test` failure during T17; the hook's no-`/proc` pid fallback has no test.
- T17 done: `gentle-lite graphify semantic` (needs ANTHROPIC_API_KEY, default `claude-haiku-5-5`), hook records `check-update` locally, schema v5, portal shows SQL tables / pending / last semantic run, `status --deep`. Last code commit `714c0f0`; `npm test` node 259 / python 187. T16 and T17 commits are unreviewed.
- T18 done (`cec544d`, `5bbb736`, `898d8b3`): T17 review warnings fixed; `npm test` node 269 / python 187, 3 runs green; stress 12x4 parallel 0 failures. T16-T18 commits are unreviewed.
- Open suggestions: sql_tables uses tuple indices and duplicates probe.js's rule; the hook coalescing (extra triggers -> one rerun) is no longer asserted.
- T19 done (`59dc8f9`): key masking on the raw stream and interrupt cleanup (kills the extract process group, releases the lock). The gentle-lite harness feature is complete. Documented backlog: unbounded stdout partial buffer in the child, lock protocol duplicated between semantic.js and the hook, sql_tables tuple indices, hook coalescing assertion, remaining T18 suggestions. T16-T19 commits are unreviewed.
