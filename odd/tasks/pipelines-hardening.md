# Feature: pipelines hardening, a third review and a cleanup

Locator: `odd/tasks/pipelines-hardening.md` (branch `feat/amauta-next`, after `7cb2bc4`). Engram mirror:
`odd/pipelines-hardening/tasks`. Follows `odd/tasks/pipelines-dag.md` (closed). Decisions: ADR 0010, 0011.

## Objective

Close the three follow-ups left open by the second review, have the result reviewed independently a third time, fix
what it finds, then leave the pipelines extra simpler: clear module boundaries, short functions, comments and docs
that match the code. The explainer page is updated last.

## Scope

In: `python/amauta/extras/pipelines/`, the Pipelines tab scripts, their tests, docs/pipelines.md, ADR 0011 (no new
decision expected), the explainer page. Out: new features beyond the three follow-ups.

## TDD

Strict, ON. Runner: the three Python pipeline suites, `node --test test/portal-pipelines-ui.test.js`, then `npm test`.
Refactors keep the suites green without changing tests' expectations (a test that must change says why).

## Tasks

### Follow-ups

- [x] M1 A card refreshes its last run, history and details when a live run it follows ends.
- [x] M2 Windows: a step runs in a job object; timeout, cancel and the step's end stop every process in the job.
- [x] M3 The lock records its process's start time; a reused pid with another start time is stale.

### Third review

- [x] M4 Independent review with tests and experiments on the result of M1-M3.
- [x] M5 Fix what it confirms, each with a failing test first:
  - F1 processes: a zombie runner is dead and the portal reaps before locking (C1); no 0.1 s floor per step (C2); a
    detached child holding the output does not hold a timeout or cancel (C3); skipped steps do not wait for a slot
    (C7); the run's own setup sits inside its try (S4).
  - F2 lock: `ps` read in a fixed locale and zone, start times compared only when taken the same way (C4); a damaged
    lock is stale (C11); Windows argtypes (S1); adopt under the guard (S3); `--events` must stay in the runs folder
    (C6).
  - F3 store, portal and UI: run names reserved on disk (C8); retention removes logs (C9); incomplete events do not
    break a summary (C10); duplicated launchd text (C12); replay by step id (C5); refresh after an abandoned run and
    only from the newest request (C14); a job whose limits cannot be set is not used (S2); the portal's child
    bookkeeping is thread safe and bounded (S5); a failed launch releases the lock (S6).

### Cleanup

- [x] M6 Refactor and simplify: one responsibility per module, short functions, no duplicated helpers, comments and
  headers that say what the code does now; docs/pipelines.md and ADR 0011 checked against the code.
- [x] M7 The explainer page shows the design, the flow and the components as they are.

## Acceptance criteria

- Each behavior change has a test that failed first; refactors keep every suite green.
- Windows behavior is covered by tests that run on the Windows CI job (skipped elsewhere).
- `npm test` green; ratchet and architecture tests green.

## Progress

- 2026-11-08: plan written from the user's request (three follow-ups, a review, a fix round, a cleanup, the page).
- 2026-11-08: M3 inline. RED: `pidinfo` missing; a lock held by this process's pid with another start time stayed
  held. New module `pidinfo.py` (alive, started_at: /proc, ps, GetProcessTimes); `lock.py` no longer holds process
  queries. GREEN.
- 2026-11-08: M1 inline. RED: after a live run ended the card kept its old history (2 marks). The card now groups
  schedules, the first failure, outputs and the history marks, and reloads them from `/api/pipelines` when the run it
  follows ends. GREEN (18 UI tests).
- 2026-11-08: M2. RED on the Windows CI job with the tests alone (`8199314`): a leftover child outlived its step,
  the DAG suite's background-child test took 8 s, and fifty run names in a row gave seven distinct ones (the Windows
  clock repeats microseconds). macOS failed a portal test whose Popen mock also caught `ps` in pidinfo. Fixes:
  `winjob.py` (a job object per step), `proc._Tree` (group or job, one place to stop a step's processes), run names
  bumped when taken, the portal's `_spawn` mocked instead of Popen. CI green on Linux, macOS and Windows (`1bc949f`).
- 2026-11-08: M4 third independent review on `1bc949f`: 14 confirmed, 7 suspected, no flaky test in 3 runs, the
  second review's fixes re-verified. Plus a cleanup list (duplicated helpers, five lock path derivations, dead code,
  stale docstrings) kept for M6.

## Next step

None: closed.
- 2026-11-08: M5 F1 inline. RED: a zombie holder kept a lock (and a SIGKILLed portal runner gave 409 forever), 40
  trivial steps took over 4 s, a child in its own session holding the output kept a step for its full sleep, skipped
  steps waited for a slot, a setup error left the lock. Fixes: `pidinfo` treats a zombie as dead and reads `ps` in C
  locale and UTC; the portal reaps before locking; `proc` reads output in a thread and gives up on it 2 s after the
  tree was stopped (with a line saying so); `done.wait` instead of sleep; skips before slots; setup inside the try.
- 2026-11-08: M5 F2 inline. RED: a start time taken another way (`ps` vs `/proc`) made a live lock stale, a damaged
  `t` raised, `--events` outside the runs folder skipped the lock. Fixes: start times compared only when taken the
  same way, damaged locks stale, adopt under the guard (S3, a race without a deterministic test), Windows argtypes and
  FILETIME (S1, checked by the Windows CI job). Two tests changed on purpose: M3's reused start time now carries the
  system's prefix, and the SIGTERM test writes its events in the runs folder.
- 2026-11-08: M5 F3 inline. RED: names repeated under a frozen clock across threads (checked against the previous
  store), logs survived retention, an incomplete step-end raised KeyError, launchd printed "save as" twice, a failed
  launch kept the lock 60 s, a replayed run marked steps by index after a reorder, an abandoned live run did not
  refresh the card. Fixes: new_run creates the file with O_EXCL, retention removes cancel and log files, summaries skip
  incomplete events, the launch failure releases the lock (500), replay by id, refresh on abandoned runs and only from
  the newest request; S2 (job without kill-on-close is not used) and S5 (portal bookkeeping under a mutex, bounded)
  without a deterministic test. Two tests changed on purpose: pruning counts the new run's file, the thread test stays
  under KEEP. npm test: 850 Node, 930 Python.
- 2026-11-08: M6 cleanup, no behavior change, suites green without changed expectations: one PYTHONPATH filter and one
  default interpreter (`proc.without_amauta`, `proc.default_python`), one lock path for a run (`lock.for_run`,
  `store.pipeline_of`, five derivations before), one hash helper (`config.file_sha256`), one set of kernel32
  prototypes (`winjob.kernel32`, used by pidinfo); the portal's run split into `_validate`, `_command`, `_remember`;
  `proc._Tree.close` closes the job or sweeps the group, not both; dead code removed (`runner.argv_for`, `_trusted`,
  the follow checkbox's no-op listener, an unused import); headers of config, store, proc, runner, winjob and the
  portal rewritten to match the code; docs/pipelines.md updated; ADR 0012 records process ownership and lock identity.
- 2026-11-08: M7: the explainer page (claude.ai artifact, private) republished against `561d511`: new diagrams for a
  step's processes (tree, reader thread, watcher) and the lock's cycle (take, adopt, release, stale cases), updated
  components and code map (pidinfo, winjob), limits, and the three reviews. CI green on Linux, macOS and Windows.

