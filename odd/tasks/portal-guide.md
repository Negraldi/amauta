# Feature: a guide to amauta in the portal

Locator: `odd/tasks/portal-guide.md` (branch `feat/amauta-next`, after `def054b`). Engram mirror:
`odd/portal-guide/tasks`. Decisions: ADR 0005 (portal page map), user answers of 2026-11-09.

## Objective

A guide inside the portal that explains each part of amauta (the overview, the kernel, install and runtimes, ODD and
review, the portal, data security, code security, the pipelines orchestrator, sibling projects such as oga_catalog,
and the optional modules and extras), each page with the five sections the user asked for, and diagrams:

1. What it is made of (components).
2. How the parts relate.
3. How you use it (the flow of use and work).
4. Scripts and commands.
5. How it works.

## Scope

In: Markdown pages shipped with the portal (`python/amauta/portal/guide/{en,es}/<slug>.md`), a read-only API that
serves only known pages, a Guide tab in the Harness page, tests for structure and diagrams. Out: editing the guide from
the portal; generating it from code.

## Constraints

- User decisions 2026-11-09: English and Spanish (the page follows the portal's language); a Guide tab under Harness
  (the 6+1 sidebar of ADR 0005 stays); diagrams on every page.
- Pages are rendered by the portal's safe Markdown subset (`markdown.js`): Mermaid fences, tables, lists, wikilinks.
- Every Mermaid fence passes the vendored parser (`src/mermaid/check.js`). No private content.

## TDD

Strict, ON for the API and UI. Runner: `python3 -m unittest python.tests.test_portal_guide`,
`node --test test/portal-guide-ui.test.js test/portal-guide-content.test.js`, then `npm test`. The content is checked
by structure tests (same pages in both languages, the five sections, at least one valid diagram per page).

## Tasks

- [x] G1 Guide API and the Guide tab: `/api/guide` (the index, per language) and `/api/guide/page` (one page by known
  slug), `#/guide[/slug]` under Harness, Markdown with diagrams, links between pages.
- [x] G2 Content in English: ten pages, five sections each, diagrams; facts checked against the code and docs.
- [x] G3 Content in Spanish: the same ten pages.
- [x] G4 Docs (docs/portal.md), a look in a real browser, commit and push.

## Acceptance criteria

- Both languages have the same pages; each page has the five sections in order and at least one Mermaid diagram that
  the vendored parser accepts.
- The API never joins a request into a path; an unknown slug is a 404.
- `npm test` green; ratchet and architecture green.

## Progress

- 2026-11-09: plan written from the user's request and answers (languages, location, diagrams).
- 2026-11-09: G1 inline. RED: guide module missing (3 Python tests), Guide tab missing (2 UI tests). `portal/guide.py`
  serves pages only by a slug from SLUGS, English as fallback; `page-guide.js` renders them with the safe Markdown
  subset and up to 12 diagrams; views now receive the route. Placeholder pages until G2 and G3. The content test
  (`test/portal-guide-content.test.js`) is written and fails on the placeholders; it lands with the content.

## Next step

None: closed.
- 2026-11-09: G2 delegated (writer, read the docs, ADRs, MODULES.json and code; commands checked against --help): ten
  English pages, 6,270 to 9,281 characters, two or three diagrams each, `check-guide.mjs en` ok for all. Route:
  delegated, twenty files are more than one session's context should carry. The writer found five places where the
  docs lag the code (portal POST list, `checks engine: planned` in architecture.md, the pipeline summary in cli.js,
  modules.md and extras, and ADR 0006's `--without-checks`); the pages follow the code; G4 fixes the docs.
- 2026-11-09: G3 delegated (translator, same structure, diagrams and links): ten Spanish pages, 6,845 to 10,276
  characters; `check-guide.mjs es` and `en` ok. The content test, held out of the tree while pages were written,
  passes (3/3); npm test 857 Node, 938 Python.
- 2026-11-09: G4: docs fixed in `09daee8` (portal writes, checks in the kernel, extras, pipeline summary); ADR 0006
  still names `--without-checks` (accepted records are not edited; the flag is `--no-checks`, as the guide says).
  Real browser: `#/guide/kernel` in Spanish, two diagrams drawn as SVG, no page errors, no overflow at 390 px.

