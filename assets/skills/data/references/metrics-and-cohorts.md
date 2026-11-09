# Metrics and cohorts

A declarative definition with evidence, not executable business logic. Record the project, a contract identifier and
version, the owner, source references, approval status, open conflicts and the consumers affected. Confirmed project
rules win over imported proposals; a missing definition stays unresolved until its owner decides.

## Minimum definition

| Element | Meaning to state |
| --- | --- |
| Grain | The unit counted or valued; uniqueness keys and join cardinality |
| Population | Eligibility, exclusions, deduplication order, unresolved ties |
| Events | Distinct event types and their date roles; renaming a column must not swap them |
| Time | Timezone, anchor, interval inclusivity, update cadence, period completeness |
| Cohort | Entry event, membership rule, observation window, exit or censoring rule |
| Formula | Numerator, denominator, units, weighting, reconciliation invariants |
| Availability | Missing input, empty population, valid zero, stale input, unavailable state |
| Evidence | Approved source and version, independently computed expected results |

Never resolve a tie by taking the first row or read an unavailable input as zero. A stock at a point differs from
events during an interval; calendar periods, elapsed durations and partial periods are different populations.

Say which kind each metric is: a stock (what is active at the close), a flow (what entered or left during the period)
or a cohort (what happened to the group that entered in one period, over a window). Flows reconcile with stocks:
opening stock + entries + reactivations - exits = closing stock, with every difference explained.

## Synthetic acceptance cases

Use an invented event stream with opaque keys (for example a fictional library: reservation, loan, return) and
parameters chosen for the fixture, never a real domain's thresholds.

- Membership just before, at and after both interval endpoints.
- Crossing local midnight and a timezone offset with explicit timestamps.
- Complete versus partial months and aligned cutoffs.
- Missing event dates, no eligible items, a valid zero, stale input.
- Duplicate events, tied priorities and one-to-many joins: the approved resolution, or an explicit unresolved result.
- A small cohort whose numerator and denominator were computed by hand.

Record which cases ran. Textual examples are not runtime acceptance.
