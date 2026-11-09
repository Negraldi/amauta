# Statistical and period contracts

Read when creating or changing averages, medians, extrema, comparisons,
matrix totals, rolling windows or formatted amounts.

## Define the iterated population

For every statistic, record the iterator's unit and population, filter window,
date role, weighting, and treatment of missing observations. Distinguish:

- complete dates, including the year and month;
- calendar days with facts versus all calendar days;
- the 1-31 day-of-month positions, potentially accumulated across months;
- months with facts, all months, complete months and partial boundary months.

A median or maximum over day-of-month totals is not a daily statistic over
complete dates. Both may be valid. State which is intended for row subtotals
and the grand total. Do not silently add subtotals, average already averaged
rows or reuse a measure whose population differs from its label.

## Align the iterator with the measure context

A date window inside a base measure does not necessarily restrict VALUES
evaluated outside it. Check iterator membership as well as the scalar result.
Use an explicit population matching the contract; do not introduce blanket
IFERROR or zero fallbacks that make missing or failed calculations look valid.

MEDIANX does not ignore BLANK. MEDIAN and AVERAGEX have different behavior;
do not apply one function's blank policy to another. If the contract excludes
dates without a result, filter the iterator accordingly. If zero-activity
dates belong to the population, generate them through the agreed calendar
and distinguish them from unavailable inputs.

An empty selection, valid zero and unavailable result must have separate
meanings. Check the denominator before displaying a percentage. Label the
period anchor: clock date, loaded maximum, refresh date or user selection.
TODAY/GETDATE in an imported/calculated table is evaluated at processing,
not on every report click. A 12-month date interval can touch 13 calendar
month groups; do not label an average as 12 complete months without checking.

## Meaningful cases for changed behavior

Use independent expected results and execute affected measures and direct
consumers in the authorized real engine. Select cases by the change:

| Change | Relevant cases |
|---|---|
| Temporal statistics | No explicit range, one month, several months, partial interval, empty interval, row and grand total |
| Date roles | Default role, each changed role, missing role date and switching roles under another filter |
| Classification | Mapped and unmapped categories, conflicting/duplicate keys, excluded blank category |
| Count or amount | Business-key uniqueness, fan-out, totals before/after transformation, unit and scale |
| Rankings | Default and filtered order, ties, fixed-at-refresh versus dynamic ranking |
| Context labels | Their numeric measure's actual population/window, latest date and unavailable state |

These are relevant cases, not a requirement to rerun every report combination
after every edit. For synthetic engine cases, use permitted disposable local
artifacts and no production writes. Record which checks ran and why.

## Formatting is a separate contract

Keep the numeric result separate from abbreviated or HTML text. State raw
unit, divisor, suffix, precision and rounding. Check values around scaling
thresholds, including 999, 1000, 999999 and 1000000 when using K/M, plus zero,
negative and unavailable values where meaningful. K uses 1000 and M uses
1000000 only when the underlying number is expressed in unscaled units;
already-scaled source amounts need their own explicit conversion.

Check the actual affected render expression, not just an unrelated numeric
measure. HTML Content, native cards and chart axes can apply different display
units. Do not infer numerical correctness from plausible formatted text.

References: [MEDIANX](https://learn.microsoft.com/en-us/dax/medianx-function-dax),
[AVERAGEX](https://learn.microsoft.com/en-us/dax/averagex-function-dax).
