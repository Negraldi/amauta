# Install: what it sets up

What `amauta install` writes for each runtime and how Claude Code and Codex share one harness. The commands are in the [README](../README.md#install).

## What `install` sets up for Claude Code

Into `~/.claude` / `~/.claude.json` / `~/.amauta` (all redirectable, see [safety.md](safety.md)):

| Piece | Details |
| --- | --- |
| `CLAUDE.md` (and `AGENTS.md` for Codex) | four short blocks (orchestrator, persona, memory protocol, codegraph guidance; under a 20k-char budget that `status` checks) between `<!-- amauta:ID -->` markers; your text is kept |
| Assets | output style, skills, agents (judgment-day, review lenses, `chasqui` the communicator), rendered with model assignments |
| Stack skills (original to amauta) | `cpp-testing`, `python-testing`, `node-testing`, `r-testing` (testing patterns for C++, Python, Node.js, R), `tabular-data` (Excel, Parquet, CSV, TXT), `doc-formats` (md, Rmd, html, pdf, docx, pptx), `mermaid-diagrams` (when and how to draw Mermaid in documentation) |
| Hooks (all with a `timeout`) | `UserPromptSubmit` skill-registry, `SessionStart`/`Stop` review-stop, `SessionStart` graphify-connect, telemetry on 5 events, usage on `Stop`/`SubagentStop`, `codegraph prompt-hook` if codegraph exists, `PreToolUse(Agent)` preflight with `--with-sdd` |
| MCP servers | `engram` (our Python memory server; `amauta-memory` if you already have another `engram`), `amauta` (Node: `skill_registry_refresh`, `review_assess`, `review_mode_status`, `odd_tasks_status`), `codegraph` (if installed) |
| Permissions | `ask`: `Bash(git push --force*)`, `Bash(git reset --hard*)`, `Bash(rm -rf*)` (prefix matches only, `rm -fr` or `sudo rm -rf` get past them). `deny` for `Read` and `Edit` of `.env`, `.env.*`, `~/.ssh/**`, `~/.aws/credentials`, `~/.config/gh/hosts.yml`, `*.pem`, `*.key`, `secrets/**`. No `defaultMode`, no allow entries |
| Optional | `--with-sdd` (SDD module), `--with-context7`, `--with-rea` (third-party MCP servers, off by default; choices are sticky until uninstall), `--with-impeccable` (design skill, see below), `--with-archify` (diagram skill, see below), `--no-telemetry` |

## Shared between runtimes

`install`, `uninstall` and `status` take `--runtime claude|codex|both` (default `both` once `~/.codex` exists, else `claude`).
Claude Code and Codex share one harness; neither is the master:

| Resource | How it is shared |
| --- | --- |
| Memory | one `memory.db` and the same `engram` server entry in both (only `AMAUTA_RUNTIME=claude\|codex` differs); memories are found by project label in either runtime |
| Skills | rendered once into the amauta store `<state dir>/skills/<name>`; `~/.claude/skills/<name>` and `~/.agents/skills/<name>` are symlinks to it (impeccable and archify included). An unedited real copy from an older install is replaced by the link; an edited one is kept and reported (`--force` replaces it) |
| Personal skills | a real skill directory in either skills dir gets a symlink in the other; the real copy stays where you made it, nothing is copied or moved. Same name as a real directory on both sides: reported as a conflict |
| MCP servers | every stdio server (`command`, `args`, `env`) goes both ways between `.claude.json` and `~/.codex/config.toml` as a 3-way merge against the last synced set (`<state dir>/mcp-sync.json`, hashes only). Changed or removed on one side only: copied. Changed differently on both: left as is and reported as a conflict in `amauta status` until you make one side match. Claude-only keys (`type`, ...) and Codex-only keys (`startup_timeout_sec`, ...) stay on their side. Non-stdio servers are listed and not synced. Runtime-internal servers (`node_repl`, `codex_apps`, or a command under `/usr/lib/chatgpt`, `/opt/claude`, `~/.codex`, `~/.claude`) are never synced; add your own names with `{"exclude": ["name"]}` in `mcp-sync.json` (`amauta status` lists them). Entries an older checkout left under amauta's names (hooks, `amauta`, `engram`, `amauta-memory`) are replaced on install and reported as legacy. `--no-mirror-mcp` turns it off for a run |
| Instructions, hooks | amauta writes both: the same blocks go to `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`; hooks go to `~/.codex/hooks.json` with the same commands tagged `AMAUTA_RUNTIME=codex` (no SDD preflight or codegraph prompt hook; Codex asks you to trust new hooks, amauta never writes that state) |

Output styles, agents and SDD commands are Claude-only; usage from both runtimes shows in the portal (Codex usage is tokens only, no prices). `amauta sync` runs the pass above on demand; a cheap `SessionStart`
step (`hook sync-check`, silent, a hash compare when nothing moved) runs it by itself when a source changed. `amauta status`
reports drift ("Codex out of sync"), MCP conflicts, and a parity section (MCP servers, skills and instruction blocks in one
runtime and not the other, hooks without a Codex event; informational, `--json` adds a `parity` key). Redirect with
`--codex-home` / `AMAUTA_CODEX_HOME` (else `CODEX_HOME`) and `--codex-skills-dir` / `AMAUTA_CODEX_SKILLS_DIR`. State lives in
`<state dir>/codex-state.json`; backups and `amauta restore --backup ID` work for Codex files too.
