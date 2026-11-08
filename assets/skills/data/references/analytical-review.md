# Analytical review

Use when framing or reviewing an analysis, a workbook enrichment or an automation proposal. It grants no data access
and does not replace the project's own rules.

## Frame the work

Keep a short brief: scope, purpose, approach, sources, procedure and deliverable. Reuse the request when it already
says these. Give each acceptance criterion a stable ID and trace it to an output, a check and a result (passed, failed,
unverified). Name the owner of every business definition and keep facts with a source apart from assumptions. Ask when
an open assumption would change the outcome.

## Four questions before accepting a result

| Question | Evidence to keep |
| --- | --- |
| What could be missing? | Boundary cases, unmatched records, nulls, partial periods, small populations |
| Does it reconcile? | Independent totals, join cardinalities, population counts, explained differences |
| Which assumptions could change it? | Definitions, date roles, duplicate resolution, sensitivity to alternatives |
| Does it answer the request? | A trace from each requested decision to an output and its check |

## Make the deliverable understandable

Add a short methodology section: objective, definitions, sources, as-of date, transformations, exclusions,
reconciliation, limits and an index of outputs. Separate the numeric logic of a metric from its presentation; explain
blank versus zero, partial periods and totals, and show the base population when its size matters. A linter finding is
a prompt to review, not proof of an error.

## Assess an automation before adopting it

An automation runs with the user's permissions. List every effect: database writes, file replacement, workbook
refresh and save, scripts, notebooks that keep outputs, schedules and messages sent. Ask for typed configuration,
bounded paths, an explicit list of operations, time limits, cancellation and honest failure states. Keep schedules and
sending off until the user authorizes them, for the exact recipients and content. A keyword denylist is not a
read-only boundary; database permissions are.

## Keep an acceptance record

What changed and why, the inputs or their hashes, the checks with their scope, what was not executed, required reviews
and the rollback point. Never paste raw rows or identifiers into the record.
