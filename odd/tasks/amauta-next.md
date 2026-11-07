# Feature: amauta next (small kernel, four pillars, Windows, data and code security)

Locator: `odd/tasks/amauta-next.md` (branch `feat/amauta-next` from `main` `b0762c9`). Engram mirror:
`odd/amauta-next/tasks`. Decisions: `docs/decisions/0001`..`0008`. Planned with the user on 2026-11-06/07.

## Objective

1. Restructure and clean the core so it stays small, modular, commented, documented and auditable, and runs on
   Linux, macOS and native Windows.
2. Add, rewritten or adapted through an intake record, the parts of the user's corporate harness (public-harness
   v19-rc4 and its predecessor) and of the private agent archive that fit amauta: data security, code
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

Phase 1a, structure and hygiene

- [x] N0 Plan, decisions (ADR 0001-0008) and the intake template.
- [x] N1 Windows and Codex probe script for the user's machine (hook shell, `decision: block`, Codex agents, hooks
  inside subagents, resuming a subagent, latency). Not installed; results update this plan.
- [x] N2 Green baseline: `test_portal_wiki_impact` depends on the environment.
- [ ] N3 Module registry `MODULES.json` + architecture test (every file in one module; layer import rules) +
  `docs/architecture.md` + `docs/modules.md`.
- [ ] N4 Simplicity ratchet test with recorded baseline; header comment required in new or changed files.
- [ ] N5 Installer: one `plan()` over runtime adapters (claude, codex); split `planMcpSync`.
- [ ] N6 `docs/odd.md`: task file format (incl. Criteria, Contracts, Review) with a format test.

Phase 1b, Windows

- [ ] N7 One Node dispatcher per hook event; resolved Python interpreter in state; SDD preflight in Node; single Stop
  policy (one combined block, at most two per turn, honours `stop_hook_active`).
- [ ] N8 Platform layer: junction or managed copy for skill links, PATHEXT, process-tree kill (Job Objects from
  Python, `taskkill /T` from Node), Windows paths and permissions, CRLF; fix `os.kill(pid, 0)` and `SIGHUP` in
  `graph/lock.py`.
- [ ] N9 CI on Linux, macOS, Windows (portable test subset on Windows) + UPGRADING (Codex re-trusts changed hooks).

Phase 1c, portal

- [ ] N10 `extras/` with a route registry: skill impact, theme editor, wikiexplain, graphify semantic + PPTX.
- [ ] N11 Split `app.js` by page and i18n into one JSON per language.
- [ ] N12 6+1 page map with redirects; Windows launcher (Edge/Chrome, Start menu shortcut).
- [ ] N13 README <= 200 lines with details in `docs/`; phase 1 audit; v0.5.0.

Phase 2a, data security

- [ ] D1 Intake records for the corporate privacy pieces.
- [ ] D2 Detector catalog (secrets, Ecuadorian cedula and RUC, Luhn cards, email, +593 phones, IBAN), generated
  fixtures, one finding format.
- [ ] D3 Memory guard (always on): secrets and PII rejected or redacted without echoing them.
- [ ] D4 Privacy hook (data files outside test/fixture/example paths plus configured paths; always ask, never deny;
  secrets in prompts only warn) and `amauta privacy scan|redact|pseudonymize`.

Phase 2b, code security

- [ ] D5 Checks engine, safe checkers, error baseline per file, edit hook (`PostToolUse`).
- [ ] D6 Per-project trust (`amauta check trust`), code-executing checkers, project check at Stop under the single
  Stop policy.
- [ ] D7 Secrets in edited code; gitleaks, semgrep and bandit when on PATH.
- [ ] D8 ODD rule: a task is not checked off while its checks fail.

Phase 2c, data content, communication and profiles

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
- [ ] D13 `amauta profile harvest` and `amauta profile import` (agent archive layout) producing a reviewable draft.
- [ ] D14 Portal Security page (counts only), settings toggles, profile shown per project; phase 2 audit; v0.6.0.

Phase 3, sibling projects

- [ ] S1 Portal links and `status` health for configured sibling projects (oga_catalog, harness-pipelines); MCP
  registration needs nothing new (two-way MCP sync); `ml-experiments` skill ships with the pipelines sibling; phase 3
  audit; v0.7.0.

## Acceptance criteria

- `npm test` exit 0 on every commit, RED seen first for behavior changes; CI green on the three OSes (Windows subset).
- Architecture test and simplicity ratchet green; every copied or adapted piece has an intake record and provenance.
- Phase 1 leaves the kernel smaller than `b0762c9`; behavior is unchanged except the portal navigation and `extras/`.
- No private archive content (hosts, IPs, people, business rules, brand) anywhere in the repository.

## Progress

- 2026-11-07: plan approved by the user; branch created.

## Next step

N0.
