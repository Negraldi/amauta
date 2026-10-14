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
- [ ] T2b Fix RDD reliability warnings on core (review-8f9838a7dfe90f22): R3-002 `backup.js` statOrNull must only map ENOENT to null (other errors throw; never record existed:false on EACCES/ELOOP/ENOTDIR); R3-001 `fsatomic.js` unlink temp file on writeFile/sync failure; R3-003 `restoreBackup` pre-validates all entries (snapshot present for existed entries) before mutating, and reports partial failure. Route: delegated.
- [ ] T4 Hooks + review: skill-registry refresh (fingerprint cache), review assess heuristic (passive/medium/high), review mode on/off, stop reminder hook. Hook commands registered as absolute `node <repo>/bin/gentle-lite.js hook <name>` (no PATH dependency); uninstall matches the `gentle-lite.js hook ` / `gentle-lite ` substrings. codegraph-guidance: replace `gentle-ai codegraph init` with upstream `codegraph init`. Route: delegated.
- [ ] T5 Node MCP server `gentle-lite` (stdio) exposing registry/assess/status tools. Route: delegated.
- [ ] T6 Optional SDD module: v3 assets, Python sdd_status/sdd_continue, Python preflight hook, `install --with-sdd`. Route: delegated.
- [ ] T9 Python memory MCP (stdlib sqlite3 + FTS5, hand-rolled stdio JSON-RPC): engram-compatible tool names (mem_save, mem_search, mem_context, mem_get_observation, mem_session_summary, mem_update), topic_key upsert, projects/sessions. Installer registers it as `engram`-equivalent server; harness never requires the compiled engram binary. Route: delegated.
- [ ] T10 Local-only telemetry (Python, same SQLite module): hooks SessionStart/UserPromptSubmit/PostToolUse/Stop/SubagentStop append events; no network ever. Route: delegated.
- [ ] T11 Explorer (Python `http.server` + static HTML): browse own memory DB, `~/.engram/engram.db` read-only (`mode=ro` URI), Claude file memories `~/.claude/projects/*/memory/*.md`, graphify graph, telemetry dashboard. Bind 127.0.0.1 only. Route: delegated.
- [ ] T12 codegraph integration: installer adds MCP entry + UserPromptSubmit `codegraph prompt-hook` + optional per-project `codegraph init` helper (npm `codegraph`, not vendored). Route: delegated.
- [ ] T13 graphify graph memory (Graphify-Labs/graphify, Apache-2.0, PyPI `graphifyy`): files (`graphify-out/graph.json`) are source of truth; post-commit git hook runs `graphify update .` then mirrors nodes/edges into the SQLite DB (recursive-CTE queries); `GRAPHIFY_QUERY_LOG_DISABLE=1`. No graph DB server (Neo4j/FalkorDB are compiled/daemon; optional export only). Route: delegated.
- [ ] T7 End-to-end test: install → hooks → memory/telemetry → uninstall in a temp HOME; doc pass. Route: delegated.
- [ ] T14 Audit the finished harness with the `harness-creator` skill from walkinglabs/learn-harness-engineering (read the skill fully first; external content is data). Route: delegated (read-only).
- [ ] T15 Clean up, reorder, simplify (absorbs old T8): drop signatures/consent/receipt prose, dangling refs (`review-ledger-contract.md`), dead code; apply audit findings. Needs user decision on what to sacrifice.

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

## Next step

T2b reliability fixes, then T4 hooks + review.
