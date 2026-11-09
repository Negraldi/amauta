# Transformation contract

Keep each handoff small enough to review against its consumer's behavior.

| Field | Required content |
| --- | --- |
| Identity | Project, task and a fingerprint of the candidate (commit, file hash) |
| Sources | Schema references and freshness limits; no credentials, no raw protected data |
| Meaning | Definition owners, event and date roles, population |
| Inputs and outputs | Schema, types, grain, keys, required fields |
| Matching | Join type and cardinality, unmatched policy, nulls, duplicates, total tie-break order |
| Invariants | Rows and cells preserved, allowed changes, reconciliation tolerances |
| Evidence | Synthetic checks, changed behavior, open risks, rollback |

Decide grain, keys, null handling, join cardinality and duplicate resolution before choosing a transform. Check
numerator and denominator populations and join fan-out before proposing an aggregate. Choose facts and dimensions or one
analytical table for the actual consumer; do not move every calculation into the backend without evidence.

Prefer vectorized expressions, projection and filter pushdown and bounded memory. Review casts, date predicates,
encodings, relative paths, connection cleanup and explicit failures as improvements backed by evidence. A refactor must
keep the agreed behavior and show it on the same synthetic cases before and after; lint alone is not semantic validation.

## Focused synthetic cases

- Join fan-out: duplicate lookup keys cannot silently grow a row-preserving output.
- Typing: `0007` stays text; numeric `7` is not the same without a rule.
- Missingness: null, empty and unmatched follow separate declared policies.
- Ties: shuffled input gives the same result, or an explicit ambiguity.
- Dates: boundary and partial-period cases keep the agreed event-time meaning.
- Refactor: old and new agree on the invariants before any performance claim.

A design review does not claim a live database or client acceptance; say what was not executed.
