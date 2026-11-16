# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Portal critique follow-ups: Remove in Settings > Projects and siblings asks first and offers Undo; the Graph node
  list opens most connected first with vendored, minified and dependency files behind a toggle, and node kinds read as
  words; Activity pages say "Data as of <time>" under Refresh and keep the filter bar under the top bar on wide screens;
  the architecture diagram opens at its natural size in a sideways scroller, with a Fit to width toggle.
- Memory refuses text saved without spaces between words: amauta's memory MCP server (`mem_save`, `mem_update`,
  `mem_save_prompt`, `mem_session_summary`, `mem_session_end`) replies with an error asking the agent to resend the body
  as prose, and Memory > Quality lists notes already stored that way. The external engram server is not covered.
- Harness wiki inventories Codex too: MCP servers from `config.toml`, hooks from `hooks.json`, the `AGENTS.md` blocks and
  the Codex skills dir. One entry per component with its runtimes ("Runtime: Claude Code, Codex") in the Catalog and on
  item pages; the Overview has one row per runtime; Security shows the Codex privacy and checks switches.
- Portal redesign. The sidebar is grouped by job (Today, Work, Knowledge, Activity, Harness wiki, then Guide and Settings)
  with a breadcrumb on item pages and tabs kept in the address. Each project is one hub (`#/project/<name>`: overview,
  features, graph, pipelines, sessions, memories); memory has Memory, Memory files and Quality tabs and one cross-repo
  Graph page; Activity holds Usage, Sessions and one Tools and skills table, and the Range, Project and Runtime filters
  live only there; the harness wiki has an overview, one Catalog of every component (`?kind=`) and Security; Settings has
  Preferences, Projects and siblings, and Appearance tabs. Display in the top bar sets theme and language; Ctrl+K also
  jumps to pages. New identity: cochineal-red accent for links, selection and focus, neutral surfaces, monospace titles
  and figures, reworked data colors and dark-aware diagrams. Accessibility: AA contrast checked in tests, 24px targets,
  visible control borders, a phone menu closed by Esc or a tap outside, one date and number format. Old links
  (`#/activity`, `#/mcp`, `#/themes`, `#sessions` and the like) redirect to the new pages. No new endpoints or dependencies.
- PBIR tools: `refs REPORT MODEL` lists the fields, filters and sorts of a report that its model lacks (report only,
  never repaired); `theme --name N (--colors | --brand FILE | --profile) --out FILE.json` writes a report theme from a
  palette, warns on low text contrast and never replaces a file without `--force`.
- `data` skill: a SQL review reference (explain before running, writes only to temporary objects, sargable filters,
  pipeline-ready scripts); challenge questions and a review certificate in analytical review; a query cache recipe;
  stock, flow and cohort reconciliation; a lineage record template.
- `powerbi-report` skill: HTML in DAX and Deneb, storytelling and chart choice with color by direction and two
  header measures, and a report documentation outline.
- Intake record `docs/intake/agent-archive.md`: what was taken from the user's private agent archive, rewritten
  generic, and what stays in the private profile.

### Changed

- Portal names and wording: the home page is Today / Hoy everywhere (nav group, item, title, error action) and the
  harness overview is titled Harness overview; a graph copied into memory is Loaded / Not loaded yet (Cargado / Aún sin
  cargar) instead of Mirrored / Sin reflejar; the Projects lead names the usual origin once; Today's session rows say
  each fact once; the health sentence is plain text with a link on the component count, warning tone only when needed.
- Portal controls: one segmented-control look for links and buttons that scrolls instead of wrapping (DESIGN.md states
  when to use tabs and when a segmented control); checkboxes are 24px targets with an 18px box.
- Portal copy is runtime-agnostic: where a statement holds for Claude Code and Codex it says "the agent" (persona,
  privacy, checks, module help, explanation requests, hook and MCP texts), and Claude Code-only parts say so (output
  style, the data-file ask, the per-edit check, agents, commands, plugins). Spanish catalog lead uses "usted" throughout.
- Portal: usage day keys (the Usage chart and the date range filters) are this machine's local date instead of UTC; a
  single call reads "1 call"; a SKILL.md front-matter value cut at 300 characters ends at a word with an ellipsis.
  Spanish server text and diagram labels are translated on the client (catalog `srv-es.json`).
- `pbir lint` DAX001 no longer flags a division by a nonzero numeric constant.
- `amauta upgrade` prints the UPGRADING.md notes of every version in the jump (read from the target, without the
  single-step commands); `--dry-run` fetches and previews the target's own installer from a temporary worktree (files
  it would write or remove, legacy entries it would replace, choices kept); `--branch <name>` follows a branch on
  origin before it has a release tag. A test installs v0.4.0 from the history and upgrades it to the current version.
  The upgrade passes `--no-telemetry`, `--no-privacy`, `--no-checks` and `--persona` again from the last install
  (install does not keep them by itself). `AMAUTA_INSTALL_ROOT` (internal) tells a previewing installer the real
  install's checkout.

### Fixed

- Portal cross-page agreement (T14): a session's start time, model and project read the same on every page. Today labels
  a row's time "last active" and gives an earlier start in full; a session's model is the one with the most messages
  ("claude-opus-5-5 +1"); one project rule decides membership, the name, last activity, the Usage > Project filter,
  Usage > Projects and search (Codex rollouts now give their cwd too), and a project's Sessions tab drops its Project
  column. Projects lists active folders that are not projects, and every row says how it was found in a Found by column.
  Memory says "Showing 50 of 728." with Show more, and a capped search group says "first 50 of 728" or "50+". The session
  page is in the UI language with grouped counts, a short-id crumb, and opens from the short id the tables show. Each
  skill count says what it counts; references name sidebar sections; daily and session tables open newest first; the
  architecture diagram is shown and centred; orphan memories say why once; the graph list counts shown and hidden nodes;
  Settings lists On before Off; phone tabs wrap; a page title and its lead sit one spacing step apart.
- Portal re-critique round (T13): Today's spending reads the same overview as Usage (it summed by UTC day and drifted
  from Usage near midnight); one rule names a session's project on every page (configured project owning the cwd, else
  the repository root, worktrees as their main repository and never a dotfiles repository in $HOME, else the folder),
  and the Today feed says "started <date>" instead of repeating the day; every graph kind is a short word (Concept
  included); the graph's vendored toggle also hides `.gitattributes` linguist-vendored paths and folders the
  repository's NOTICE names; the Remove confirm opens in its row and focus returns to it; the Projects lead names an
  origin only when most rows share it; the Catalog kind filter wraps instead of scrolling; the Usage filters fold under
  one summary line on a phone; Spanish writes "2,4 mil M", never "B"; one breadcrumb rule (no tab crumb, items by
  title); Security tables open A to Z; the siblings intro is said once; the search palette says "Searching." while a
  request is pending.
- Portal Settings on Windows: a timed-out install called `os.killpg` (POSIX only) and the installer's environment
  dropped `USERPROFILE`, `SYSTEMROOT` and the other variables node and npm need there.
- Portal Settings reached only Claude Code: an explicit Claude home made the installer look for Codex inside it. Preview,
  apply and undo now pass the Codex home and skills dir whenever a Codex home exists (kept inside a sandboxed Claude home),
  list the Codex changes and backup, and undo re-runs the previous values for both runtimes.
- Codex home discovery agrees between the installer and the portal: `AMAUTA_CODEX_HOME`, then `<claude home>/.codex`
  for a custom Claude home, then `CODEX_HOME`, then `~/.codex` (`%USERPROFILE%\.codex` on Windows). The portal and
  `amauta.usage` ignored `CODEX_HOME`, and an empty `CODEX_HOME` made the installer use the current directory (Codex
  itself treats it as unset).
- Windows: with no `--python` or `AMAUTA_PYTHON`, hooks and the memory server use `python` instead of `python3`, which a
  python.org install does not provide.

## [0.7.0] - 2026-11-09

### Added

- Pipelines (extra, ADR 0010): `.amauta/pipelines.json`, `amauta pipeline list|check|run|status|cancel|schedule-hint`,
  a Pipelines tab with filters, a flow row, history, a live console, notices and a summary on the home page; retries,
  outputs a step must change, declared schedules with a missed-run check, recipes in the `data` skill.
- Sibling projects: `portal.json` `siblings` and a health card on the Projects page (last commit, uncommitted
  changes, MCP server registered for Claude and Codex, age of a watched file); edited in Settings.
- Pipelines as a DAG (ADR 0011): step `id` and `needs` with parallel steps (`max_parallel`), `blocks` with `use`,
  sub-pipeline steps, `modes` with `--mode` and a mode picker, several schedules each with its mode.

### Fixed (independent review of the pipelines extra)

- One run of a pipeline at a time, through an atomic lock shared by the portal, the CLI and scheduled runs; a run
  whose runner stopped reads as abandoned; SIGTERM and Ctrl+C still end a run.
- Output with U+2028 or NEL no longer freezes a run; the portal reads events by byte offset.
- A background child no longer holds a step past its end or timeout (POSIX); scripts resolve from the project root
  and may not leave it through a symlink; steps get the user's PYTHONPATH; outputs must change; private key blocks are
  redacted; valid hourly and daily schtasks entries; PATH in cron and launchd hints; daylight saving in the
  missed-run check; a run that cannot start says why.

- Second independent review: a failure blocks its whole chain again (as in 0.6); an error inside a step fails that
  step only; a stale lock has exactly one new taker and adopting it is atomic; stricter definitions (NUL, types, an
  off pipeline step), a UTF-8 BOM accepted; run summaries keep step order and ids; a schedule without mode follows the
  default mode; following an abandoned or never-started run ends; the runner refuses a pipelines.json changed after
  the portal's trust check; `--step 0` refused; `%` escaped in cron lines.

- Third independent review and follow-ups (ADR 0012): Windows job objects for a step's processes; the lock records its
  process's start time and treats zombies as dead; a detached child holding a step's output is given up on; no
  0.1 s floor per step; run names reserved on disk; retention removes logs; replay by step id; a card refreshes its
  history when the live run it follows ends.

### Changed

- `amauta check trust` records the hash of `.amauta/pipelines.json`; the portal runs pipelines only while that file
  is unchanged. Trust each project again once after upgrading.

## [0.6.0] - 2026-11-08

### Added

- Data security: a detector catalog (Ecuadorian cedula and RUC, cards, IBAN, e-mail, phones, secrets); the memory
  guard (secrets refused, identifiers redacted, always on); the privacy hook (asks before a data file is read, warns
  about a secret in a prompt, never denies); `amauta privacy scan|redact|pseudonymize`.
- Code security: the checks engine; after an edit and at Stop, syntax and secret checks on changed files report only
  new errors as `file:line:col: error: message [checker]`; `amauta check trust` allows tsc, eslint, mypy and cargo in
  one project; gitleaks, bandit and semgrep run when installed; an ODD task cannot be checked off while checks fail.
- Skills: `data` (five references), `powerbi-report` with PBIR tools (`amauta py amauta.extras.pbir lint|diff|dictionary|layout|rename`),
  `executive-editorial`, `institutional-presentation`.
- Agents: `chasqui` (communicator), `taripaq` (analytical lens), `haravec` (communication lens); `amauta review pack`
  and `amauta review numbers`.
- Profiles: `amauta profile list|new|use|show|check|import|harvest|accept`, a neutral default shipped, organization
  profiles kept in the state directory.
- Portal: a Security page; privacy and checks switches in Settings; each project's profile.

### Changed

- `install` registers the privacy hook and the checks (`--no-privacy`, `--no-checks` turn them off).
- The orchestrator block runs the lenses for analysis and deliverables even when code review is off.

## [0.5.0] - 2026-11-08

### Added

- Native Windows: the Python interpreter is chosen at install (`--python`, `AMAUTA_PYTHON`) and recorded; skill links
  are junctions, with a managed copy when a link cannot be made; process trees are stopped with `taskkill /T`; CRLF files
  keep their line endings; the portal guard knows the Windows system folders. `amauta portal launch` opens Edge or Chrome
  and `install-launcher` writes a Start menu shortcut. CI runs a portable test subset on Windows and the full suite on
  Linux and macOS.
- `MODULES.json` and an architecture test (every file in one module, layer import rules), a simplicity ratchet (file,
  function and line limits that may only tighten) and ADRs 0001-0009 in `docs/decisions/`.
- `python/amauta/extras/`: optional extras found by an extension registry (skill impact, wiki explanations, the theme
  editor backend, the graphify semantic pass); `amauta py <amauta.module>` runs them with the recorded interpreter.
- Portal: six sidebar pages (Home, Projects, Memory, Activity, Harness, Settings) with tabs for their list routes; the
  Harness page draws how a session flows through the harness (Mermaid); Activity opens with one summary sentence.

### Changed

- Hooks: one command per event (`hook event <Event> --with handler,...`) runs the handlers in order; one Stop policy
  combines blocks (at most two per turn); the SDD preflight runs in Node and fails closed for `sdd-*` only.
- The installer plans both runtimes through one adapter interface.
- Portal: the top bar holds only search; filters sit above the pages that use them; theme and language are at the foot
  of the sidebar; dictionaries are JSON files per language; plurals, plain words and empty-table messages.
- README shortened to an overview; details moved to `docs/`.

### Fixed

- macOS: a bare `python3` (Xcode's 3.9, no `-P`) in the graphify hook, the semantic pass and `amauta portal`; a reverse
  DNS lookup that stalled the portal's start; `/etc` (resolved to `/private/etc`) accepted as a project path.
- The Harness page listed amauta's hooks as "other".

## [0.4.0] - 2026-10-23

### Added

- Codex runtime target: `amauta install|uninstall|status --runtime claude|codex|both` (default `both` once `~/.codex` exists). The Codex side gets the same instruction blocks in `~/.codex/AGENTS.md`, hooks in `~/.codex/hooks.json`, MCP servers in `~/.codex/config.toml` and skills in `~/.agents/skills`, with the same backups and `amauta restore`.
- One shared skill store (`<state dir>/skills`) that both skills directories link to; personal skills made in either runtime get a symlink in the other.
- Two-way MCP sync between `~/.claude.json` and `~/.codex/config.toml` (3-way merge against the last synced set); conflicts are reported in `amauta status` and never overwritten.
- `amauta sync` and a silent `SessionStart` drift check (`hook sync-check`); `amauta status` reports drift and a parity section for both runtimes (`--json` adds `codex` and `parity` keys).
- Codex usage ingestion: rollouts under `<codex home>/sessions` land in the usage tables with a `runtime` column; `python3 -P -m amauta.usage backfill --runtime codex|all`. Portal: runtime filter and badge, and a per-runtime split in sessions, usage and home spending. Codex models have no prices, so Codex shows tokens only.
- Hooks and the memory server receive `AMAUTA_RUNTIME=claude|codex` so telemetry says where an event came from. Memory itself is not split: both runtimes read and write the same `memory.db`.
- Graphify hooks: `amauta graphify hook install` also manages `post-merge`, `post-rewrite` and `post-checkout` (branch switches only) and removes graphify's own competing blocks; a `SessionStart` hook (`graphify-connect`) connects a repo that already has a graph; the portal can sync or connect any project's graph from its page.
- Repository instructions live in `AGENTS.md`; `CLAUDE.md` imports it.

### Changed

- The project is described as a harness for Claude Code and Codex (README, package metadata, `NOTICE`, product doc, `--help`).
- Bundled instruction assets moved from `assets/claude/` to `assets/core/`. Installed files and the state directory are unchanged.
- Portal auto-discovery skips linked git worktrees of a project it already knows.

### Fixed

- Codex `SubagentStop` and the other Codex-only events are mapped in parity instead of being reported as Claude-only.
- A Codex-only install with the impeccable skill prepares its shared engine.
- Test suites remove the temporary directories they create (graphify sandboxes, impeccable homes).

## [0.3.1] - 2026-10-17

### Added

- Project paths in `<state>/portal.json` and in Settings may live outside `$HOME` (for example `/mnt/datos/...`). They must be absolute, existing and resolved; `/`, `$HOME` itself and system trees (`/proc`, `/sys`, `/dev`, `/run`, `/etc`, `/usr`, `/bin`, `/sbin`, `/lib*`, `/boot`, `/var`, `/tmp`, `/snap`, `/root`) are refused. Auto-discovery still looks only inside `$HOME`.
- Components of plugins disabled in `enabledPlugins` (hooks, MCP servers and tools, agents, commands, skills, output styles) are labelled "Plugin disabled: does not run" in pages and catalogs.

### Fixed

- "Refresh descriptions" failed with "response too large" for MCP servers with large tool lists (rea, 170 tools). Limits are now 16 MB per line, 32 MB per response and 500 tools; the cache still keeps only names, capped descriptions and parameter names.
- `npm test` failed once `~/.amauta/portal.json` listed projects: two portal spawn tests read the real state directory. They no longer do.
- The test suite left its temporary directories in `/tmp` (about 2,000 directories and 630 MB over three days); they are now removed when each test process exits.

## [0.3.0] - 2026-10-17

### Added

- Skills wiki: `#/skill` lists every skill (installed, plugin, project `.claude/skills` of known projects, and built into Claude Code), grouped by source and filterable. Each skill page opens with "What it does" and "When it triggers", then the full `SKILL.md`; built-in skills say plainly that Claude Code ships them with no local file.
- Memory rows (own store, Engram read-only, file memories) open their wiki page directly.
- Projects: discovery from `--repo`, from the `repos` listed in `<state>/portal.json` (`{"repos": [...], "auto_discover": true}`) and, while `auto_discover` is on, from the git roots of your session working directories (existing directories under `$HOME` only). `#/project` lists them and each project page shows its ODD features with progress, sessions, memories and graph status, with a how-to when graph memory is empty. Settings gained a Projects section that adds and removes project paths through a guarded write to `portal.json`. `amauta portal launch` now forwards the configured repos.
- Themes: a top-bar picker (System, Light, Dark and your own themes), custom theme files in `<state>/themes/*.json` (name, base, validated color tokens only) and an in-portal editor at `#/themes` with live preview, WCAG contrast warnings in words, save, delete, import and export. The theme files API (`GET /api/themes`, guarded `POST /api/themes` and `/api/themes/delete`) is confined to the themes directory.
- English and Spanish UI: a top-bar language switch for the portal chrome (navigation, headings, labels, buttons, empty states, errors, settings descriptions). The default follows the browser language and the choice is remembered. Memories, `SKILL.md` and ODD documents stay as written; dates are always `YYYY-MM-DD`.
- Harness wiki (`#/component` and one page per component): hooks, MCP servers, MCP tools, connectors seen in sessions, Claude Code built-in tools (curated English and Spanish catalog), agents, commands, plugins and output styles. Each page says what it does and when it runs and names the source of each fact; MCP configs show env and header names only, never values.
- Refresh descriptions (`POST /api/harness/refresh`): asks configured local stdio MCP servers for `tools/list` (read-only, 10 s timeout per server, no remote connectors) and caches the result under the state directory.
- Explanation requests (`POST /api/harness/explain`) queue a request in `<state>/wiki/requests.jsonl`; the new `amauta-wiki-explain` skill processes the queue in a Claude Code session and writes notes with the hash of their source. The portal never calls a model. The lint gained a "Stale explanations" check (seven checks in total).

### Changed

- Numbers are grouped in the language of the UI and dates and date-times are always `YYYY-MM-DD` and `YYYY-MM-DD HH:MM` everywhere (tables, rails, charts, lists), never raw ISO strings.
- The architecture diagram stays on the Harness page and ODD progress lives on project and feature pages.
- Hook pages are titled `<Event> (matcher) · <name>` (curated amauta name, else the script file name, else the first command word) instead of a raw command prefix; the full masked command stays on the page.
- Theme import is one "Import theme file" button that opens a visually hidden file input.

### Fixed

- Skill page rail: values no longer wrap one character per line; numbers and dates are formatted.
- Dates never break inside the token (sidebar "Recent changes", table cells and rails keep `YYYY-MM-DD` and the time together).
- Four-digit numbers are grouped in Spanish (`1.766`); the browser's Intl skips the separator for those by default.
- File paths in the rail break only after a slash, never in the middle of a word.
- Built-in skills no longer show "Installed: no" with no description.
- The launcher-started portal knows your projects, so ODD tasks and graph memory are no longer empty.
- Settings > Projects no longer shows the text "null" after a reload.

### Removed

- The separate Diagrams page and `GET /api/diagrams`: it duplicated other pages. `#/diagrams` redirects to `#/harness`.

## [0.2.0] - 2026-10-16

### Added

- Wiki portal: hash-routed pages for memories, skills, tools, MCP servers, sessions, ODD features and graph nodes, with links and backlinks, a recent-changes rail, a home page with spending and harness health, a safe Markdown renderer (wikilinks, Mermaid fences, no raw HTML) and the Source Serif 4 reading font (OFL-1.1, vendored).
- Global search (Ctrl+K) across memories, skills, sessions, tasks and graph nodes.
- Lint page: orphan notes, possible duplicates, possibly superseded notes, unused skills, ODD tasks checked without a commit, and links to missing pages. All findings are review candidates, never verdicts.
- Skill impact: per-skill change log (installed `SKILL.md` hashes and git commits) and a comparative effect on tool outcomes, with small-sample suppression and an explicit correlation caveat. Usage ingestion records outcome classes (ok, error, denied, exit class, test-command flag) without storing any content (telemetry schema v7, additive).
- Desktop launcher: `amauta portal --app`, `amauta portal install-launcher`, heartbeat and idle exit so the server stops after the app window closes, web app manifest and icon.
- Settings editor: change persona, review mode and optional modules from the portal through a closed option list, with a dry-run preview, a one-time apply token, double confirmation, a backup and a preview-then-confirm undo. Write guard: per-session CSRF token, Origin/Host checks, size and content-type limits.
- Settings editor security review follow-up: undo re-runs the installer with the logged previous values instead of restoring snapshots, the installer runs in its own process group and is killed on timeout, previews are capped, and `managed_files` keys and backup manifest entries outside the install scope are rejected.
- Optional archify skill (`install --with-archify`, vendored unmodified apart from a disabled update check; see `NOTICE`) and a Harness page architecture diagram drawn by it in a sandboxed iframe under its own CSP, with a Mermaid fallback.
- Optional impeccable design skill checks used for the portal design pass (WCAG contrast test, keyboard access, skip link, detector with no findings).
- New CLI flags: `install --without-<module>`, `install --review-mode on|off`, `install --json`, `restore --backup <id>`.
- `amauta upgrade [--to <tag>] [--dry-run] [--yes]`: moves a local install to the latest release tag (or another tag) and reinstalls. See `UPGRADING.md`.

### Changed

- Portal layout: sidebar, reading column and right rail, light and dark themes, filters only where they apply.
- The portal CSP gained `font-src 'self'` and `frame-src 'self'` only; scripts stay `'self'`.

## [0.1.0] - 2026-10-16

### Added

- Initial public release: a small Claude Code harness in plain Node.js and stdlib Python. Idempotent `install`, `status` and `uninstall` with backups, marker-delimited CLAUDE.md blocks, JSON merge into `settings.json` and `~/.claude.json`, output styles, skills, agents and permission rules.
- Hooks (fail open): skill registry, review Stop reminder, telemetry, usage ingestion.
- Memory MCP server with SQLite storage, local telemetry and usage ingestion, `review assess`, graph tools (codegraph, graphify) and the optional SDD module.
- Local control portal with read-only views of memory, skills, usage and the harness.
