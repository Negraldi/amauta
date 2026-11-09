# SQL and script review

Use before running a query or a script against a database, and when asked to review, speed up or ready one for a
pipeline. It grants no access: database permissions decide what a connection may do, not this text. The examples are
T-SQL (SQL Server 2016 or later); the ideas hold in any dialect, with its own syntax for temporary tables.

## Before it runs

Say what the query does, how (sources, joins, filters, the grain of the result) and its impact (rows and tables read,
expected time, locks, anything written). Run it only after that is clear to the user. A read-only login is the real
boundary; a keyword denylist is not one (it misses `MERGE`, `EXEC` and procedures, and blocks a column named
`dropped_at`).

Write only what the user owns and authorized: temporary tables (`#name`) and scratch objects created for the task. A
statement that changes a shared object (`UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, `ALTER`, `MERGE`) needs the user's
explicit permission for that object, every time.

## Correct first

- Aggregate to the grain before a join: join a fact to an event table only after grouping the events to the same key
  and period, or the totals multiply. State the grain of every intermediate result.
- Count rows and distinct keys before and after each join; an unexpected change is a finding, not noise.
- Normalize keys once, in one place (type, padding, trimming), with the rule written down.
- Separate closed periods from the current, partial one; never compare a full month with a few days.
- A read-uncommitted hint can return a row twice or not at all while the table changes. Use it only for a rough look,
  never for numbers that are delivered.

## Then fast

- Keep predicates sargable: compare a column as it is stored. `WHERE d >= '20260101' AND d < '20270101'` uses an
  index; `WHERE YEAR(d) = 2026` does not (`yyyymmdd` literals read the same under any date format setting). Cast a
  key once when building a temporary table, not inside a join.
- Materialize a heavy subquery that is used twice in a temporary table with only the columns needed, and index its
  join keys.
- To filter by a list of keys from a file, load the distinct keys into a temporary table and join it; do not build a
  huge `IN (...)` list or pull the whole table into memory to filter there.
- Read the execution plan before guessing: scans of large tables, implicit conversions, row estimates far from actual.

## Ready for a pipeline

- Start a script with `SET NOCOUNT ON` (row-count messages confuse some drivers) and drop each temporary table with
  `DROP TABLE IF EXISTS #name` at the start and the end, so a rerun in the same session works.
- Save `.sql` files as UTF-8. Some editors save UTF-16, which git shows as binary and Python reads as noise.
- No absolute paths: resolve from the script's folder or the project root. No credentials in code or notebooks:
  integrated authentication, an environment variable or a config file outside the repository.
- Close connections in `finally`; print stages, counts and timings, never rows; exit non-zero on failure.

## Python, Polars and DuckDB

- Express row logic as column expressions (`when/then/otherwise`, window functions over a key) instead of loops over
  rows or per-row Python functions.
- Prefer lazy frames (`scan_parquet`, `.lazy()`) and one `collect()` at the end, so filters and column selection reach
  the reader.
- Query once and keep the result (see the query cache in [pipeline recipes](pipeline-recipes.md)); later steps read the
  file, not the database.
- Typed functions with one job each, constants at the top, no dead code or commented-out blocks.

## Delivering a review

1. Diagnosis: what is wrong or slow, and what would break unattended, each with its line or step.
2. Changes: what was changed and why, in plain words, and a statement that the business logic is unchanged (or what
   changed, with the user's agreement).
3. Evidence: row counts, distinct keys and totals before and after on the same input, and timings.
4. The revised code.
