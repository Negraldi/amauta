# Modules

One row per module of `MODULES.json`. A module is a set of paths with one purpose and one layer; see
[architecture.md](architecture.md) for the import rules.

| Module | Layer | Paths | Purpose |
| --- | --- | --- | --- |
| `cli` | entry | `bin/`, `src/cli.js` | Command router |
| `hooks` | entry | `src/hooks/` | Hook entrypoints; fail open, return at most one decision |
| `mcp-server` | entry | `src/mcp/` | The `amauta` MCP server: skill registry, review assess, ODD status |
| `core` | kernel | `src/core/`, `src/util/`, `src/version.js`, `python/amauta/__init__.py`, `python/amauta/paths.py`, `python/amauta/oscompat.py` | Marker injector, JSON and TOML merge, atomic writes, backups, git helpers, paths, platform layer (`src/core/platform.js`, `oscompat.py`) |
| `install` | kernel | `src/install/`, `assets/manifest.json`, `assets/core/`, `assets/generic/` | Install, uninstall, status and sync for both runtimes; always-on instruction blocks |
| `skills` | kernel | `src/registry/`, `assets/skills/` | Skill registry and the shared stack and workflow skills |
| `memory` | kernel | `python/amauta/memory/`, `assets/engram/` | Engram-compatible SQLite memory and its MCP server |
| `telemetry` | kernel | `python/amauta/telemetry/`, `python/amauta/usage/` | Local events and transcript usage ingestion |
| `graph-store` | kernel | `python/amauta/graph/` | Code graph mirror in `memory.db`, queries and the refresh lock |
| `detectors` | kernel | `python/amauta/detectors/` | Detector catalog: cedula, RUC, card, IBAN, email and phone validators, secret patterns, one text scan whose findings never carry values (ADR 0007) |
| `portal` | pillar | `src/portal/`, `python/amauta/portal/`, `assets/skills/amauta-wiki-explain/` | Local wiki portal |
| `odd` | pillar | `src/review/`, `assets/core/agents/review-*` | Review assess, review mode, the Stop reminder and the review lenses |
| `data-security` | pillar | `python/amauta/privacy/` | Privacy hook (asks before a data file is read, warns about secrets in prompts; never denies) and `amauta privacy scan\|redact\|pseudonymize` (ADR 0007) |
| `code-security` | pillar | `src/mermaid/` | Checkers; today the Mermaid syntax check |
| `code-graph` | integration | `src/codegraph/`, `src/graphify/`, `assets/skills/graphify-semantic/`, `assets/core/agents/graphify-extractor.md` | codegraph and graphify glue |
| `sdd` | optional | `python/amauta/sdd/`, `assets/sdd/` | Spec-driven development (`--with-sdd`) |
| `archify` | optional | `assets/skills/archify/` | Diagram skill (`--with-archify`, vendored) |
| `impeccable` | optional | `assets/skills/impeccable/` | Design skill (`--with-impeccable`, vendored) |
| `extras` | extra | `python/amauta/extras/` | Optional extras reached only through `amauta.extensions` (ADR 0009): skill impact, wiki explanations, theme editor, graphify semantic pass with PPTX sidecars |
| `scripts` | tooling | `scripts/` | gentle-ai migration and the runtime probe |

## Extension points

| Point | Called by | Provided by |
| --- | --- | --- |
| `home.impact` | `portal/wikihome.py` (Home rail) | `extras/skill_impact` |
| `skill.impact` | `portal/wikiusage.py` (skill page) | `extras/skill_impact` |
| `harness.explain` | `portal/wikiharness.py` (component page) | `extras/wiki_explain` |
| `harness.pending` | `portal/wikiharness.py` (catalog) | `extras/wiki_explain` |
| `lint.categories` | `portal/wikilint.py` | `extras/wiki_explain` (stale notes) |
| `portal.explain_request` | `portal/server.py` (`POST /api/harness/explain`) | `extras/wiki_explain` |
| `themes.list` | `portal/api.py` (`GET /api/themes`) | `extras/theme_editor` |
| `themes.write`, `themes.delete` | `portal/server.py` (`POST /api/themes`, `/api/themes/delete`) | `extras/theme_editor` |

## Recorded exceptions

| From | To | Why |
| --- | --- | --- |
| `install` | `code-graph` | `status` reports the codegraph and graphify versions and the last graphify hook error |
