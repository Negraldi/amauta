# amauta

A small Claude Code harness in plain Node.js (>= 22) and Python (>= 3.11, stdlib only, always run as `python3 -P`). No
compiled code of our own, no npm dependencies, no network in hooks or servers. Start with `README.md`.

## Layout

- `bin/amauta.js`, `src/cli.js`: CLI router. `src/install/`: install, uninstall, status. `src/core/`: marker injector, JSON merge, atomic writes, backups.
- `src/review/`, `src/registry/`, `src/hooks/`, `src/mcp/`: `review assess`, Stop reminder, skill registry, hook entrypoints, the `amauta` MCP server.
- `python/amauta/`: memory (MCP server), telemetry, usage, portal, graph, sdd. Tests in `python/tests/`.
- `assets/`: vendored upstream assets (see `NOTICE`): the four always-on CLAUDE.md blocks, output styles, skills, agents, optional SDD module.
- `test/`: `node:test` suites. `odd/tasks/<feature>.md`: feature documents; read the "Next session" block first.

## Verify

`npm test` (Node suites, then Python unittest). End to end only: `node --test test/e2e.test.js`.
Done = `npm test` green, plus a failing test seen first for any behavior change (strict TDD).

## Rules

- Never touch the real `~/.claude`, `~/.claude.json`, `~/.gentle-ai`, `~/.amauta` or `~/.engram`. Tests and manual runs use temp dirs via `AMAUTA_CLAUDE_HOME`, `AMAUTA_CLAUDE_JSON`, `AMAUTA_STATE_DIR` (or the matching `--claude-home/--claude-json/--state-dir` flags).
- The always-on CLAUDE.md blocks must stay under 20k chars in total (`amauta status` reports it, a test pins it). Prefer deleting over adding.
- No `gentle-ai` commands or consent/receipt machinery in installed assets (attribution in `NOTICE` and the manifest excepted).
- English artifacts, Conventional Commits, no AI attribution lines in commits. About 400 authored lines per commit is a guide, not a cap.
- Hooks fail open (exit 0, empty stdout) except the SDD preflight guard, which fails closed for `sdd-*` only.
