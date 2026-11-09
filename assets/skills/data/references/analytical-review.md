# Analytical review

Use when framing or reviewing an analysis, a workbook enrichment or an automation proposal. It grants no data access
and does not replace the project's own rules.

## Frame the work

Keep a short brief: scope, purpose, approach, sources, procedure and deliverable. Reuse the request when it already
says these. Give each acceptance criterion a stable ID and trace it to an output, a check and a result (passed, failed,
unverified). Name the owner of every business definition and keep facts with a source apart from assumptions. Ask when
an open assumption would change the outcome.

## Challenge a result before accepting it

| Question | Evidence to keep |
| --- | --- |
| Blind spots: what could be missing? | Boundary cases, unmatched records, nulls, partial periods, small populations, duplicated rows after a join |
| Robustness: does it reconcile? | Independent totals, parts adding to the whole, join cardinalities, row counts in and out, explained differences |
| Assumptions: which could change it? | Definitions, date roles, duplicate resolution, what a status value really means, sensitivity to alternatives |
| Value: does it answer the request? | A trace from each requested decision to an output and its check; the finding a reader should act on |

Ask the plain-sense question too: is this volume or rate plausible for what it measures? A number that is precise and
implausible is a finding.

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

## Close with a review certificate

A short block in the deliverable, in plain words: the assumptions that were checked and how, the risks that were
neutralized (duplicates, partial periods, unmatched keys), what was not verified, and why the result answers the
request. It states what the reviewer saw; it is not an approval of the business definitions.

## Keep an acceptance record

What changed and why, the inputs or their hashes, the checks with their scope, what was not executed, required reviews
and the rollback point. Never paste raw rows or identifiers into the record.
