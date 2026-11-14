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
| Work | `#/project`; one project page with every tab (overview, ODD features, graph, pipelines, sessions, memories); one feature page; `#/pipelines` (there is no pipeline page or run page: the run log opens inline) |
| Knowledge | `#/memory` and its tabs (memories, memory files, quality); one memory page; one memory file page; `#/node`; one node page |
| Activity | `#/usage` with every range and filter; Sessions; one session page (Claude Code and Codex); Tools and skills, every segment; one tool page and one skill page |
| Harness wiki | `#/harness`; `#/component` with every kind; one item page per kind (skill, hook, MCP server, MCP tool, connector, tool, agent, command, plugin, output style); `#/security` |
| Foot | `#/guide` and one guide page; `#/settings` with its three tabs (open a confirm step, then go back; never save) |
| Global | sidebar, breadcrumb, Ctrl+K palette (empty, searching, results, no results), View menu, unknown address, an item that does not exist |
| States | loading, empty (a project with no sessions, a filter with no rows), error (server answer missing), long values (long paths, long titles) |

Not covered by the November 2026 round (T15), so the next critique starts here: the dark theme at 1024 and 375 px
(only 1280 was checked), and the loading and server-error states of every view.

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

15. **Control far from its effect.** A control sits next to things it does not change, or its result renders out of
    view. Put it in the panel it changes, act at once, bring the result into view. Guard: `portal-t15-explorer`.
16. **Wrong empty-state reason.** "No records in this range" when the data is never recorded (tool calls in Codex
    sessions). Say the real reason. Guard: `portal-t15-tool`.
17. **Rows that look alike.** Rows with the same title need a distinguishing detail (date, project, id). Guard:
    `portal-t15-lint`.
18. **Caps inside grouped lists and behind counts.** A cap can hide inside a group ("165 notes", 6 listed), a
    diagram set, or a query limit that undercounts (edges). Count in the query, say "N of M", say "at least N" when
    the total itself is capped. Guards: `portal-t15-lint`, `portal-t15-today`, `portal-t15-project`,
    `portal-t15-nodes`, `test_portal_t15.py`.
19. **Server-built strings that bypass the language layer.** Sentences, search snippets and note headings assembled
    on the server ("3 calls", "and N more", "What it does"). Guards: `portal-t15-w3-copy`, `portal-t15-w3-labels`
    (every enum value the server sends has a label in both languages).
20. **Counts with a different scope or window.** All-time next to 30 days, filtered next to unfiltered: each count
    names its window, and a window ends on the reader's local day. Guard: `portal-t15-tool`.
21. **Fit to width without a legibility floor.** Scaling a diagram to fit can take text to 3 px. Scale stops where
    text reaches 11 px; past that the box scrolls and says so. Guards: `portal-t15-fit`, `portal-t15-overflow`
    (segmented controls wrap; a scroll box is a Tab stop and shows a hint only while it overflows).
22. **Internals in copy.** Command-line flags, tool names, file names and raw ids shown to the reader (`--repo`,
    `mem_save`, `feature.md`, `PostToolUse:36ce7f65`). Guard: `portal-t15-w3-pipelines`, `portal-t15-w3-copy`.
23. **Stale snapshot not dated.** A view built from a snapshot says when it was taken and how old it is. Guard:
    `portal-t15-explorer` (graph age).
24. **Voice.** The Spanish UI is formal "usted" everywhere, including diagram sources and guide pages. Guard: the
    informal-forms scan in `test_portal_t15.py`.
25. **Titles that restate metadata.** A generated title repeating the model, count and date shown below it; use what
    identifies the thing (the first prompt of a session). Guard: `portal-t15-w3b-repeat`.

## Rules for the reviewer

- Observation only on a portal that shows real data: never save, remove, add, run, check or sync.
- Verify a finding before reporting it, with the measured size, the exact string or the two values compared.
- Report coverage honestly: a cell not opened is reported as not opened.
- A reviewer's tab can close and the server can stop mid-review: say which cells were lost; do not fill them from
  the code.
