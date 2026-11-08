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
- [ ] M2 Windows: a step runs in a job object; timeout, cancel and the step's end stop every process in the job.
- [x] M3 The lock records its process's start time; a reused pid with another start time is stale.

### Third review

- [ ] M4 Independent review with tests and experiments on the result of M1-M3.
- [ ] M5 Fix what it confirms, each with a failing test first.

### Cleanup

- [ ] M6 Refactor and simplify: one responsibility per module, short functions, no duplicated helpers, comments and
  headers that say what the code does now; docs/pipelines.md and ADR 0011 checked against the code.
- [ ] M7 The explainer page shows the design, the flow and the components as they are.

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

## Next step

M2: Windows job objects, with a test that runs on the Windows CI job.
