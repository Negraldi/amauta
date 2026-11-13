# Portal critique checklist

What every design critique of the portal must cover, and what earlier critiques taught. A reviewer gets this file,
fills the coverage matrix cell by cell, and adds a line to "Learned classes" for every new class of problem found.
The goal is no broken view and no contradiction, not a score: scores from independent reviewers varied (25, 30, 28,
26 out of 40 in November 2026) because each one sampled different views.

## Coverage matrix

A critique is complete only when every row was opened at 1280, 1024 and 375 px, in the light and the dark theme, and
the report says which cells were seen. Detail pages count as views of their own.

| Area | Views |
|---|---|
| Today | `#/` (rail and feed, a day with many rows) |
| Work | `#/project`; one project page with every tab (overview, ODD features, graph, pipelines, sessions, memories); one feature page; `#/pipelines`; one pipeline page and one run page |
| Knowledge | `#/memory` and its tabs (memories, memory files, quality); one memory page; one memory file page; `#/node`; one node page |
| Activity | `#/usage` with every range and filter; Sessions; one session page (Claude Code and Codex); Tools and skills, every segment; one tool page and one skill page |
| Harness wiki | `#/harness`; `#/component` with every kind; one item page per kind (skill, hook, MCP server, MCP tool, connector, tool, agent, command, plugin, output style); `#/security` |
| Foot | `#/guide` and one guide page; `#/settings` with its three tabs (open a confirm step, then go back; never save) |
| Global | sidebar, breadcrumb, Ctrl+K palette (empty, searching, results, no results), View menu, unknown address, an item that does not exist |
| States | loading, empty (a project with no sessions, a filter with no rows), error (server answer missing), long values (long paths, long titles) |

## Learned classes

Each class names what to look for and the automated test that now guards it, when there is one.

1. **One fact, one value.** A figure, name, time or model shown on two pages must match: compare Today with Usage, a
   table row with its detail page, a project list with the project page. Guards: `test_portal_wiki_home.py` (Today
   figures come from the overview), `test_portal_t14.py` (session project, model, last activity).
2. **Silent caps.** A list that stops at a limit must say "N of M" and offer the rest. Guard: `portal-t14-memory`.
3. **Detail pages lag behind lists.** Item pages keep raw ids, untranslated labels and unformatted numbers after the
   lists were fixed. Open one of every kind in both languages.
4. **Raw values.** Enum values, class names and internal ids shown as words (`concept`, `code`, `process`). Every
   value a server sends needs a label in both languages or a deliberate fallback.
5. **Fits but cannot be read.** Anything scaled to fit must stay legible: measure the rendered text size (at least
   11 px), not only the absence of a scrollbar.
6. **Hidden overflow.** Controls scrolled out of view behind a thin scrollbar at 1024 or 375 px. Count the visible
   options against the total.
7. **Destructive actions.** Confirm next to the thing it removes, say what is lost, focus on the safe choice, focus
   back to the opener, undo when cheap. Guard: `portal-remove-confirm`.
8. **One name per thing.** Nav item, breadcrumb, title, browser tab and references in copy ("see Usage > Sessions")
   use the same words. Guards: `portal-one-name`, `portal-t14-section-names`.
9. **One vocabulary per control.** Tabs are views kept in the URL; segmented controls filter one list. Guard:
   `portal-tab-vocabulary`.
10. **Numbers in the reader's language.** Units that mislead after translation ("B" in Spanish), missing thousands
    separators, dates repeated under a heading that already says them. Guard: `portal-t13-numbers`.
11. **Default order.** A table opens on the order a reader expects: newest first for dates, A to Z for names, largest
    first for counts; never on noise (vendored or minified code).
12. **Counts that look alike.** Two numbers with the same label that count different things need different labels.
    Guard: `portal-t14-skill-counts`.
13. **CSS that the code promises but the browser does not apply.** A rule can be present and still lose (a
    `max-width` capping a `flex-basis`). Check computed layout in the browser; reading the stylesheet is not proof.
14. **Repeated explanation.** The same sentence on every row or twice on a page: say it once.

## Rules for the reviewer

- Observation only on a portal that shows real data: never save, remove, add, run, check or sync.
- Verify a finding before reporting it, with the measured size, the exact string or the two values compared.
- Report coverage honestly: a cell not opened is reported as not opened.
