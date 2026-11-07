# 0009 Extras extend pillars through a registry

Status: accepted 2026-11-07. Refines ADR 0001 (which said extras import only the kernel).

## Context

The extras (skill impact, wiki explanations, the theme editor backend, the graphify semantic pass) are additions to the
portal and the code graph. They read portal and graph internals, so "extras import only the kernel" cannot hold
without duplicating those internals. What matters is the other direction: nothing may depend on an extra.

## Decision

- An extra lives in `python/amauta/extras/<name>/` and may import the kernel and pillars.
- No kernel, pillar or integration module imports an extra. They ask the kernel registry
  (`python/amauta/extensions.py`) for named extension points (`call`, `collect`); the registry finds extras by listing
  the directory and importing them dynamically, so deleting an extra's folder removes the feature and nothing else.
- Each extra declares its points in `POINTS = {"point.name": function}` in its `__init__.py`.

## Consequences

`MODULES.json` lets the extra layer import kernel and pillar. The architecture test still forbids any static import of
an extra. Extension points are listed in `docs/modules.md`.
