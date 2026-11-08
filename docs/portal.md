# Control portal

The local wiki portal: pages, routes, the settings editor, the launcher and its security model (ADR 0005).

A local wiki over everything the harness knows: memories, skills, tools, MCP servers, sessions, ODD features and code-graph nodes,
each a linked page with backlinks. Stdlib Python server plus a vanilla JS single-page UI; no CDN, no network, binds `127.0.0.1` only.

```
amauta portal [--port 8765] [--repo DIR]... [--claude-home DIR] [--engram-db FILE] [--idle-exit S]
amauta portal launch [--idle-exit S]       # opens an app window (Chrome or Edge --app) and stops the server when it closes
amauta portal install-launcher [--remove]  # desktop entry (Linux) or Start menu shortcut (Windows); not part of `amauta install`
```

(`PYTHONPATH=python python3 -P -m amauta.portal ...` is the same server without the CLI wrapper.)

Six pages in the sidebar (ADR 0005): Home, Projects (tabs: ODD features, Graph), Memory (Lint), Activity (Usage, Sessions,
Tools, MCP servers), Harness (Skills, Components) and Settings (Themes). The top bar holds only search. Range, Project and
Runtime filters sit above the pages that use them. The foot of the sidebar has a theme picker (System, Light, Dark, your custom
themes) and an English/Spanish switch for the interface (your own text stays as written; dates are always `YYYY-MM-DD`). The
dictionaries are `static/i18n/{en,es,srv-es}.json`.
Projects come from `--repo`, from `<state>/portal.json` (`{"repos": [...], "auto_discover": true}`, also editable in Settings > Projects) and from the git roots of your sessions. Configured paths may live anywhere (for example a data disk), except `/`, your home directory itself and system directories (`/etc`, `/usr`, `/var`, `/tmp`, ...); auto-discovery only looks inside your home directory and skips linked git worktrees (`git worktree add`; their `.git` is a file), which are checkouts of a project rather than projects, while a worktree you configure yourself is kept; `amauta portal launch` passes the configured ones. Custom themes live in `<state>/themes/*.json`.

### Routes

| Route | Page |
|---|---|
| `#/` | Home: recent activity by day; rail with spending, skill-impact ranking, harness health |
| `#/memory[/id-or-topic_key]` | Memory: text, derived links and backlinks, same-topic rows, related graph nodes |
| `#/skill` | Catalog of every skill (installed, plugin, project, built into Claude Code), filterable |
| `#/skill\|tool\|mcp[/name]` | What a skill does, rendered `SKILL.md`, usage over time, sessions, attributed tokens, impact |
| `#/component` | Harness wiki catalog: hooks, MCP servers and tools, connectors, built-in tools, agents, commands, plugins, output styles |
| `#/hook\|mcp\|mcptool\|connector\|tool\|agent\|command\|plugin\|outputstyle/id` | What a component does and when it runs, with the source of each fact (see below) |
| `#/session[/id]` | Skills, tools, subagents, tokens and memories of one session |
| `#/feature[/project/name]` | ODD document, progress, resolved commits, status-grouped task diagram |
| `#/node[/repo::id]` | Graph node, grouped neighbours, neighbourhood diagram |
| `#/usage` (`#/activity`) | One summary sentence, token charts, model split, cost estimate (Range, Project and Runtime filters live here) |
| `#/harness` | Install state and architecture diagram (`#/diagrams` redirects here) |
| `#/project[/name]` | Projects (`--repo`, `portal.json`, git roots of your sessions): ODD features with progress, sessions, memories, graph status |
| `#/themes` | Theme editor: custom light/dark themes with live preview, contrast warnings, import and export |
| `#/memfile/id` | A Claude file memory (`projects/*/memory/*.md`), read-only |
| `#/lint` | Review candidates (see below) |
| `#/settings` | Guarded settings editor (see below) |

Search with `Ctrl+K` or `/`: one query across memories (FTS5), skills, tools, MCP servers, sessions, features, tasks and graph nodes.
Memory links are derived, because the store keeps no relation table: `[[wikilinks]]` (`[[topic]]`, `[[kind:id|label]]`), the `topic_key`
hierarchy, whole-word mentions (12+ characters) and graph labels. The store keeps only the latest revision of a memory; the page says so.
All text from memories, repos and graphs is rendered through text nodes by a small markdown subset (no raw HTML), under a strict CSP.

### Lint (`#/lint`, `GET /api/wiki/lint?days=30`)

Counts and links for seven checks, all capped and read-only. They are prompts to review, never verdicts.

| Check | Meaning |
|---|---|
| Orphan memories | No wikilink, topic neighbour or mention connects them to another page |
| Possible duplicates | Same or near-identical title under different `topic_key`s (same project) |
| Possibly superseded | Same type and topic prefix, similar title, a newer save |
| Installed skills never used | No load in the window (needs usage data) |
| ODD tasks checked without a commit | No commit hash on the task line or in a progress line naming its id |
| Wikilinks to missing pages | Target is not a memory, skill, tool, MCP server, session, feature or node |
| Stale explanations | A harness component changed after its explanation note was written, or no longer exists |

### Harness wiki (`#/component`)

Every component of the harness has a page that opens with "What it does" and "When it runs" and names where each fact came from (a file path,
"Built into Claude Code" or "Usage only"). Facts are rebuilt from the real files on each request (cached for a couple of seconds): hooks from user,
project and plugin settings, MCP servers from `.claude.json`, `.mcp.json` and plugins, agents, commands and output styles from their folders and plugins,
plugins from their manifests, built-in tools from a curated English and Spanish catalog, connectors from the server names your sessions called that no local
config explains. Components of a plugin that `settings.json` disables (`enabledPlugins: false`) stay listed and are labelled "Plugin disabled: does not run". MCP configs show type, command and arguments with secrets masked, and the NAMES of env variables and headers, never their values.

- **Graph sync** (project page, `#/project/<name>`): shows when the graph was last mirrored and, for git projects, whether it is older than the last commit. **Sync graph now** (`POST /api/projects/graph-sync`, `{"project": name}`) starts one background refresh for that project, git or not, and answers 202 at once: `python3 -P -m amauta.graph.refresh --repo DIR` takes the repo's graphify lock (the hooks' lock in a git repo, `graphify-out/.amauta-graphify.lock` otherwise), runs `graphify update .` and `graphify check-update .`, and mirrors the graph into `memory.db`. It answers 409 when `graphify` is not on the portal's `PATH`. **Connect** (`POST /api/projects/graph-connect`, same body) appears for a git project without amauta's hooks and runs `amauta graphify hook install --cwd DIR --state-dir STATE`. Both use the same guard as the other writes, accept only a project name the portal already lists (never a path) and a closed one-key body.
- **Refresh descriptions** (`POST /api/harness/refresh`, optional `{"server": name}`): same guard as the other writes. It starts each configured command-based
  MCP server (never http, sse or connectors), asks `tools/list` over JSON-RPC (10 s per server, process group killed afterwards, no shell) and caches names,
  descriptions and parameter names in `<state>/wiki/mcp-tools.json`. Env goes to the process only.
- **Request explanation** (`POST /api/harness/explain`, `{"kind", "id"}`): queues a request in `<state>/wiki/requests.jsonl`. The portal never calls a model:
  ask Claude Code to process the wiki explanation requests (shipped skill `amauta-wiki-explain`), which uses
  `python3 -P -m amauta.extras.wiki_explain list` and `... write --kind K --id I --file note.md`. Notes live in `<state>/wiki/notes/<kind>/` with the
  hash of the source they were written from; the lint flags notes whose component changed.

### Settings editor (`#/settings`)

Changes a closed list of options, and nothing else: persona (`gentleman`/`neutral`), review mode, telemetry, the optional modules
(`sdd`, `rea`, `context7`, `impeccable`, `archify`) and "reinstall / repair". The portal never edits a harness file itself; every change
goes through `amauta install`.

1. **Preview** runs `amauta install --dry-run --json` and shows the files that would be written, removed or kept (edited files are kept).
2. **Apply** needs the one-time token from that preview (valid 5 minutes, bound to the chosen options and the `state.json` hash, one apply
   at a time) plus an explicit confirmation. The installer backs up first and reports the backup id.
3. **Undo** previews and re-runs the same install with the settings that were in place before the newest portal change (its own token, lock and fresh backup); it never restores file snapshots, so edits made since to `~/.claude.json`, `settings.json` or `CLAUDE.md` survive, and it is refused when the settings changed since. `amauta restore --backup <id>` stays a CLI-only expert tool.

Guards: POST only, JSON only (4 KB cap), per-process token header, `Host` and `Origin` checks, closed schema (unknown keys and values are
rejected), options reach the installer as argv entries (no shell). Limit: undoing a change that turned `impeccable` off does not bring its
npm engine back; run reinstall / repair.

### Skill impact (comparative, not causal)

Skill pages and the Home rail compare sessions that loaded a skill with sessions that did not: tool error rate, retries (same tool within
3 calls after an error), output tokens per turn after the load, test-command failure rate and loaded-but-unused. Every number carries
`n` and the sessions behind it; a side with fewer than 5 sessions is suppressed ("not enough data"); small differences read "no clear
difference". **Correlation caveat:** skills are loaded for harder or different tasks, so a worse number is not proof the skill hurts. A per-skill change
log (sha256 of each installed `SKILL.md` and the git commits touching it) lets you read before and after windows. Telemetry stores outcome
classes only (ok/error/denied, exit class, "is a test command"), never tool input, output, paths or commands. Opening a skill page records the
hash of its installed `SKILL.md` (hash and first-seen time, no text) in `memory.db`; that is the one write a page view can cause (the guarded POSTs are listed under Security).

### Archify (harness architecture)

When the optional archify module is installed (`install --with-archify`), `#/harness` draws the architecture with the vendored archify CLI:
hooks above the hub in lifecycle order, installed assets and state stores beside it, MCP servers below, one line per group. The generated
JSON uses generated ids and capped labels, is rendered in a temp dir with a scrubbed environment, and is shown in a `sandbox="allow-scripts"`
iframe from its own route (`/archify/<hash>.html`) under a separate CSP. Without node or the module the page falls back to the Mermaid diagram.

### Launcher

`amauta portal launch` picks a free port on 127.0.0.1, starts the portal detached (log in `<state>/portal/portal.log`, run file
`<state>/portal/run.json`) and opens Google Chrome/Chromium (`AMAUTA_BROWSER` overrides) as an `--app=` window with its own profile
(`<state>/portal/browser-profile`). When the window closes the server gets SIGTERM (SIGKILL after 5 s) unless another launcher is still
attached; a second launch reuses the running server; without a Chromium-family browser it falls back to `xdg-open`. On Windows
it opens Edge or Chrome from their install folders, else `explorer.exe`. The page sends a
heartbeat every 10 s and a launched server (`--idle-exit`, default 30 s) exits once the heartbeats stop. `install-launcher` writes
`~/.local/share/applications/amauta-portal.desktop` (override: `--applications-dir` or `AMAUTA_APPLICATIONS_DIR`) with `Terminal=false`;
on Windows it writes the Start menu shortcut `amauta.lnk` through PowerShell.

### Security

The server checks the `Host` header against DNS rebinding, serves a strict CSP (scripts from this origin only, no eval, nothing loaded from or
sent to another origin; inline styles are allowed because Mermaid writes them into its SVG) and opens every database with `mode=ro` (never
created, never migrated). Writes are limited to three guarded POST endpoints: Refresh usage (`/api/refresh`, the usage backfill),
the heartbeat, and the settings editor above; each needs the per-process token and a same-origin check. Hook command text and MCP
`args`/`env` of other tools are never exposed. Cost estimates stay off unless `<state>/prices.json` exists
(`{"models": {"<model>": {"input": N, "output": N, "cache_read": N, "cache_write": N}}}`, prices per million tokens; a missing key counts as 0, a non-numeric or negative value is reported under `invalid_prices` and that model is not costed).

### Diagrams (Mermaid)

The portal ships a vendored, unmodified Mermaid build (`python/amauta/portal/static/mermaid.min.js`, MIT, version and sha256 in `NOTICE` and
`assets/manifest.json`; no CDN) that is loaded only when a diagram is first drawn. It runs with `securityLevel: 'strict'` and
`startOnLoad: false`, and the returned SVG is adopted as DOM nodes, never as an HTML string. Mermaid source is generated server-side
(`python/amauta/portal/diagrams.py`): node ids are generated, and every label that comes from a repo, a graph or the install state is quoted and
entity-escaped (quotes, brackets, backticks, `<`, `>`, newlines, `#`, `;`) and truncated, so a hostile label cannot add nodes or `click` directives. Where it shows:

- Harness page: the install architecture. Feature and project pages: one task-progress flowchart per `odd/tasks/*.md` (green done, orange pending, capped at 40 tasks). The old Diagrams page is gone; `#/diagrams` redirects to Harness.
- Memories, graph memory: selecting a node also draws its neighborhood (nearest 30 nodes and up to 30 edges; `GET /api/graph/diagram`).
- Memories: the portal shows markdown as plain text, and now also draws the first five ```` ```mermaid ```` fences of the selected file or memory below it.

The Content-Security-Policy had to loosen one directive for this: `style-src 'self' 'unsafe-inline'` (verified in Chromium: Mermaid applies inline `<style>`
and `style=` attributes while drawing; with `style-src 'self'` the diagrams render unstyled). `script-src` stays `'self'`.

### Writing and validating diagrams in documentation

The `mermaid-diagrams` skill (installed with the other skills) tells the agent when a diagram earns its place, which type to use (flowchart, sequence,
ER, state, class, gantt), the syntax traps (quoting labels, the reserved word `end`, node ids) and to keep diagrams small; GitHub renders
```` ```mermaid ```` fences natively.

`amauta mermaid check FILE.md...` validates every fence and exits 1 with `file:line` on a syntax error. Feasibility finding: `mermaid.parse()` runs under
plain Node in a bare `node:vm` context with no DOM, jsdom or browser, once the bundled DOMPurify (which is a bare stub without a DOM) is given
no-op `addHook`/`sanitize` stand-ins on that throwaway context; this covers flowchart, sequence, ER, state, class and gantt. It checks syntax only: layout
and rendering still need a browser (the portal or GitHub). The stand-ins are tied to the pinned Mermaid version; a test parses real diagrams of every type, so an upgrade
that breaks them fails the suite.
