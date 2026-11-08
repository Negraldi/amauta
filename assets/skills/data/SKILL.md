---
name: data
description: "Trigger: analytical work on tabular or database data: ETL and transformation design, joins and enrichment, metric, cohort and KPI definitions, data-quality diagnosis, reviewing an analysis or a SQL, pandas, Polars or R refactor. Contracts first, synthetic checks, real data kept out of the conversation."
license: MIT
metadata:
  author: amauta
  version: "1.0"
---

## Activation Contract

Load this skill when the work defines, transforms, joins, measures or reviews data. File mechanics (encodings, dtypes,
large files) live in `tabular-data`; this skill is about meaning and evidence.

## Hard Rules

- Real data stays out of the conversation: never paste raw rows, identifiers or keys into chat, logs, commits or review
  packets. Report counts, shapes and aggregates. The privacy hook asks before a data file is read; say why the read is
  needed or work on a copy made with `amauta privacy pseudonymize` or `amauta privacy redact`.
- Check a file before sharing anything from it: `amauta privacy scan FILE` lists identifier columns and secrets without
  printing values.
- Contract before code: grain, keys, join cardinality, null and duplicate policy, date roles and population are written
  down before a transform is chosen. Unknown definitions stay unresolved; never invent them.
- Identifiers are text: keep leading zeros and raw values; padding, trimming or case changes need a documented rule.
- No silent first-row deduplication, no unavailable value read as zero, no unmatched row dropped without a count.
- Build checks on synthetic fixtures written for the case, never on copies of real records or private business rules.
- Existing database objects are read-only unless the user authorizes a write; a design does not authorize a connection.
- The project's confirmed definitions win over imported or guessed ones; the selected profile's glossary and sources
  (`amauta profile show`) come next.

## Workflow

1. Frame: question, decision it serves, audience, deliverable, acceptance criteria with stable IDs, definition owners.
   Use [analytical review](references/analytical-review.md).
2. Define: metrics and cohorts per [metrics and cohorts](references/metrics-and-cohorts.md); transformations per
   [transformation](references/transformation.md); row-preserving lookups per [enrichment](references/enrichment.md).
3. Check on synthetic data: boundary dates, ties, duplicates, nulls versus empty versus unmatched, join fan-out,
   small populations. Diagnose missingness, duplicate keys and outliers with aggregates only.
4. Record where every number comes from per [provenance](references/provenance.md).
5. Reconcile and hand over: row and key counts before and after, totals, unresolved questions, limits.
6. Recurring: make it an amauta pipeline with its own scripts per [pipeline recipes](references/pipeline-recipes.md).

## Output Contract

Return the contract (schema, grain, keys, rules), the checks that ran with their results, the reconciliation, the
provenance record and the open questions. Separate facts with a source from assumptions. A static review supports a
static finding only; say which behavior was not executed.
