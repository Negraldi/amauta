# Feature: portal paths outside home, MCP refresh size, disabled plugins

Locator: `odd/tasks/portal-paths-probe.md` (branch `fix/test-hygiene`, PR #14, worktree `~/amauta-dev`). Engram mirror:
`odd/portal-paths-probe/tasks`.

## Objective

Bugs and limits found on 2026-10-17 while configuring the user's projects and writing the harness wiki notes.

## Tasks

- [x] H1 Tests stop reading the real `portal.json` and stop leaking temp dirs (`492cb9f`, `4737883`).
- [x] H2 (`0a4e23d`, delegated writer, node 617 / python 723 green) Configured project paths may live outside `$HOME` (e.g. `/mnt/datos/...`): explicit config/`--repo`/Settings only,
  never auto-discovery; still absolute, existing, resolved, not `/`, not `$HOME` itself, not system trees (`/proc`, `/sys`,
  `/dev`, `/run`, `/etc`, `/usr`, `/bin`, `/sbin`, `/lib*`, `/boot`, `/var`, `/tmp`).
- [x] H3 (`a71ea56`, delegated writer, node 617 / python 726 green; MAX_LINE 16 MB, MAX_OUTPUT 32 MB, MAX_TOOLS 500) "Refresh descriptions" handles servers with large tool lists (rea, ~200 tools): raise or restructure the
  response caps so rea refreshes; cached result still bounded.
- [x] H4 (`e3372ff`, delegated writer, node 617 / python 731 green; `disabled` flag + summary status, en+es) Components of disabled plugins (hooks, MCP, skills, agents, commands) are labelled as disabled (they do not run).

## Acceptance criteria

- `npm test` exit 0 on every commit; RED seen first for each behavior change.
- The user's `/mnt/datos/drive/Desktop/Migracion_Linux` and `/mnt/datos/drive/Desktop/HP` can be saved in `portal.json`.
- A refresh against a fake server with 250 tools and long schemas succeeds.

## Progress

- 2026-10-17: H1 done; H2-H4 delegated to one writer and done (`0a4e23d`, `a71ea56`, `e3372ff`). `npm test` exit 0 at each commit.

- 2026-10-17: PR #14 merged as `b351522`; release 0.3.1 prepared (version bump, CHANGELOG, UPGRADING).

## Next step

Merge the 0.3.1 release PR, tag `v0.3.1`, user runs `amauta upgrade --to v0.3.1`.
