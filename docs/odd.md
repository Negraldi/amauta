# ODD task files

Organic Driven Development (the always-on orchestrator block) tracks substantial work in `odd/tasks/<feature>.md`,
mirrored in memory under `odd/<feature>/tasks`. The portal (`#/feature`) and the MCP tool `odd_tasks_status` read
these files; `test/odd-format.test.js` pins the format and checks that both readers count the same items.

## Required sections

| Section | Content |
| --- | --- |
| `# Feature: <name>` | Title line, then a `Locator:` line (file, branch, memory mirror) |
| `## Objective` | What the feature delivers and why |
| `## Tasks` | The checklist (below); phases as `###` headings or a short bare line directly above an item |
| `## Acceptance criteria` | How completion is judged |
| `## Progress` | Dated entries: what was done, commits, test counts, deviations from TDD, routes (inline or delegated) |
| `## Next step` | The one next action, or `None: closed` |

Optional: `## Scope`, `## Constraints`, `## TDD` (mode and runner), `## Delivery`, `## Design`, `## Checks`.

## Checklist items

Only top-level items count:

- `- [ ] ID Title` open; `- [x] ID Title` done (record the commit hash on the line or in Progress);
  `- [!] ID Title` blocked (the word "blocked" in an open item also marks it).
- Indented checkboxes are notes inside the item above, not tasks.
- An item is checked only after its outcome and its checks were observed; while the code-security checks of its
  files fail it stays open (plan D8).

## Data tasks

A task that touches SQL, ETL, spreadsheets, Power BI or metrics adds three sections (ADR 0008):

| Section | Content |
| --- | --- |
| `## Criteria` | Acceptance criteria with stable IDs (`C1`, `C2`...), confirmed by the user in ODD step 3 |
| `## Contracts` | Paths of the handoff files under `odd/contracts/<feature>/` (metric, ETL, report); reviewers read them as they are |
| `## Review` | Written at close: lens and model, the reviewed commit range, one verdict per criterion (passed, failed, unverified), corrections and the delta re-check |

Contracts live outside `odd/tasks/` so task files keep this format.

## Checks before a check-off

An edit of `odd/tasks/*.md` that checks an item off (compared with the committed version) is refused while the changed
files of the repository have errors the checks engine sees (the same findings as the Stop check, see
[hooks.md](hooks.md)). Fix the errors, or leave the task open (plan D8, ADR 0006).

## Lenses and deliverables (ADR 0008)

- Approved results live in `odd/contracts/<feature>/`; deliverables for other people in `odd/deliverables/<feature>/`,
  written by the `chasqui` agent from those results only; review packs in `odd/reviews/<feature>/<kind>-<n>/`.
- `amauta review numbers --feature F` checks that every number in a text deliverable exists in the approved results at
  the precision shown (exit 1 otherwise); binary files are listed as not checked. The Stop check also validates the
  Mermaid fences and looks for secrets in changed deliverables.
- `amauta review pack --feature F --kind analytical|communication` writes the pack a fresh lens reads: `taripaq` for
  the analysis (one round plus a delta re-check), `haravec` for a deliverable (up to two rounds, a new reviewer each).
  The lenses run even with code review off; `Lenses: off` in the task file turns them off for that feature.
