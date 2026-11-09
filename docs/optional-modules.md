# Optional modules

Installed only on request (`--with-<module>`), sticky until `uninstall`.

## Optional SDD module (`install --with-sdd`)

Spec-Driven Development from gentle-ai v3.4.0, installed only on request and removed by `uninstall`
(the choice is sticky across plain re-installs).

- Skills `sdd-*`, agents `sdd-*`, shared contracts and commands renamed to `/amauta-sdd-*` (so they never
  collide with a gentle-ai install). Models come from the install state like the other agents.
- `python3 -P -m amauta.sdd status [change] [--cwd DIR] [--json] [--instructions]` and `continue [change]` are
  read-only and reproduce the `gentle-ai.sdd-status` v2 projection over `openspec/changes/<change>/`
  (proposal, specs, design, tasks, apply-progress, verify-report). Only the `openspec` artifact store is supported:
  a declared `engram`/`hybrid` store is reported as blocked. A task that names a path outside the workspace blocks apply
  (`blocked(edit_authority_missing)`); mark read-only inputs with `(read-only)`. There is no consent or grant machinery.
- The SDD preflight is a `PreToolUse` handler of the Node dispatcher (`hook event PreToolUse --with sdd-preflight`): an
  `sdd-*` subagent is dispatched only after the parent asked the three-question `AskUserQuestion` preflight
  (Interactive|Automatic, OpenSpec|Engram|Both, Ask me|Single PR|Auto) and the human answered it in the session
  transcript; the hook then prefixes the `## SDD Session Preflight` block to the prompt. It fails closed for `sdd-*`
  dispatches only (a deny decision when the check cannot run) and stays silent for other agents.

## Optional diagram skill (`install --with-archify`)

The [archify](https://github.com/tt-a1i/archify) skill (MIT, credited in [NOTICE](NOTICE), commit and checksums in `assets/manifest.json`),
installed only on request into `~/.claude/skills/archify`. The agent writes typed JSON and `bin/archify.mjs` validates it and renders a
self-contained HTML diagram (10 diagram types). It is pure Node with no npm dependencies, vendored as upstream published it except for the
update check, which is permanently off (the skill never touches the network). Sticky until uninstall; `amauta status` checks the CLI is there.
The portal uses the same CLI to draw the harness architecture on the Harness page when it is installed.

## Optional design skill (`install --with-impeccable`)

The [impeccable](https://github.com/pbakaus/impeccable) design skill (Apache-2.0, credited in [NOTICE](NOTICE)), installed only on
request, sticky until `uninstall`, which removes it together with its engine.

- Skill `impeccable` = upstream `skill-v3.9.1`: `craft`, `shape`, `critique`, `audit`, `polish`, `live` and the other design
  commands. Its helper scripts are plain Node with no npm dependencies and include their own static anti-pattern detector, so the
  skill works even if the engine install below fails.
- Engine: `npm install --prefix <state dir>/impeccable impeccable@3.6.1 --omit=optional --ignore-scripts --no-audit --no-fund`
  (pinned; needs `npm` on PATH and network once). The skill calls it as `node <state dir>/impeccable/node_modules/impeccable/cli/bin/cli.js detect|ignores`.
  An npm failure keeps the skill installed, prints the reason and exits 1; rerun `amauta install` to retry. `status` reports the engine
  version and flags a missing or different one.
- 3.x versus 4.x: impeccable 4.x moved its engine to a Rust binary (about 40 verbs), so it cannot run in a harness with no compiled code
  of its own. 3.x is the last pure-JavaScript line and therefore lacks what 4.x added. Not in this install: the `pin`, `unpin` and `hooks`
  commands (they write project hooks that point at a project-local skill copy), URL scanning (needs puppeteer, left out on purpose),
  self-update (`amauta install` is the update path; the boot script's once-a-day version poll is disabled), and anything specific to 4.x.
