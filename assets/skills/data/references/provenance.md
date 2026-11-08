# Provenance

Every number in a deliverable can be traced back to where it came from, without exposing the data itself.

## What to record per source

| Field | Content |
| --- | --- |
| Source | System, schema and table, or file name, as a reference; never credentials or connection strings |
| Fingerprint | File hash (`sha256sum`), row count, or the query text's hash and the database's as-of time |
| Extraction | Date and time, who or what extracted it, filters applied, the query or script version (commit) |
| Freshness | Update cadence, maximum acceptable age, the as-of period the numbers describe |
| Transformations | The contract version and the commits of the code that produced the output |
| Approvals | Who approved each business definition, and when |

## What to record per output

The inputs it used (by fingerprint), the code commit, the checks that ran and their results, and the reconciliation
(rows and totals at each step). A chart or a table names its as-of date and population in its caption.

## Rules

- Hashes and counts identify data without revealing it; use them in commits, issues and review packets instead of rows.
- A copy made for analysis (`amauta privacy pseudonymize`, `amauta privacy redact`) records its source fingerprint and
  the columns changed, never the key, which stays in the amauta state directory.
- A source catalog documents provenance; it neither authorizes a connection nor proves a definition right.
- When provenance is incomplete, say so in the deliverable's limits instead of filling the gap.
