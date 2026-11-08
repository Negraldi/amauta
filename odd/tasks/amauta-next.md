# Feature: amauta next (small kernel, four pillars, Windows, data and code security)

Locator: `odd/tasks/amauta-next.md` (branch `feat/amauta-next` from `main` `b0762c9`). Engram mirror:
`odd/amauta-next/tasks`. Decisions: `docs/decisions/0001`..`0008`. Planned with the user on 2026-11-06/07.

## Objective

1. Restructure and clean the core so it stays small, modular, commented, documented and auditable, and runs on
   Linux, macOS and native Windows.
2. Add, rewritten or adapted through an intake record, the parts of the user's corporate harness (public-harness
   v19-rc4 and its predecessor) and of a private agent archive that fit amauta: data security, code
   security, data skills, a communication agent with its own reviewer, analytical review, and private profiles.

## Scope

In: the four pillars on a kernel (portal, ODD, data security, code security); kernel restructuring (module registry,
architecture test, simplicity ratchet, installer adapters, one hook dispatcher per event, platform layer, CI on three
OSes); portal split and 6+1 page map; `extras/`; detectors, memory guard, privacy hook, privacy CLI; checks engine with
edit and Stop checks and per-project trust; data skill, `communicator` agent, analytical and communication review
lenses, mechanical review pack, profiles (default + private org profile, harvest, import); portal links to sibling
projects.

Out: the corporate coordinator (consent and receipt machinery), the AppContainer sandbox, the LLM gateway, the egress
guard as code, the VS Code extensions, `harness-pipelines` and `oga_catalog` as code (they stay sibling projects),
MLflow, the Power BI Desktop bridge, Azure Board. No private archive content (hosts, people, business rules, brand) is
ever committed: it belongs in the user's private profile.

## Constraints

- Node >= 22, Python >= 3.11 stdlib only, no npm dependencies, no network in hooks or servers (AGENTS.md).
- Never touch the real `~/.claude`, `~/.claude.json`, `~/.codex`, `~/.agents`, `~/.amauta`; tests use temp dirs.
- Always-on instruction blocks stay under 20k chars (about 9.5k used on 2026-11-07).
- Simplicity ratchet: file <= 400 lines, function <= 60, line <= 140, zero dependencies; existing violations are a
  recorded baseline that may only shrink.
- Copied or adapted code needs an intake record (`docs/intake/`) and provenance (NOTICE, manifest, source sha256).
- English artifacts, Conventional Commits, no AI attribution lines.

## TDD

Strict, ON (AGENTS.md: a failing test seen first for any behavior change). Runner: `npm test` (node --test, then
`python3 -m unittest discover -s python/tests -t .`). Documentation-only commits: content and link checks.

## Delivery

One integration branch `feat/amauta-next`, one Conventional Commit per task, pushed. PRs per phase (1a, 1b, 1c, 2a,
2b, 2c, 3) can be cut from it later; push, PR and merge stay user decisions. Versions: 0.5.0 after phase 1, 0.6.0 after
phase 2, 0.7.0 after phase 3, each with UPGRADING notes and a closing audit in `docs/audits/`.
Budget gate: phase 1 must not grow the kernel's line count; phase 2 adds at most about 2,000 authored lines.

## Tasks

### Phase 1a, structure and hygiene

- [x] N0 Plan, decisions (ADR 0001-0008) and the intake template.
- [x] N1 Windows and Codex probe script for the user's machine (hook shell, `decision: block`, Codex agents, hooks
  inside subagents, resuming a subagent, latency). Not installed; results update this plan.
- [x] N2 Green baseline: `test_portal_wiki_impact` depends on the environment.
- [x] N3 Module registry `MODULES.json` + architecture test (every file in one module; layer import rules) +
  `docs/architecture.md` + `docs/modules.md`.
- [x] N4 Simplicity ratchet test with recorded baseline; header comment required in new or changed files.
- [x] N5 Installer: one `plan()` over runtime adapters (claude, codex); split `planMcpSync`.
- [x] N6 `docs/odd.md`: task file format (incl. Criteria, Contracts, Review) with a format test.

### Phase 1b, Windows

- [x] N7 One Node dispatcher per hook event; SDD preflight in Node; single Stop policy (one combined block, at most
  two per turn, honours `stop_hook_active`). The interpreter is `AMAUTA_PYTHON` or `python3`; resolving it at install
  time moves to N8.
- [x] N8 Platform layer: Python interpreter resolved at install (`--python`, `AMAUTA_PYTHON`, stored in state, used by
  hooks and MCP servers); junction or managed copy for skill links, PATHEXT, process-tree kill (Job Objects from
  Python, `taskkill /T` from Node), Windows paths and permissions, CRLF; fix `os.kill(pid, 0)` and `SIGHUP` in
  `graph/lock.py`.
- [x] N8b Copy fallback when a junction cannot be created (kept current by `amauta sync`); a portable
  `{{AMAUTA_SDD}}` command in the SDD assets (today `env PYTHONPATH=... python3`).
- [x] N8c `amauta-wiki-explain` and `graphify-semantic` skills call Python through `node <bin> py` (portable).
- [x] N9 CI on Linux, macOS, Windows (portable test subset on Windows) + UPGRADING (Codex re-trusts changed hooks).
- [ ] N9b Make the full suite green on macOS: 22 failures in the first CI run (graphify hook and semantic pass, codegraph
  project-dir checks with /private temp dirs, the portal start in e2e, ENOEXEC from fake launchers). The macOS job does
  not block until then.

### Phase 1c, portal

- [x] N10 `extras/` with a route registry: skill impact, theme editor, wikiexplain, graphify semantic + PPTX.
- [x] N11 Split `app.js` by page (core `app.js`, nine `page-*.js`, `boot.js` last).
- [x] N11b i18n: one dictionary file per language (the dictionaries are read synchronously at boot; needs a loading
  change, not a mechanical move).
- [x] N12 6+1 page map with redirects; Windows launcher (Edge/Chrome, Start menu shortcut). Design from the impeccable
  critique of 2026-11-07 (below), in this order: N12a raw i18n key on Home (P1 bug, TDD); N12b one `pageHead` on every
  page; N12c top bar search-only (theme and language to Settings; range, project, runtime and Refresh usage in the
  Activity header); N12d page map with hash sub-routes for tabs (`#/memory/lint`) and redirects from the old routes;
  N12e Harness diagram in Mermaid, archify behind "open full diagram"; N12f Activity opens with one summary sentence
  then the daily chart and the sortable table (no stat tiles); N12g P3 copy (plurals via `tn()`, jargon, empty-table
  messages, 72ch reading width); N12h impeccable `polish` pass with before/after screenshots; Windows launcher.
- [ ] N13 README <= 200 lines with details in `docs/`; phase 1 audit; v0.5.0.

### Phase 2a, data security

- [ ] D1 Intake records for the corporate privacy pieces.
- [ ] D2 Detector catalog (secrets, Ecuadorian cedula and RUC, Luhn cards, email, +593 phones, IBAN), generated
  fixtures, one finding format.
- [ ] D3 Memory guard (always on): secrets and PII rejected or redacted without echoing them.
- [ ] D4 Privacy hook (data files outside test/fixture/example paths plus configured paths; always ask, never deny;
  secrets in prompts only warn) and `amauta privacy scan|redact|pseudonymize`.

### Phase 2b, code security

- [ ] D5 Checks engine, safe checkers, error baseline per file, edit hook (`PostToolUse`).
- [ ] D6 Per-project trust (`amauta check trust`), code-executing checkers, project check at Stop under the single
  Stop policy.
- [ ] D7 Secrets in edited code; gitleaks, semgrep and bandit when on PATH.
- [ ] D8 ODD rule: a task is not checked off while its checks fail.

### Phase 2c, data content, communication and profiles

- [ ] D9 Data skill with five references (analytical review, transformation, enrichment, metrics and cohorts,
  provenance), `powerbi-report` v19 with PBIR tools (model diff, layout auditor, DAX linter as warnings, cascading
  rename), `exploratory-data-diagnosis`, institutional and editorial skills; all through intake records.
- [ ] D10 `communicator` agent (bounded writer to the task's deliverables folder; measure requests with a fixed format,
  up to three cycles; presentation measures only over approved measures, checked).
- [ ] D11 Review lenses `analytical` and `communication`, `amauta review pack` (mechanical), number-fidelity and render
  checks; both lenses run in their case even with code review off; analytical: one round plus delta re-check;
  communication: up to two rounds, a fresh reviewer each.
- [ ] D12 Profiles: `default` profile shipped; private org profile under `<state dir>/profiles/<name>/` extending it;
  project selection; precedence project > org > default; roles only in `people/`; privacy guard on profiles.
- [ ] D13 `amauta profile harvest` and `amauta profile import` (the private archive layout) producing a reviewable draft.
- [ ] D14 Portal Security page (counts only), settings toggles, profile shown per project; phase 2 audit; v0.6.0.

### Phase 3, sibling projects

- [ ] S1 Portal links and `status` health for configured sibling projects (oga_catalog, harness-pipelines); MCP
  registration needs nothing new (two-way MCP sync); `ml-experiments` skill ships with the pipelines sibling; phase 3
  audit; v0.7.0.

## User preferences to ask about later

- Before D10/D11: ask the user about aesthetics. Default agent names should reference the Inca empire (rulers,
  nobles, officials); the persona stays `gentleman` by default.

- Before phase 3: review the user's `orquestador-etl.zip` (uploaded 2026-11-07, not opened yet) in depth. The pipeline
  orchestrator should work like it: run processes from the orchestrator and show their command lines (terminal output)
  integrated in its UI. This changes S1 from "links and health only" to a real execution feature; redesign S1 then.

- In N12 (portal page map) use the vendored impeccable skill (`assets/skills/impeccable`, https://impeccable.style/) to
  improve the design: critique and audit the current portal first, then polish the new pages; before/after screenshots.

- Impeccable critique of the portal (2026-11-07, two isolated assessments, not degraded): no AI-slop verdict except the
  archify iframe and stat-tile rows; Nielsen 2/4 on match-to-real-world, consistency and error recovery; contrast >=
  4.98:1 everywhere, no overflow at 390 px, no console errors; detector: long lines in Settings/Harness/Memory, flat
  type hierarchy on data pages. User decisions: search-only top bar; Mermaid in Harness with archify as a link;
  Activity opens with a sentence and the table.
- 2026-11-07: N12a done: the Home spending table translated its token labels (`t(label)`); a test now fails on any
  text-only element that shows a dictionary key. RED seen.
- 2026-11-07: N12b done: `renderRoute` gives every page exactly one title (a `pageHead` header for views without an
  h1: Memory, Usage, Sessions, Tools, MCP, Harness). RED seen.
- 2026-11-07: N12e done first, at the user's request: the Harness diagram is the harness model as one session flow
  (runtime, hook events in session order with their handlers, dispatcher, Stop policy, memory.db, the MCP servers,
  the read-only portal), drawn in Mermaid with the portal's light tokens; archify is one link to its own route, never
  framed. Fixed on the way: since N7 the Harness hooks table showed every amauta hook as "other" (the API now knows the
  dispatcher and its handlers). The hostile-label Mermaid parse test covers the new diagram and its subgraphs.
- 2026-11-07: N12e follow-up: the diagram left wide gaps; hook events now wrap in numbered rows of three beside the
  MCP servers and the kernel reads left to right (about 1.7:1, fits the card).
- 2026-11-07: N12c done: the top bar holds only the menu toggle and search. Range, project, runtime and Refresh usage
  sit in a page bar shown only on the pages that use them. Theme and language moved to the sidebar footer, not
  Settings: a language switch re-renders the page you are on and the theme editor keeps its draft, which needs the
  pickers on every page. RED seen (index.html layout test).
- 2026-11-07: N12d done: six sidebar pages (`HUBS`, `hubOf` in `wikiroute.js`); the list routes of a page show as its
  tabs (also over an error panel). Routes keep their own hashes instead of nesting (`#/memory/lint` would collide with
  a memory whose topic key is `lint`); `#/activity[/sessions|tools|mcp]` is the one new address. UPGRADING notes.
  RED seen (sidebar, tabs and route tests).
- 2026-11-08: N12f done: Activity opens with one sentence (messages, sessions, input and output tokens, cache share)
  and a telemetry line; no stat tiles; the daily charts and the sortable tables follow. RED seen.
- 2026-11-08: N11b done (needed by N12f: i18n.js had no room left under the ratchet): the dictionaries are data in
  `static/i18n/{en,es,srv-es}.json`, served from the static whitelist; `i18n.js` keeps the code (95 lines) and
  `load()` runs before the first render. Tests install the same files (`readDicts`). RED seen (server test).
- 2026-11-08: N12g done: no "(s)" plurals (counts go through `tn()` or a "Label: n" form), "RDD mode" reads
  "Review mode" with On/Off, the `flag` origin reads "--repo option", an empty table says "Nothing to show for this
  selection" instead of a bare header, prose is capped at 72ch. RED seen.
- 2026-11-08: N12h done. Polish pass (impeccable `polish` checklist, before/after screenshots of 8 routes at 1440 and
  390 px in light and dark, no console errors, no overflow): the memory-source and usage-kind switches become one
  segmented control with a working pressed state (`aria-pressed` was `""`, so it never showed); the search rows got
  their spacing back (`.controls`, lost in N12c); server notes show `code` spans instead of raw backticks; "1 messages"
  in the recent feed; Settings shows "now Gentleman" like its select; the health list stays two columns on a phone;
  no double rule under each day; the Harness diagram scrolls sideways on a phone instead of shrinking. Windows
  launcher: Edge, then Chrome from their install folders, else explorer; `install-launcher` writes a Start menu
  shortcut through PowerShell with every path passed as an environment variable. RED seen for each.

## Acceptance criteria

- `npm test` exit 0 on every commit, RED seen first for behavior changes; CI green on the three OSes (Windows subset).
- Architecture test and simplicity ratchet green; every copied or adapted piece has an intake record and provenance.
- Phase 1 leaves the kernel smaller than `b0762c9`; behavior is unchanged except the portal navigation and `extras/`.
- No private archive content (hosts, IPs, people, business rules, brand) anywhere in the repository.

## Progress

- 2026-11-07: plan approved by the user; branch created. N0 `ef2ebd6`, N1 `14c908e`, N2 `95c560a` (the failure was the
  run date, not the environment: fixture dates left the 30-day window), N3 `d13da2c`, N4 `1075081`. Route: inline.
- 2026-11-07: N5 done as shared steps (`src/install/steps.js`, `files.js`) that both runtime plans compose, rather than
  one generic plan with adapter objects: the two runtimes differ in settings vs hooks.json, MCP JSON vs TOML with the
  two-way mirror, and option stickiness, and a single generic plan would hide those differences behind flags. Each
  plan function is now under 60 lines; `planMcpSync` split into classify / settleExcluded / syncOne. Kernel install
  code grew by 85 lines (headers and shared step docs); phase 1 still has to come out smaller overall (N10 moves
  extras out). 309 installer and Codex tests green without changes.
- 2026-11-07: N7 done. Hooks are now `node <bin> hook event <Event> --state-dir DIR --with a,b [--runtime codex]`, one
  per event, so `env`, `sh`, `timeout` and the `AMAUTA_RUNTIME=codex` prefix are gone from commands. Old single-handler
  names still run for commands an earlier install wrote; install replaces them. Tests that pinned the old command
  text were updated to the new form (24, same intent); the shell-level SDD guard tests became dispatcher tests
  (missing Python, failing Python, partial output, hang cut by `AMAUTA_PREFLIGHT_TIMEOUT_MS`). Stop keeps a 60 s
  timeout. Portal and `status` parity name the dispatcher by its handlers. RED seen for each new behavior.
- 2026-11-07: N8 part 1: `src/core/platform.js` (PATHEXT lookup, Windows quoting with double quotes and forward
  slashes, junction link type, `taskkill /T /F`), `python/amauta/oscompat.py` (process liveness through the process
  handle on Windows instead of `os.kill(pid, 0)`, start tokens, no SIGHUP), used by `graph/lock.py`, the skill store,
  graphify and the installers; POSIX file modes are not compared on Windows; `--python` / `AMAUTA_PYTHON` resolved at
  install (>= 3.11, sticky, stored as `python` in state, passed to hook commands and the memory server, honoured by
  status). Three copies of the state reader became `readStateObject`. Windows branches are tested with an injected
  platform; real Windows behavior waits for CI (N9) and the user's probe. Left for N8 part 2: CRLF in the marker
  injector, Windows system paths in the portal path guards, the copy fallback when a junction cannot be created, and
  the `{{AMAUTA_SDD}}` command in SDD assets (still `env PYTHONPATH=... python3`).
- 2026-11-07: N8 part 2: the marker injector keeps a CRLF-only document CRLF; the portal path guard refuses Windows
  drive roots, SystemRoot, Program Files, ProgramData and TEMP/TMP (TEMP even under the home directory), compared
  case-insensitively. The copy fallback and the SDD asset command moved to N8b.
- 2026-11-07: N8b done. When a skill link cannot be created, the store directory is copied with a `.amauta-copy`
  marker naming its origin; planning treats a marked copy as managed (left alone when equal to the rendered skill,
  re-copied when stale, so install and sync keep it current), uninstall and status recognise it, and an unmarked
  directory stays the user's. `{{AMAUTA_SDD}}` renders as `node <bin> sdd`; the new `amauta sdd` command runs the
  Python module with AMAUTA_PYTHON or the interpreter recorded in state. Link failures are simulated with an
  injected link function.
- 2026-11-07: CI on 66c9a0a: Windows portable subset and Ubuntu green; macOS red with the known N9b failures.
- 2026-11-07: N11: `app.js` (1,326 lines) split by line range into a 321-line core, nine page files and `boot.js`, loaded
  in that order (index.html, the static whitelist and the test boot list). Moved code keeps its debt: the repository
  total of long lines is unchanged (972) and one fewer file is over 400 lines; the ratchet now accepts a `"use strict"`
  directive before the header comment. Tests that searched the text of `app.js` search the whole UI. N10 (extras) now
  follows N11, so the theme editor and the other extras move out of single page files.
- 2026-11-07: N10 done (ADR 0009): `python/amauta/extensions.py` finds `python/amauta/extras/<name>/` packages and their
  `POINTS`; skill_impact, wiki_explain, theme_editor (backend) and graphify_semantic (with PPTX) moved there, each
  removable by deleting its folder. Their CLIs are `python3 -P -m amauta.extras.<name>`. Moved code keeps its debt; the
  repository total of long lines went from 972 to 970. The theme editor's page script stays in the portal (it shows
  only System, Light and Dark without the extra); the skills that call Python with `env PYTHONPATH=...`
  (wiki-explain, graphify-semantic) still need the portable form used for SDD (follow-up N8c).
- 2026-11-07: N8c done: `{{AMAUTA_PY}}` renders `node <bin> py`; `amauta py <module>` runs only `amauta.*` modules with
  the interpreter install chose. Both skills use it; the old placeholder still renders for skills an earlier release wrote.

## Next step

N13 (README <= 200 lines, phase 1 audit, v0.5.0); N9b stays open (macOS).
