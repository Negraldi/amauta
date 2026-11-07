# 0005 Portal: on demand, 6+1 pages, split by page

Status: accepted 2026-11-07.

## Context

15 routes, `static/app.js` with 1,326 lines and `static/i18n.js` with 1,460.

## Decision

- The portal stays on demand (`amauta portal`, `portal launch` with idle exit); no background service.
- Pages: Home, Projects (ODD tasks, graph, sessions), Memory (lint as a tab), Activity (sessions and usage), Harness
  (catalog and diagram), Settings (theme picker); Security is added in phase 2. Old routes redirect.
- `app.js` is split into one module per page; i18n becomes one JSON file per language.
- On Windows the launcher finds Edge or Chrome and installs a Start menu shortcut.

## Consequences

Navigation changes for existing users (UPGRADING notes); URLs keep working through redirects.
