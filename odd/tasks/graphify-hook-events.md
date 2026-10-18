# Feature: graphify hook on merge, rewrite and branch switch

Locator: `odd/tasks/graphify-hook-events.md` (branch `feat/graphify-hook-events`, worktree `~/amauta-dev`). Engram mirror:
`odd/graphify-hook-events/tasks`.

## Objective

`amauta graphify hook install` only managed `post-commit`, but git never runs `post-commit` for history that arrives by
`pull`/`merge`, `rebase`/`commit --amend` or a branch switch, so the portal graph went stale after those. Seen on
2026-10-18 while mirroring the user's repos (amauta itself advanced by a fast-forward merge that never synced).

## Scope

- `src/graphify/hook.js`, `test/graphify-hook.test.js`, `README.md`.
- Out of scope: graphify's own installer; existing non-graphify hook content is always kept.

## Tasks

- [x] E1 (inline, hook suite 38/38, npm test node 622 / python 731 green) install/uninstall manage the marked block in `post-commit`, `post-merge`, `post-rewrite` and `post-checkout`
  (the last one only acts on branch switches, `$3 = 1`); CLI output lists every file; README documents it.
- [ ] E3 SessionStart hook `graphify-connect`: in a git repo that has `graphify-out/graph.json` but no amauta block,
  install the event hooks and run one background refresh, so a future graphify project reaches the portal without a
  manual step. `uninstall` records an opt-out (`git config amauta.graphifyHook false`) that the auto-connect honours;
  an explicit `install` clears it. (User decision 2026-10-18: trigger on opening Claude.)
- [ ] E2 install removes graphify's own `# graphify-*hook-start` ... `# graphify-*hook-end` blocks from those four hooks
  (they rebuild the graph without mirroring it and race amauta's lock) and says so.

## Acceptance criteria

- A fast-forward merge (no commit hook run) mirrors the new graph into memory.db.
- A file checkout (`git checkout -- f`) does not trigger a refresh; a branch switch does.
- Uninstall restores every touched hook to its original bytes (or deletes files only we created).
- `npm test` exit 0; RED seen first for each behavior change.

## Checks

TDD: on (strict, CLAUDE.md). Runner: `node --test test/graphify-hook.test.js`, then `npm test`.

## Route

E1-E3 inline: the context (hook.js, its tests) was already loaded in this session; one file plus its test.

## Progress

- 2026-10-18: worktree and branch created from `origin/main` (`1830ab5`); baseline hook suite 33/33.
- 2026-10-18: E1 RED (3 of 4 new tests failing) then GREEN; user asked that future graphify projects connect on their own (E3).

## Next step

E2 RED tests, then E3.
