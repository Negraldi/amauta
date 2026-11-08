# Calculation placement: cost, context and freshness

Choose the layer by business context and measured workload, not a rule that
everything belongs in SQL or everything belongs in DAX. Freeze grain,
population, date role, freshness, security and required detail before moving
logic. A source transformation must preserve the report contract.

## Decision matrix

| Layer | Appropriate use | Cost and boundary |
| --- | --- | --- |
| SQL SELECT or ordinary view | Stable projections, row filters, join/key resolution, deterministic deduplication and row attributes shared by refreshes. | The view is a reusable virtual query, **not stored precomputation**. Joins/expressions may execute whenever queried. Import pays during refresh; DirectQuery may pay per interaction. Examine folding, plans, reads and concurrency. |
| Source materialized/staged result or eligible indexed view | Expensive stable reusable preparation/aggregation when freshness, grain and source maintenance permit it. | Stores results outside Power BI; shifts work to a managed source refresh/write process and consumes source storage. Indexed-view eligibility/maintenance restrictions differ from ordinary views. Needs a reviewed source proposal and separately authorized deployment. |
| Folded Power Query | Projection, filtering, typing, stable attributes and preparation that the connector can push to the source. | Shifts supported work to SQL without extra stored Power BI calculations. Folding is connector/step specific: prove the source query/plan. Model memory still depends on the loaded result. |
| Local Power Query | Required preparation that cannot fold or has no authorized source implementation. | Consumes refresh resources and can transfer large intermediate data. Prune rows/columns early, preserve dependency order and disable staging-query load when appropriate; verify downstream consumers. |
| Model column or calculated table | A required relationship/sort/slicer/grouping attribute, disconnected selector or small model structure with stable refresh-time meaning. | Import persists results and increases memory/refresh work. DAX calculated columns are generally less efficiently compressed and processed after loaded queries. Avoid large high-cardinality strings and expanded duplicate facts; prefer preparation for static attributes when justified. Verify storage-mode restrictions. |
| DAX measure | Reusable metric depending on current filters, date role, user selection or security; ratios, distinct counts and business statistics. | Evaluates on demand instead of storing a per-row result. Repeated scans/iterators and broad contexts can be expensive; profile queries and optimize grain/reuse. A measure does not add a stored column, but query intermediates/cache still use memory. |
| Visual calculation | A local operation over the visual's aggregated matrix, such as a display-only running total or comparison in its visible sequence. | Uses visual context and order/reset rules; cannot serve as a shared model measure or relationship field. Top N, hidden fields, sorting and totals can change its population. Verify current visual/export/renderer capabilities before use. |

These distinctions follow Microsoft's
[calculation options](https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-calculations-options),
[Import data-reduction guidance](https://learn.microsoft.com/en-us/power-bi/guidance/import-modeling-data-reduction),
[visual calculation contract](https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-visual-calculations-overview)
and [SQL view types](https://learn.microsoft.com/en-us/sql/relational-databases/views/views?view=sql-server-ver17).
Verify evolving visual-calculation/storage-mode features against the installed
Desktop and service version; do not turn preview or version-specific support
into a permanent assumption.

## Practical routing examples

- A stable cancellation classification or normalized key can be prepared in
  SQL/folded M if its definition is independent of report selection. Retain
  a compact useful attribute; do not import verbose source text merely because
  it was easy to compute.
- A selected-period cancellation rate, distinct-person count or percentile
  generally needs a reusable context-sensitive measure. Precompute only at a
  grain sufficient for the agreed filter population, and validate equivalent
  aggregation. Never average group averages/medians or sum overlapping distinct
  counts. Store additive components only when the contract supports it.
- A running total restricted to the visible sorted categories may suit a
  visual calculation. A shared cumulative business KPI with fixed date/population
  semantics belongs in the semantic model. Test matrix totals and Top N explicitly.
- Three alternative date roles do not automatically justify tripling a fact
  table. Compare role-playing dimensions/inactive relationships with explicit
  measures, a justified compact bridge, or an expanded fact. Measure complexity,
  rows/memory and all date-filter combinations before selecting an approach.

## Reduce memory without losing required behavior

Start with unnecessary imported rows and columns, excessive history/detail,
long text/high-cardinality identifiers, duplicated fact expansion and redundant
date tables. Check graph/security/external consumers before removal. Do not
approximate IDs, truncate keys or round required amounts to save memory.
Use accurate compact data types and shared date dimensions where appropriate.
An aggregate fact saves memory only when its grain supports every required
filter, drillthrough and nonadditive metric; preserve a detail path when needed.
Benchmark loaded model and refresh peak memory rather than compressed PBIX size.

Record the tradeoff: precomputed columns may reduce query CPU while adding
stored memory and refresh work; measures may reduce storage while increasing
interaction cost; source materialization can reduce repeated queries while
adding SQL storage, maintenance and freshness lag. Judge the whole workload.

## Folding and incremental refresh

Inspect the actual source query/query plan and each important boundary. Do not
assume that every M step folds or that native SQL always prevents later folding.
Supported connectors can use `Value.NativeQuery(..., [EnableFolding=true])`;
verify this against the actual connector and version rather than past recipes.
See [native query folding](https://learn.microsoft.com/en-us/power-query/native-query-folding).

For incremental refresh, ensure `RangeStart`/`RangeEnd` predicates reach the
source, by folding or a supported parameterized native query. Use nonoverlapping
boundaries and verify dates/time zones. Account for late cancellations,
corrections/deletes and history outside the refresh window; retention alone
does not ensure corrections are captured. Test initial/full refresh cost and
peak memory as well as later partitions. Check mode/capacity limits against
the actual configuration. See [incremental-refresh contracts](https://learn.microsoft.com/en-us/power-bi/connect-data/incremental-refresh-overview).

## Propose a source view from verified lineage

Start from authorized source objects and the semantic model's documented grain,
keys and business rules. A semantic model is not automatically a SQL schema:
measures, relationships, RLS and filter context cannot be mechanically converted
to a view. Resolve lineage first; mark unknown tables/columns as blockers rather
than inventing them.

Prepare a reviewable SELECT, optional **not-deployed** DDL proposal and source
contract. Specify explicit output columns, grain/key, join cardinality and
deduplication/tie policy, null/type/date rules, retained history, freshness,
security, source/version compatibility and independent reconciliation queries.
Document folding and expected query-plan cost. Avoid `SELECT *`, silent fan-out,
aggregations that erase required filters, or static source aggregates that
cross security boundaries. Model RLS must still enforce the authorized context;
a shared precomputed total can disclose a wider population if designed wrongly.

An ordinary view organizes source logic but does not cache its result. Propose
materialization separately only after source plan measurements and a freshness/
maintenance contract justify it. Do not CREATE/ALTER views, tables, indexes,
permissions or jobs from an audit/skill-update request; deployment requires
specific authorization and the project's database gates. Validate read-only
existing queries only within authorized source and resource limits.

For each accepted placement retain original/candidate result cases, measured
model/query/refresh/source costs and a rollback. If only a proposal was prepared,
state `not deployed; performance unmeasured`.
