# 0001 Kernel, four pillars, optional modules, extras, sibling projects

Status: accepted 2026-11-07.

## Context

amauta grew from 0.1 to 0.4 in one week; the portal is about 54 % of the code and several features (skill impact,
theme editor, wiki explanations, the graphify semantic pass) live inside the core. The user wants amauta to stay small
while covering four needs: portal, ODD, data security and code security.

## Decision

- Layers: **kernel** (dispatcher, install and sync, memory, checks engine, telemetry and usage, platform layer),
  **pillars** built only on the kernel (portal, ODD, data security, code security), **optional modules** installed with
  `--with-X` (sdd, archify, impeccable, context7, rea), **`extras/`** (code the kernel never imports: skill impact,
  theme editor, wikiexplain, graphify semantic with PPTX), and **sibling projects** outside the repository
  (oga_catalog, harness-pipelines) that amauta only links and health-checks.
- Import rules, enforced by an architecture test over `MODULES.json`: the kernel imports no pillar, optional module or
  extra; pillars and extras import only the kernel; pillars do not import each other.

## Rejected

- Making portal features "optional" with runtime switches: adds `if enabled` branches instead of removing code.
- Deleting the extras: loses working features (PPTX conversion lives in the semantic pass).
- Pulling sibling projects in as modules: they need Polars, pandas, NumPy, model2vec, npm packages and Node 26.

## Consequences

Every file belongs to exactly one module; a new file without a module fails the test. Extras keep working but cannot
be depended on.
