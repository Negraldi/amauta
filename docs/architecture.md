# Architecture

amauta is a small kernel that Claude Code and Codex reach through one contract (hooks, MCP servers, skills, the
always-on instruction blocks), with four pillars built on it. Decisions: [ADR 0001](decisions/0001-kernel-and-layers.md).

```
Claude Code · Codex
   │  hooks · MCP stdio (engram, amauta) · skills · CLAUDE.md / AGENTS.md
   ▼
entry       cli · hooks dispatcher · MCP server
kernel      core · install · skills · memory · telemetry · graph-store · detectors · checks
pillars     portal · odd · code-security · data-security
integration code-graph (codegraph, graphify on PATH)
optional    sdd · archify · impeccable · context7 · rea   (--with-X)
extras      python/amauta/extras/ (skill impact; reached through amauta.extensions)
tooling     scripts/ (migration, runtime probe)
```

## Layers and import rules

| Layer | May import | Notes |
| --- | --- | --- |
| entry | entry, kernel, pillar, integration, optional | routers only; no business logic of their own |
| kernel | kernel | always installed; must stay small |
| pillar | kernel | pillars never import each other |
| integration | kernel | glue to external tools found on PATH, never vendored |
| optional | kernel | installed with `--with-X`, removed by uninstall |
| extra | kernel, pillar | nothing imports an extra statically; reached through `amauta.extensions` (ADR 0009) |
| tooling | anything | not part of an installed runtime path |

`MODULES.json` assigns every file under `bin/`, `src/`, `python/amauta/`, `assets/` and `scripts/` to exactly one
module (longest matching path prefix). `test/architecture.test.js` fails when a file has no module, when an import
crosses layers against the table above, or when a recorded exception is no longer needed. Exceptions carry a reason
and may only shrink.

Calls across languages (Node starting `python3 -P -m amauta.<module>`) are process boundaries, not imports; they follow
the same direction rules by convention.

## Where things live

Module by module: [modules.md](modules.md). Task files and their format: `odd/tasks/` and [odd.md](odd.md).
Decisions: [decisions/](decisions/README.md). Outside code taken into amauta: [intake/](intake/README.md).
