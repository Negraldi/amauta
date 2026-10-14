# gentle-lite

A small Claude Code harness in plain Node.js (>= 22) and Python 3.12, modelled on
[gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) (MIT). No compiled
programs, no npm dependencies for the core.

## Layout

```
bin/gentle-lite.js   CLI entry point
src/cli.js           command router
src/core/            marker injector, JSON merge, atomic writes, backups
src/install/         install / uninstall / status
assets/              vendored orchestrator, persona, skills, agents (see NOTICE)
python/              Python helpers and tests (stdlib only)
test/                node:test suites
odd/tasks/           feature documents
```

## Commands

```
gentle-lite --help
gentle-lite version
gentle-lite install   [--claude-home DIR] [--claude-json FILE] [--state-dir DIR] [--dry-run]
gentle-lite uninstall [same options]
gentle-lite status    [same options]
```

```
gentle-lite skill-registry refresh [--cwd DIR] [--quiet] [--no-gitignore] [--force]
gentle-lite skill-registry list    [--cwd DIR]
gentle-lite review assess [--cwd DIR] [--base-ref REF] [--committed-only] [--json]
gentle-lite review mode   enable|disable|status [--scope global|clone] [--cwd DIR]
```

Hooks registered in `settings.json` run `node <repo>/bin/gentle-lite.js hook <name>` (absolute
path, no `PATH` dependency). They read the Claude Code hook JSON on stdin, always exit 0 and
fail open; an empty stdout is a no-op.

- `skill-registry` (UserPromptSubmit): refreshes `<project>/.atl/skill-registry.md` only for
  projects that opted in (an existing `.atl/` directory or `.atl/` in `.gitignore`; run
  `gentle-lite skill-registry refresh` once to opt in). Skips `/`, `$HOME`, directories without
  a project marker and a symlinked `.atl`. Home paths are written as `~/...`.
- `review-stop` (SessionStart/Stop): when receipt-driven development is on and this session
  produced a candidate that `review assess` marks as due, blocks the stop once per candidate.
  `--base-ref` / `base_ref` accept only plain refs (no leading `-`, no `..` ranges, no whitespace) and are resolved to a commit sha before any git diff.
  RDD is off by default; clone-local `off` (in `.git/gentle-lite-rdd-mode`) wins over global.

## Safety: parameterized targets

Nothing is hardcoded to the real home. Every target can be redirected, and tests
only ever use temp directories:

| Option | Environment variable | Default |
| --- | --- | --- |
| `--claude-home` | `GENTLE_LITE_CLAUDE_HOME` | `~/.claude` |
| `--claude-json` | `GENTLE_LITE_CLAUDE_JSON` | `~/.claude.json` |
| `--state-dir` | `GENTLE_LITE_STATE_DIR` | `~/.gentle-lite` |

If only `--claude-home` is given, the other two default to paths inside it
(`<home>/.claude.json`, `<home>/.gentle-lite`), so a sandboxed install never touches the real home.

Every file is backed up under `<state-dir>/backups/<timestamp>/` before it is written.
Existing user content (CLAUDE.md text, hooks, MCP servers, `permissions.defaultMode`)
is preserved. `permissions.defaultMode` is never set or changed (upstream forces
`bypassPermissions`; gentle-lite deliberately does not), and the deny list is merged, not replaced.
Files gentle-lite installs are tracked by hash: if you edit one, re-install and uninstall keep your
version unless you pass `--force`.

## Tests

```
npm test            # node --test, then python unittest
npm run test:node
npm run test:py
```

## License

MIT. Vendored upstream assets are credited in [NOTICE](NOTICE).
