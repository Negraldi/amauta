# Feature: pipelines as a DAG, with reuse and modes, after an independent review

Locator: `odd/tasks/pipelines-dag.md` (branch `feat/amauta-next`, after `1b2510c`). Engram mirror:
`odd/pipelines-dag/tasks`. Decisions: ADR 0010 (pipelines), ADR 0011 (this feature). Planned with the user on 2026-11-08.

## Objective

1. Fix what an independent review of the pipelines extra found (2026-11-08): no real mutual exclusion, runs left
   "running" forever, a timeout that a background child defeats, an event reader that a Unicode line separator freezes,
   paths resolved from different bases, and more (R items below).
2. Let a pipeline be a DAG: steps that do not depend on each other run in parallel; reuse a step definition (blocks)
   or a whole pipeline (sub-pipeline step); modes (for example train, train-predict, predict) switch steps on or off,
   and a pipeline may have several schedules, each with its mode.

## Scope

In: `python/amauta/extras/pipelines/`, the Pipelines tab (`page-pipelines.js`, `page-pipeline-run.js`), the trust record
of `amauta check trust`, docs (`docs/pipelines.md`, ADR 0011, CHANGELOG) and the explainer page.
Out: a scheduler inside amauta, editing pipelines in the browser, retries across runs, distributed execution.

## Constraints

- Python stdlib only; Node without dependencies; simplicity ratchet (file <= 400, function <= 60, line <= 140).
- A pipelines.json written for 0.6 keeps its meaning: no `needs` means "after the previous step", one run at a time.
- User decisions 2026-11-08: a failure skips only the steps that depend on it (independent branches finish); reuse both
  as blocks (step templates) and as sub-pipeline steps; each step lists the modes it runs in; `schedule` may be a list,
  each entry with its mode.

## TDD

Strict, ON. Runner: `python3 -m unittest python.tests.test_pipelines python.tests.test_pipelines_portal`,
`node --test test/portal-pipelines-ui.test.js`, then `npm test`.

## Tasks

### Review fixes

- [x] R1 Events: split on "\n" only (U+2028 in output froze a run); a partial last line waits; the portal reads by byte
  offset instead of re-parsing the file on every poll; summaries are cached by size and mtime.
- [ ] R2 One run at a time for real: a lock file per pipeline, taken atomically by whoever starts the run (portal, CLI,
  scheduler) and adopted by the runner; a lock whose process is gone is stale.
- [ ] R3 A runner that dies still ends its run: try/finally kills the running steps and writes run-end; SIGTERM/SIGINT
  cancel; a run without run-end whose runner is gone reads as "abandoned".
- [ ] R4 Timeout and cancel hold until the step's output closes; a step's leftover background processes are stopped
  when it ends (POSIX process group; documented limit on Windows).
- [ ] R5 One base for paths: script, notebook and outputs are relative to the project root, `cwd` only sets the working
  folder; symlinks may not lead outside the project; `check` resolves exactly as the runner does.
- [ ] R6 Step environment: the user's own PYTHONPATH is restored for steps; the inherited environment is documented.
- [ ] R7 Outputs: a step must change each output (size, inode or mtime against a snapshot taken before it), not only
  touch it after a clock; no fixed slack.
- [ ] R8 Redaction across lines: a private key block is redacted from BEGIN to END; nbconvert output is documented.
- [ ] R9 Schedules: missed-run state in local wall time (DST); 60 minutes or more is `/SC HOURLY`, 1440 is daily;
  hints carry the current PATH for cron and launchd.
- [ ] R10 A run that never starts says why: the runner's stderr goes to `<run>.log`; the portal reports it and ends.
- [ ] R11 Trust covers the definition: `amauta check trust` records the pipelines.json hash; a changed file needs a new
  trust before the portal runs it. Cancel of a run that is not running is refused.
- [ ] R12 UI: one follow loop per card (a newer one, or leaving the page, stops the old one); a way back after a start
  error; Cancel says it is cancelling.

### DAG, reuse and modes

- [ ] D1 Config: step `id` and `needs`, `max_parallel`, `blocks` with `use`, sub-pipeline steps expanded at load,
  `modes` and `default_mode`, `schedule` as a list with `mode`; every reference and cycle checked.
- [ ] D2 Runner: runs ready steps in parallel up to `max_parallel`; a failure skips its dependents only; a step outside
  the mode is skipped and counts as done for its dependents; `--mode`.
- [ ] D3 Schedules per mode: one OS entry per schedule, each run records its mode; the missed-run check per schedule.
- [ ] D4 Portal and UI: the flow drawn by levels (parallel steps side by side), a mode picker, the mode in history and
  in the summary of a run.
- [ ] D5 Docs: ADR 0011, docs/pipelines.md, CHANGELOG, the explainer page corrected (review part A) and extended.

## Acceptance criteria

- Each review finding confirmed by an experiment has a test that failed before its fix.
- A 0.6 pipelines.json runs exactly as before (linear, stop dependents on failure, same events plus new fields).
- Two independent steps with a 1 s sleep each finish in under 2 s with `max_parallel` 2.
- `npm test` green; ratchet and architecture tests green; the explainer matches the code.

## Progress

- 2026-11-08: plan written after the independent review and the user's answers on DAG, reuse, modes and schedules.
- 2026-11-08: R1 inline. RED: U+2028/NEL output hid run-end; `read_from` missing; the portal test on byte offsets.
  GREEN. The UI's switch from a count to `next` is a protocol change its test fixture cannot tell apart (no RED).

## Next step

R2: failing test for three concurrent run requests.
