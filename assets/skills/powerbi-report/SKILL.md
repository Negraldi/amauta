---
name: powerbi-report
description: "Trigger: Power BI work: a PBIP or PBIR report or semantic model, DAX measures, report pages and visuals, a filter or metric defect, a layout redesign, renaming a field, comparing two models, a performance investigation."
license: MIT
metadata:
  author: amauta
  version: "1.0"
---

## Activation Contract

Load this skill for a new report, a change to an existing PBIP/PBIR, a visual redesign, a filter or metric defect or a
performance question. Metric, cohort and join definitions follow the `data` skill; management readers also get the
`executive-editorial` skill. Use only data and assets the project approved.

## Hard Rules

- Work on a copy of the latest saved source; keep the PBIP reviewable. A PBIX is a Desktop output, not the only source.
- Never edit a project while it is open in Power BI Desktop. Opening Desktop, taking screenshots or automating input
  needs the user's explicit permission for that step.
- Publishing and refreshing in the Service are separate actions the user authorizes; never publish to get a preview.
- Row-level data and identifiers stay out of the conversation; the privacy hook asks before a data file is read.
- Static checks prove structure only: they do not execute DAX or M, prove key uniqueness or render visuals. Say which
  real-target behavior was not checked.
- A lint finding is a review prompt, not a defect: context transition inside an iterator can be required.

## Workflow

1. Contract. Audience, decision and the question of each page. For each critical measure: source, cadence, maximum
   age, as-of period, population, grain, unit, numerator, denominator, exclusions, expected range and owner. For each
   table: grain, key, cardinality, null and duplicate policy. Averages, totals, rolling windows and display scales follow
   [statistical contracts](references/statistical-contracts.md). State every visual's sort field and direction and
   write the PBIR `sortDefinition` explicitly.
2. Placement. Cleaning and deduplication in data preparation, relationships in the model, context-sensitive metrics in
   DAX, order, color and navigation in PBIR: [calculation placement](references/calculation-placement.md) and
   [model conventions](references/semantic-model-conventions.md). Justify any many-to-many or bidirectional filter.
3. Page. New pages are 1280 px wide; keep existing dimensions on changes unrelated to layout. One main question and a
   clear reading order per page; pick visuals by question ([visual catalog](references/visual-catalog.md)): a card for
   one number, bars for categories, a line for time, a table or matrix for exact detail. Composition rules:
   [clean report design](references/clean-report-design.md); the headline, evidence and detail of a page, chart choice
   and color by direction: [storytelling and charts](references/storytelling-and-charts.md). HTML cards and Deneb
   visuals only when approved: [HTML and Deneb](references/html-and-deneb.md). Use the `impeccable` skill for a
   critique when installed.
4. Candidate. Inventory pages, visual IDs, fields, filters, bookmarks and interactions before changing an existing
   report. Edit PBIR through the official CLI when installed (check `--help`, never guess syntax) or reviewed JSON; see
   [PBIR authoring notes](references/pbir-authoring-notes.md). Then run the static tools:
   - `{{AMAUTA_PY}} amauta.extras.pbir lint MODEL` (DAX and model rules, warnings)
   - `{{AMAUTA_PY}} amauta.extras.pbir layout REPORT` (outside the page, overlaps, tiny visuals)
   - `{{AMAUTA_PY}} amauta.extras.pbir refs REPORT MODEL` (fields, filters and sorts that point at nothing)
   - `{{AMAUTA_PY}} amauta.extras.pbir diff OLD NEW` (model changes between two candidates)
   - `{{AMAUTA_PY}} amauta.extras.pbir dictionary MODEL` (a Markdown data dictionary)
   - `{{AMAUTA_PY}} amauta.extras.pbir rename REPORT --table T --from OLD --to NEW` (structural rename in the visuals;
     a dry run until `--apply`; rename the field in the model as well)
   - `{{AMAUTA_PY}} amauta.extras.pbir theme --name N --out FILE.json` with `--colors C,...`, `--brand FILE` or
     `--profile` (an organization profile whose brand.md lists data colors); the author imports it in Desktop
5. Desktop and Service. With permission, open the candidate, refresh when the model changed, check representative DAX
   values, filters and every changed visual; save, close and reopen when the delivery is a persisted file.
6. Performance only after a correct baseline: measure, change one thing, measure again on the same data.

## Output Contract

The report contract, the diff of what changed, the static tool results, the values and filter cases checked in the
real target, viewports inspected, exceptions, open questions and the rollback point (the untouched original). For
handover, the documentation follows [report documentation](references/report-documentation.md).
