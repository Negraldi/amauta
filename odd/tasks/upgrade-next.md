# Feature: upgrading an amauta install across versions, and onto a preview branch

Locator: `odd/tasks/upgrade-next.md` (branch `feat/amauta-next`, after `3dde1b4`). Engram mirror:
`odd/upgrade-next/tasks`. Decided with the user on 2026-11-09 (all four improvements).

## Objective

Make the move from an install of 0.4.0 (the latest release tag, on `main`) to amauta-next safe and explained:

1. U1 Notes for the whole jump: `amauta upgrade` prints every `UPGRADING.md` section between the current version and
   the target (0.4.0 to 0.7.0 shows three), read from the target, before asking and again at the end.
2. U2 An end-to-end test: a real 0.4.0 install (its own code, from the git history) in temporary homes, then the
   current install over it: `status` is clean and no 0.4.0 hook command is left.
3. U3 `amauta upgrade --branch NAME`: a preview channel to the tip of `origin/NAME` without a release tag (a local
   branch NAME tracking it is created or fast-forwarded; the branch you were on is the rollback).
4. U4 A dry-run report: `--dry-run` fetches (refs only), runs the target's own installer with `--dry-run --json` from a
   temporary worktree with the same path flags, and lists the files it would write or remove, the legacy entries it
   would replace and the sticky choices it keeps.

## Scope

In: `src/install/upgrade.js`, a new `src/install/upgrade-plan.js`, `test/upgrade.test.js`, `test/upgrade-e2e.test.js`,
docs (`UPGRADING.md`, `docs/` install pages, the guide's install page in both languages, CHANGELOG).
Out: tagging or merging (the user's decision); migrating the memory database (each version migrates itself).

## Constraints

- No dependencies; no shell (`spawn` with argument arrays); a branch name passes `git check-ref-format --branch`, may
  not start with `-` and must exist on origin; `--branch` and `--to` exclude each other.
- The dry run changes no file of the install or the homes; its temporary worktree is always removed.
- Simplicity ratchet: `runUpgrade` is over the function limit in the baseline and may only shrink.
- Tests never touch the real homes: temporary `--claude-home`, `--claude-json`, `--state-dir`, and `HOME`.

## TDD

Strict, ON. Runner: `node --test test/upgrade.test.js test/upgrade-e2e.test.js`, then `npm test`.

## Tasks

- [x] U1 Notes across the jump (parser by semver, read from the target ref).
- [x] U2 End-to-end 0.4.0 to current (skipped with a reason when the 0.4.0 commit is not in the clone).
- [x] U3 `--branch NAME`.
- [x] U4 Dry-run report from the target's installer.
- [ ] Q1 Cleanup; Q2 independent review; Q3 fixes; Q4 cleanup.
- [ ] D1 Docs; commit and push.

## Acceptance criteria

- The four behaviors have tests that failed first; the existing upgrade tests still pass.
- `npm test` green; ratchet and architecture green.

## Progress

- 2026-11-09: plan written from the user's request.

- 2026-11-09: U1, U3, U4 TDD (RED: 3 tests; the refusal test passed before only because --branch was unknown, it now
  checks real validation). runUpgrade split into short functions: the baseline loses its fn, long and header entries.
  U2: a characterization test (0.4.0 installed from the history, then the current install; it passed at once, as the
  migration already existed); CI's full job fetches the whole history so it runs there instead of skipping.

## Next step

Q1 cleanup, Q2 review.
