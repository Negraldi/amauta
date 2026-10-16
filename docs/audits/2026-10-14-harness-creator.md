# T14 audit: amauta vs harness-creator (walkinglabs/learn-harness-engineering, MIT)

Method: validate-harness.mjs (json, no --html) on the repo; SKILL.md + 7 references read fully; sandbox install (temp dirs, deleted afterwards) to measure what is injected. Read-only: nothing in the repo or in the real ~/.claude / ~/.gentle-ai / ~/.engram was touched. Token figures are chars/4 estimates.

## Summary

- validate-harness: overall 20/100; every subsystem 1/5 checks "0 passed" (score 1 = floor). Bottleneck reported: `instructions`. The score is almost entirely a naming artifact: the script looks for 7 fixed filenames (AGENTS.md/CLAUDE.md, feature_list.json, progress.md, init.sh, session-handoff.md ...) and amauta has none of them. The repo does carry the equivalent state (odd/tasks/amauta-harness.md, 221 lines) and verification (npm test).
- Real repo gaps are 3: no repo-level CLAUDE.md/AGENTS.md (a fresh agent has only README.md to start from), the task document has no "Next session should / blockers" handoff block as the single restart pointer (progress lines are append-only, T-list is long), and no one-command verify (npm test exists but is only documented under README "Tests"; no fail-fast chain with lint/static check).
- Harness design (what install injects): the single dominant finding is context size. Always-on injected text = 62,032 chars / 484 lines of CLAUDE.md (~15.5k tokens) + 7.1k-char output style (~1.8k tokens) + ~1.7k chars of skill descriptions = about 17.5-18k tokens before the user's first word. The reference's own budget template is 2,000 (system) + 3,000 (instruction files). We are ~5x over its instruction-file budget, and ~2/3 of it (orchestrator 35.6k chars + agent-routing 17.1k chars = 85% of the block) is dead or duplicated prose from gentle-ai (consent envelopes, lineage/receipts, Go-only terminal procedures, `gentle-ai review ...`), contradicting the repo's own scope ("Out: consent envelopes, lineage/receipts/burn").
- Strengths vs references: fail-open/fail-closed hook design is deliberate and tested; hooks are small and fast (21-83 ms measured); permissions never sets defaultMode and unions the deny list; memory is a bounded SQLite store with topic_key upsert (two-step-save invariant not needed); skills use progressive disclosure; subagent tool sets are filtered (review lenses `tools: []`).
- Real defects found while measuring: (a) installed `skills/judgment-day/SKILL.md:53` and `skills/_shared/README.md:11` contain `..md` / `.-pi.md` (a broken link whose file name was stripped at install; source asset points at the not-vendored `review-ledger-contract.md`); (b) the engram protocol block tells the model to call `mem_review`, `mem_judge`-style flows and a `recovery_token`/`available_projects` flow that the Python memory server does not implement (it exposes mem_save/update/search/context/get_observation/session_start/session_end/session_summary/save_prompt/current_project + graph_query); (c) three always-on hooks (telemetry, usage, `codegraph prompt-hook`) have no `timeout`.

## Part 1: the repository as an agent-workable project

validate-harness output (verbatim scores):

| Subsystem | Score | Passed |
|---|---|---|
| instructions | 1 | 0/5 |
| state | 1 | 0/5 |
| verification | 1 | 0/5 |
| scope | 1 | 0/5 |
| lifecycle | 1 | 0/5 |
| overall | 20 | bottleneck: instructions |

Classification of every miss:

| Check | Verdict | Why |
|---|---|---|
| Agent instruction file exists | REAL GAP | No `CLAUDE.md`/`AGENTS.md` in repo root (README.md only). A cold agent gets the global injected orchestrator, which says nothing about this repo's layout, test commands, or the "never touch real ~/.claude" rule (that rule lives only in odd/tasks constraints, line ~38). Cheapest fix: ~25-line CLAUDE.md. |
| Startup workflow documented | REAL GAP (partly structural) | Recovery protocol exists in the injected orchestrator ("mem_context -> mem_search -> task file") but not in-repo. |
| Definition of done documented | PARTIAL / structural | Acceptance criteria exist in odd/tasks (lines ~160-166) but are not routed from any instruction file. |
| Verification commands discoverable | PARTIAL | `npm test`, `test:node`, `test:py` in package.json + README "Tests"; invisible to the scorer because no instruction file points at them. |
| State artifacts routed from instructions | REAL GAP | Follows from missing instruction file. |
| Feature tracker (feature_list.json) exists/valid | STRUCTURAL | State is `odd/tasks/<feature>.md` with stable T-ids and checkboxes, mirrored to Engram, and parsed by our own MCP tool `odd_tasks_status` (src/mcp/tools.js:15-35). A JSON file would duplicate it. Do not add. |
| Progress log exists / supports restart | STRUCTURAL + small gap | The task file has a dated "Progress" section; it lacks a rolling "Next session should / blockers / files" block. Add one short block at the top of the task doc, not a new file. |
| Handoff captures blockers/files/next step | REAL GAP (small) | See above; the MCP tool returns `next` item only. |
| Verification entrypoint (init.sh) | STRUCTURAL | `npm test` is the entrypoint; no fail-fast chain, no static check (no lint/typecheck). Minor gap: add `npm run check` only if a linter is wanted (adds); otherwise document. |
| Verification evidence recorded | MEETS (not detected) | Per-task deviations + RED/GREEN evidence are recorded in the task doc Progress entries. |
| One-feature-at-a-time rule / dependencies / status / scope / completion gate | MEETS in design, not detected | Orchestrator "implement task by task", T-ids with explicit status, "Scope: In/Out" section. The scorer's keyword scan cannot see them because they live in the injected global CLAUDE.md, not the repo. |
| Startup script (init.sh), session handoff template, restart markers, clean restart path | STRUCTURAL | Replaced by hooks (SessionStart baseline, Stop review reminder) and Engram `mem_session_summary`. |

Net: of 25 checks, ~14 are structural misses (equivalent mechanism exists under another name), ~4 are partial, 4-5 are real gaps, all small and fixable with one short repo CLAUDE.md. Treat the 20/100 as meaningless as a score; use only the three real gaps. The "bottleneck=instructions" call is right for the repo, but wrong in direction for the harness: the harness has too MUCH instruction, not too little.

## Part 2: the installed harness vs the 7 references

Measurements (sandbox install, default flags):

| Injected item | Chars | Lines | ~Tokens |
|---|---|---|---|
| CLAUDE.md total (6 marker blocks) | 62,032 | 484 | ~15.5k |
| orchestrator block | 35,591 | 292 | ~8.9k |
| agent-routing block | 17,103 | 74 | ~4.3k |
| codegraph-guidance | 3,033 | 31 | ~0.75k |
| engram-protocol | 2,631 | 42 | ~0.66k |
| persona | 2,178 | 34 | ~0.55k |
| remote-authorization | 1,393 | 11 | ~0.35k |
| output style (gentleman) | 7,128 | 99 | ~1.8k |
| skill frontmatter descriptions (8 skills) | ~1.7k | | ~0.45k |
| agents (8 files, loaded only on dispatch) | 77,903 | | on demand |
| skills bodies (132K on disk) | | | on demand |
| `--with-sdd` adds | CLAUDE.md unchanged (62,032); +11 commands, +11 agents, +PreToolUse(Agent) hook | | on demand |

Hook latency (5-run average, this machine): telemetry python hook 45 ms; skill-registry node hook 52 ms; review-stop node hook 36 ms; SDD preflight python 21 ms; `codegraph prompt-hook` 83 ms. Per user prompt: skill-registry + telemetry + codegraph = ~180 ms serial worst case; per tool call (PostToolUse, telemetry only) ~45 ms. Matcher for the SDD hook is `Agent` only.

Legend: meets / partial / gap / n/a. Evidence paths are relative to the repo.

### 2.1 context-engineering-pattern.md

| Item | Verdict | Evidence |
|---|---|---|
| Explicit context budget (system 2k, instructions 3k) | GAP | Always-on CLAUDE.md = 15.5k tokens; no budget stated anywhere (README, task doc). |
| SELECT: JIT loading, progressive disclosure tiers | PARTIAL | Skills are JIT (frontmatter only, bodies on demand: assets/skills/*/SKILL.md, 8 skills ~1.7k chars of descriptions). But the SDD workflow, judgment-day review, consent/lineage procedure and RDD native-review procedure are all inlined in the always-on block (assets/claude/orchestrator.md:13-52, 123-end; assets/claude/agent-routing.md) instead of being skills/references. The orchestrator itself says "SDD workflow (lazy-loaded)" but still embeds ~290 lines. |
| Hard caps on every variable-length block + truncation pointers | PARTIAL | memory search/context capped (python/amauta/memory/store.py:262,267 limit<=100/20; server.py:93 summaries truncated to 300 chars); telemetry text fields capped (telemetry/hook.py `_text`). Always-on text itself has no cap. |
| COMPRESS: compaction handling | MEETS (delegated to Claude Code) | SessionStart matcher includes `compact` (src/install/servers.js:77); review-stop keeps baseline across resume/compact (src/review/stop.js:41-47). |
| ISOLATE: delegated work must not pollute parent | MEETS | Mandatory delegation triggers + review lenses with `tools: []` (assets/claude/agents/review-*.md) + orchestrator "delegate mapping/writes". Cost: the trigger text is itself large (agent-routing.md 17k chars). |
| Memoize with explicit invalidation | MEETS | skill-registry fingerprint cache (src/registry/skill-registry.js:140-166), usage ingest_state offsets (python/amauta/usage/ingest.py). |
| Gotcha: isolation enforced at call time, not by prompt only | PARTIAL | Reviewer lenses have `tools: []` (call-time); but "orchestrator never edits / one writer" is prompt-only (and the SDD preflight hook enforces only SDD dispatch, src/install/servers.js:60-84). |
| Gotcha: truncation silent until it fires | PARTIAL | Claude Code does not truncate CLAUDE.md, but quality degrades with size; no check/warning in `amauta status` of block size. |

### 2.2 memory-persistence-pattern.md

| Item | Verdict | Evidence |
|---|---|---|
| Separate layers (instruction / auto-memory / session extraction) | MEETS | Instruction = CLAUDE.md markers; auto-memory = SQLite observations (python/amauta/memory/store.py:14-60) with sessions + summaries; portal reads Claude file memories read-only (T11). No background extraction (explicit tool calls only, by the model). |
| Two-step save invariant (topic file then index) | N/A | SQLite transaction is atomic; weaker concern than files. Orphan-sweep gotcha (#15) also N/A. |
| Bounded always-on index; detail on demand | MEETS | Memory is not injected at all; `mem_context` limit 20 (store.py:267), `mem_get_observation` for detail. Better than the reference. |
| One-line index entries (gotcha #1) | N/A | No index file. The user's separate `~/.claude/projects/.../MEMORY.md` is Claude Code's own mechanism, not ours. |
| Derivable content excluded by design (gotcha #4) | GAP | Engram protocol says "save after any decision, bugfix, discovery, convention, or config change" with no type taxonomy / no "do not save what the repo already says" rule (assets/engram/protocol-slim.md:14-16). Risk: the store fills with derivable summaries. |
| Local overrides win / test the priority stack (gotcha #2) | PARTIAL | Marker injector preserves user text (src/core/markers.js) and README documents it, but nothing warns that a project `CLAUDE.md`/`CLAUDE.local.md` overrides injected global rules; no test of the full stack. |
| Extraction timing race (gotcha #3) | MEETS / N/A | Writes are synchronous tool calls; telemetry uses 500 ms busy timeout and counts dropped events (telemetry/hook.py:11, housekeeping.count_dropped). |
| Progress-log template with Next-session block | PARTIAL | `mem_session_summary` + odd task Progress section; no mandated "next session should" field in the summary template. |
| Memory-protocol/tool parity | GAP (found) | Protocol references `mem_review`, `ambiguous_project`/`recovery_token`/`available_projects` (assets/engram/protocol-slim.md:7,30-48) which python/amauta/memory/server.py does not implement. The model is told to follow flows that cannot trigger. ~25 lines of dead protocol. |

### 2.3 tool-registry-pattern.md

| Item | Verdict | Evidence |
|---|---|---|
| Fail-closed defaults / default permission not "allow" (gotcha #13) | PARTIAL | install never sets `permissions.defaultMode` and does not add an allow list (src/install/servers.js; assets/claude/settings-overlay.json has only `deny`). So user's own mode governs: safe, but amauta adds no `ask` rules for destructive commands. |
| Bypass-immune protected paths/commands | PARTIAL | Deny list of 24 entries (settings-overlay.json): `rm -rf /`, `rm -rf ~`, .env, .ssh, .aws, *.pem, *.key, secrets. Missing from reference's list: `.git/**` writes, `mkfs*`, `DROP TABLE*`, `git push --force`, `git reset --hard`; patterns are relative (`Read(.env)`) and macOS-only (`Library/Keychains`). Unioned with user deny (not replaced) = good. |
| Per-call (not per-tool) concurrency classification | N/A | Claude Code owns the tool runtime. |
| Permission evaluator side effects: do not cache | N/A | Same. |
| Safety checklist per new tool (MCP) | PARTIAL / MEETS | Own MCP servers validate inputs: `validateArgs` with absolute cwd, `base_ref` hardened with `--end-of-options` and rev-parse (T4b); read-only tools only (src/mcp/tools.js). memory MCP writes only to own sqlite. Third-party MCPs added by install: context7, rea (`npx -y rea-agents@6.4.0`), codegraph: versions pinned for context7/rea (good), but all run unsandboxed and `rea` exposes ~300 tools (heavy deferred-tool listing, large attack surface) for every project. |
| Audit logging | MEETS | Telemetry: events table (tool name, ok, bytes; no payloads) + dropped counter; usage ingestion stores names only (T11). |
| Hook-based gate for sensitive dispatch | MEETS | SDD PreToolUse(Agent) hook, fail-closed at shell level (servers.js:60-84); dead-simple, tested (T6b). |

### 2.4 multi-agent-pattern.md

| Item | Verdict | Evidence |
|---|---|---|
| Coordinator synthesizes, not delegates understanding | MEETS | Orchestrator rules: "keep one writer and a short synthesized handoff", writers receive `## Verification`, locator and context (assets/claude/agent-routing.md ODD section; orchestrator.md Delegation Rules). |
| Coordinator pattern as default; single-level; flat roster | MEETS | Workers are fresh Agents; no fork; no swarm. The orchestrator forbids parallel writers (no worktrees approved). Whether subagents can spawn others is up to Claude Code. |
| Self-contained worker prompts (template) | PARTIAL | Delegation rules describe the contents but there is no worker-prompt template; each task relies on the model's rendering. skill `sdd-phase-common.md` has one for SDD only. |
| Tool filtering per worker | MEETS | explore/judge agents read-only (jd-judge-*: `Read, Glob, Grep, mem_search, mem_get_observation, codegraph_explore`); review lenses `tools: []`; fix agent has Bash/Edit; tool names rewritten to `mcp__engram__` to match the registered server (installer). jd-fix-agent still has Write+Bash (necessary). |
| Mandatory model on delegation | MEETS | `model: sonnet` in all 8 installed agents (installed output). |
| Over-delegation risk | PARTIAL | "Long-session backstop: after ~20 tool calls delegate" + "4-file rule" + "2+ files writer" force subagents for modest work; each worker starts cold and re-reads context. Reference's tradeoff table calls coordinator "slowest but safest". Policy is user-chosen, but the cost is high and not stated. |
| Eviction/notification of async work | N/A | Claude Code runtime. |
| Agent definitions size | GAP (soft) | 8 agents = 77.9k chars on disk (~19k tokens) loaded only on dispatch; the judge/fix agents carry large copied skill text. Not always-on, but each cold start reads it. |

### 2.5 lifecycle-bootstrap-pattern.md

| Item | Verdict | Evidence |
|---|---|---|
| Hooks fail open / never break the session | MEETS | `runHook` swallows all errors, exit 0 (src/hooks/index.js:30-45); telemetry `main` same (telemetry/hook.py:60-66). |
| Hook latency / blocking | MEETS (with 1 gap) | 21-83 ms each (measured). Only Stop `review-stop` can block, once per candidate, and only when RDD is on (src/review/stop.js:55-67). Gap: telemetry/usage/codegraph hooks registered with no `timeout` field (servers.js:81-82; settings.json sandbox) so a hung python/node process would stall the event until Claude Code's default timeout. Add `timeout: 5`. |
| Hook trust gate / dispatch scope | PARTIAL | We rely on Claude Code's own trust prompt. Hooks run from absolute repo paths `node /home/.../amauta/bin/amauta.js` (servers.js; T4): moving or deleting the repo silently breaks all hooks (they fail open, no warning except `amauta status`). |
| Hook types disjoint, no overlap | PARTIAL | Seven telemetry hook processes (5 events) + usage (2) + 4 others; per-tool-call process spawn (~45 ms x every tool use) is the largest steady cost. Not disjoint with the Engram/Claude Code transcript (usage ingest re-reads transcripts). |
| Bootstrap staged, sensitive subsystems after trust | PARTIAL | Install order is atomic with backup/manifest (src/core/backup.js, fsatomic.js; T2b hardened). Telemetry is opt-out via `--no-telemetry` (default ON; local only, no network) and the portal binds 127.0.0.1 only (T11). The reference wants security-sensitive subsystems after explicit consent; default-on local telemetry of tool names/cwd is mild but is a default. |
| Startup path / restart path per session | PARTIAL | SessionStart only writes a review baseline (review-stop). No session-start context hook: the model must remember to call `mem_current_project` -> `mem_context` (protocol-slim.md:6-20). That is ~15 lines of procedure the model might skip; the reference prefers a hook that loads the 1-page state. |
| Long-running tasks typed IDs, disk-backed output | MEETS | graphify post-commit hook uses mkdir lock + log file (src/graphify/hook.js; T13b); usage ingest budget 3 s resumable. |
| End-of-session procedure | MEETS | "Before saying done call mem_session_summary" + Stop hook reminder. |

### 2.6 skill-runtime-pattern.md

| Item | Verdict | Evidence |
|---|---|---|
| Progressive disclosure: SKILL.md -> references/ | MEETS | skill-creator, judgment-day, chained-pr, go-testing have `references/`. Bodies 39-83 lines. |
| Every referenced bundled file exists | GAP (real bug) | Source: assets/skills/judgment-day/SKILL.md:53 links `../_shared/review-ledger-contract.md` (not vendored); after install both it and assets/skills/_shared/README.md:11 render as `..md` / `.-pi.md` (sandbox CLAUDE.md-adjacent output). A dangling link in an installed skill. Already known as T15 item. |
| Frontmatter trigger front-loaded / per-entry listing budget (~150 chars, gotcha #12) | PARTIAL | 8 descriptions total ~1.7k chars (avg ~210); several exceed 150 and start with "Trigger: ..." (good), but chained-pr/work-unit-commits/go-testing are low-value for most projects and still cost listing space. |
| No project-specific / user-private paths in skills | PARTIAL | go-testing (Go/Bubbletea) and chained-pr/work-unit-commits are domain- or workflow-specific copies; reviewer text cites "ai-course-2 slides" (assets/claude/agents/review-risk.md:9, unreachable source). |
| No destructive commands in skills | MEETS | none found. |
| Skills not depending on private local paths | PARTIAL | `~/.config/o...`/`.agents/skills` registry guidance mentions several agents' skill dirs (orchestrator.md:353) that amauta never installs. |
| Skill-registry as an always-on file written into projects | MEETS (opt-in) | `.atl/` only if project opted in (T4b R1-001). |

### 2.7 gotchas.md (cross-check of the 15)

| # | Gotcha | Verdict | Note |
|---|---|---|---|
| 1 | memory index caps fire silently | N/A | no injected memory index |
| 2 | priority ordering (local beats user) | PARTIAL | not documented for the injected block; project CLAUDE.md overrides it silently |
| 3 | extraction race | N/A | no extractor |
| 4 | derivable content in memory | GAP | no memory type rules in the protocol |
| 5 | concurrency per-call | N/A | runtime |
| 6 | permission eval side effects | N/A | runtime |
| 7 | pending state | N/A | |
| 8 | fork children must not fork | MEETS | coordinator pattern only |
| 9 | memoized context stale | MEETS | registry fingerprint + explicit rebuild; usage ingest rescans on shrink |
| 10 | hook trust all-or-nothing | PARTIAL | relies on Claude Code; broken-path hooks fail open silently |
| 11 | eviction requires notification | N/A | |
| 12 | skill listing budgets tight | PARTIAL | see 2.6 |
| 13 | default tool permission is "allow" | PARTIAL | no defaultMode and no allow/ask overlay; deny only |
| 14 | team memory requires auto-memory | N/A | |
| 15 | orphaned topic files | N/A | sqlite |

Amauta-specific gotchas the references do not cover (found here): installer text templating can strip file names (`..md`); protocol/tool drift between assets and the Python memory server; duplicated blocks if gentle-ai (Go) is also installed in the same `~/.claude` (both inject the same orchestrator under different markers; not measured because it would touch the real home).

## Top 10 recommendations for T15

| # | Recommendation | Why (reference) | Effort | Effect |
|---|---|---|---|---|
| 1 | Cut the injected orchestrator + agent-routing to a ~120-line core (~25-30% of today's 62k chars; target <= 18k chars / ~4.5k tokens): delete consent envelope relay, Gentle AI provider-defect handoff, SDD edit-authority relay, lineage/receipt/burn lifecycle, "Authority-First Terminal Procedure", stop-reason table | context-engineering "Hard caps / Select"; Skill SKILL.md "Keep the root instruction file short: routing and invariants"; repo's own Out-of-scope list | M | SIMPLIFIES (-44k chars, ~-11k tokens) |
| 2 | Deduplicate: orchestrator.md Delegation Rules and agent-routing.md "Mandatory Delegation Triggers"/"Native Checking Contract" duplicate each other (appear twice in the 484 lines) and ODD protocol text is repeated in odd-orchestrator-sections.md; keep one copy | context-engineering "Every token earns its place" | S | SIMPLIFIES (-4 to -6k chars) |
| 3 | Move SDD, judgment-day and RDD review procedures out of CLAUDE.md into the skills they belong to (sdd-orchestrator-workflow already exists as `skills/_shared`); always-on keeps only a 3-line pointer each | Progressive disclosure Tier 2/3 (context-engineering); skill-runtime "Large manuals the agent must always read do not belong" | M | SIMPLIFIES (moves ~8k chars to on-demand) |
| 4 | Fix the dangling/stripped links: vendor-or-remove `review-ledger-contract.md` refs in judgment-day SKILL.md:53 and _shared/README.md:11; fix the templating that renders `..md`; add a test that every relative link in installed skills resolves | skill-runtime "Every referenced bundled file exists" | S | SIMPLIFIES (deletes dead refs) |
| 5 | Make the engram protocol match the Python server: drop `mem_review`, `ambiguous_project`/`recovery_token` flows (assets/engram/protocol-slim.md:7,30-48) or implement them; add a memory-type taxonomy + "do not save what the repo already shows" rule in 3 lines | memory-persistence gotcha #4, "Derivable content"; parity of tool contract | S | SIMPLIFIES (-~1k chars) and adds 3 lines |
| 6 | Add `timeout` (e.g. 5 s) to telemetry, usage and codegraph hooks; consider registering PostToolUse telemetry only when telemetry is explicitly requested (per-tool-call process spawn ~45 ms) or batch it | lifecycle "hook latency / one hook must not stall"; gotcha #10 | S | ADDS 1 field per hook; reduces latency risk |
| 7 | Add a repo-level `CLAUDE.md` (~25 lines): layout, `npm test`, "never touch real ~/.claude (use AMAUTA_* env)", pointer to odd/tasks, and a "Next session should" block in the task doc | SKILL.md Instructions + Lifecycle subsystems; validate-harness failures 1/5 | S | ADDS ~25 lines |
| 8 | Tighten the deny overlay and make patterns absolute/home-aware (`Read(~/.ssh/**)`, `Read(**/.env*)`), drop macOS Keychains entries, add `Bash(git push --force*)`/`git reset --hard` as `ask` (not deny), and say in README that no defaultMode/allow list is set | tool-registry "Bypass-immune rules", gotcha #13 | S | ADDS ~4 rules, removes 2 |
| 9 | Make `rea` (~300 tools) and `context7` opt-in installs (`--with-rea`) instead of default MCP entries for every project; default set = engram-equivalent + amauta + codegraph | context-engineering "SELECT: JIT, don't load all at once"; tool-registry safety checklist | S | SIMPLIFIES (fewer default tools/listing tokens) |
| 10 | Add a size guard: `amauta status` prints the injected-context size per block and warns above a budget (e.g. 20k chars), plus a unit test pinning the budget so it cannot regress | context-engineering "Context Budget" template; gotcha "silent until it fires" | S | ADDS ~30 lines + 1 test, protects #1 |

## Candidates to delete or shrink (with estimates)

| Candidate | Where | Savings estimate |
|---|---|---|
| Consent envelope relay / Lossless Blocking Prompts section | assets/claude/orchestrator.md:13-52 | ~40 lines, ~9k chars (~2.2k tokens) |
| Gentle AI Provider Defect Handoff + SDD Edit-Authority Consent Relay | orchestrator.md (inside the above range + following) | ~6k chars (~1.5k tokens) |
| Native review lifecycle prose: START/STATUS/lineage/acknowledge, Authority-First Terminal Procedure, stop reason table, Cross-repository lifecycle root, Concurrent Reviewer Group | rendered in CLAUDE.md ~lines 230-345 (orchestrator.md + agent-routing.md) | ~90-110 lines, ~14k chars (~3.5k tokens). amauta has no START/lineage commands, so this is dead text. |
| Duplicate delegation/triggers/ODD copy (orchestrator Delegation Rules vs agent-routing Mandatory Delegation Triggers vs ODD sections) | CLAUDE.md lines ~57-122 vs 400-474 | ~5k chars (~1.2k tokens) |
| `gentle-ai`-specific references and Go-only wording (`gentle-ai review ...`, "native Go owns", "gentle-ai sync") | orchestrator/agent-routing | ~2k chars (~0.5k tokens) |
| Skill Registry Protocol referencing absent agent dirs | orchestrator.md:123-end | ~3k chars (~0.75k tokens) |
| Dead protocol parts in protocol-slim.md | assets/engram/protocol-slim.md:7,30-48 | ~1k chars (~0.25k tokens) |
| Output style Gentleman (7.1k chars) overlaps with `persona` block (2.2k): merge to one place | assets/claude/output-style-*.md + persona | ~2-3k chars (~0.6k tokens) |
| go-testing skill + references (Go-specific, not needed for a Node/Python harness) | assets/skills/go-testing/ | on-demand only; ~0 always-on, ~10-15k chars of disk; make optional |
| Duplicate skill-style-guide in skill-creator and skill-improver | assets/skills/*/references/skill-style-guide.md | one copy; on-demand only |

Projected result of recommendations 1-3 + 5 + candidates above: CLAUDE.md from 62k chars / 484 lines to ~16-20k chars / ~130-160 lines (~4-5k tokens, -70%); total always-on (with output style) from ~17.5k to ~6-7k tokens, which is at the edge of the reference's own 2k+3k template but a defensible budget for an orchestrating harness.
