# amauta

A small harness for Claude Code and Codex in plain Node.js and Python, modelled on
[gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) (MIT). No compiled
programs of our own, no npm dependencies and Python stdlib only for the core.

## Requirements

- Node.js >= 22 and Python >= 3.11 (`python3`; hooks and servers run it as `python3 -P`). Nothing to install.
- Optional, detected on `PATH` and never vendored: `codegraph` (npm `@colbymchenry/codegraph`) and `graphify`
  (PyPI `graphifyy`). `npx` is used by the opt-in `context7` and `rea` MCP entries.

## Install

```bash
amauta install --runtime claude|codex|both   # default: both once ~/.codex exists, else claude
amauta status  --runtime claude|codex|both
amauta uninstall --runtime claude|codex|both
```

Claude Code and Codex share one harness; neither is the master. What is shared, and how:

- one `memory.db` and the same `engram` memory server in both runtimes;
- one skill store (`~/.amauta/skills`) that both skills directories link to;
- MCP servers synced both ways, with conflicts reported and never overwritten;
- instruction blocks (`CLAUDE.md` / `AGENTS.md`) and hooks (`settings.json` / `hooks.json`) written to both;
- `amauta sync` and a silent `SessionStart` drift check keep the unavoidable copies in step;
- usage from both runtimes in the portal, with a runtime filter.

Details: [docs/install.md](docs/install.md).

## Upgrading

See [UPGRADING.md](UPGRADING.md) (`amauta upgrade --dry-run`, then `amauta upgrade`; rollback with `amauta upgrade --to <tag>`). Release notes are in [CHANGELOG.md](CHANGELOG.md).

## Layout

```
bin/amauta.js        CLI entry point
src/                 CLI router, installer, hook dispatcher, review, MCP server, portal launcher (Node)
python/amauta/       memory (MCP server), telemetry, usage, portal, graph, sdd, extras/ (stdlib only)
assets/              instruction blocks, skills, agents, output style, optional modules (see NOTICE)
test/, python/tests/ node:test and unittest suites
odd/tasks/           ODD feature documents (docs/odd.md)
MODULES.json         every file's module and layer (docs/architecture.md, test/architecture.test.js)
```

## Commands

```
amauta --help
amauta version
amauta install   [--runtime claude|codex|both] [--claude-home DIR] [--claude-json FILE] [--codex-home DIR]
                 [--codex-skills-dir DIR] [--state-dir DIR] [--dry-run] [--no-mirror-mcp] [--json]
                 [--with-sdd|rea|context7|impeccable|archify] [--without-<module>] [--review-mode on|off]
amauta sync      [--dry-run] [--json] [same dirs]     # Claude <-> Codex: MCP servers both ways, skill links, copies
amauta restore   --backup ID [same dirs] [--json]    # undo an install from its backup (ids: YYYYMMDDTHHMMSSZ)
amauta uninstall [same options]
amauta status    [same options]
```

```
amauta portal    [--port N] [--repo DIR]...      # local wiki portal (read-mostly)
amauta portal launch [--idle-exit S]             # app window (Chrome --app), stops the server when closed
amauta portal install-launcher [--remove]        # desktop entry (menu launcher), separate from `amauta install`
amauta codegraph init|status [--cwd DIR]
amauta graphify hook install|uninstall [--cwd DIR]
amauta graphify semantic [--cwd DIR] [--model M] [--timeout SECONDS]    # optional LLM pass, needs ANTHROPIC_API_KEY
```

```
amauta mermaid check FILE.md...               # validate ```mermaid fences (syntax only, no browser); exit 1 on errors
amauta skill-registry refresh [--cwd DIR] [--quiet] [--no-gitignore] [--force]
amauta skill-registry list    [--cwd DIR]
amauta review assess [--cwd DIR] [--base-ref REF] [--committed-only] [--json]
#   --base-ref / MCP base_ref accept plain refs only (no leading '-', '..' ranges or whitespace)
#   and are resolved to a commit sha before any git diff
amauta review mode   enable|disable|status [--scope global|clone] [--cwd DIR]
```

What each hook does: [docs/hooks.md](docs/hooks.md).

## Documentation

| Topic | Where |
| --- | --- |
| What install writes, sharing between Claude Code and Codex | [docs/install.md](docs/install.md) |
| Hooks and the dispatcher | [docs/hooks.md](docs/hooks.md) |
| Memory, code graph, telemetry, usage | [docs/memory-and-usage.md](docs/memory-and-usage.md) |
| Control portal (pages, settings, launcher, security) | [docs/portal.md](docs/portal.md) |
| Safety model and redirectable targets | [docs/safety.md](docs/safety.md) |
| Optional modules (SDD, archify, impeccable) | [docs/optional-modules.md](docs/optional-modules.md) |
| Migrating from gentle-ai | [docs/migrating.md](docs/migrating.md) |
| Architecture, modules, layers | [docs/architecture.md](docs/architecture.md), [docs/modules.md](docs/modules.md) |
| ODD task files | [docs/odd.md](docs/odd.md) |
| Decisions | [docs/decisions/](docs/decisions/README.md) |

## Tests

```
npm test            # node --test, then python unittest
npm run test:node
npm run test:py
node --test test/e2e.test.js   # end-to-end only
```

`test/e2e.test.js` installs (`--with-sdd`, telemetry on) into a fake HOME seeded with user settings, `claude.json` and
`CLAUDE.md`, runs every registered hook command with `sh -c` and a JSON payload (as Claude Code does), starts the
`engram` and `amauta` MCP servers from their `claude.json` entries (initialize, `tools/list`, one tool call), checks
the telemetry/usage rows in `memory.db`, fetches `/api/overview` from the portal on `127.0.0.1`, and finally uninstalls and
compares the files with their seeds. A fake `codegraph` on `PATH` enables the codegraph hook; nothing touches the real home
and nothing needs the network.

## License

MIT. Vendored upstream assets are credited in [NOTICE](NOTICE).
