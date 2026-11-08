# Bounded PBIR authoring notes

These checks use fictional report fields. They are diagnostic starting points,
not guarantees across every Desktop or Service version. Inspect the installed
CLI schema and check the changed path in the actual report. Theme values are
plain JSON; PBIR properties use expression wrappers.

- **Order:** declare the field and direction in `visual.query.sortDefinition`
  and omit `isDefaultSort: true`. For example, sorting `Synthetic.Category`
  ascending uses `{"sort":[{"field":{"Column":{"Expression":{"SourceRef":
  {"Entity":"Synthetic"}},"Property":"Category"}},"direction":"Ascending"}]}`.
  Use a chronological model key for month labels. Record or reset personal visual/filter state when checking a published report.
- **Matrix hierarchy:** for two row fields, start with only the first row
  projection `active: true`. Collapsed expansion state can hide periods without changing totals. Check all periods and expanded/collapsed states; do not
  infer complete coverage from the grand total.
- **Exact numbers:** where the installed visual exposes `labelDisplayUnits`,
  `1D` in PBIR means unscaled units; `0D` means automatic abbreviation.
  Confirm the relevant object/property for that visual rather than applying
  it blindly to every card type.
- **Buttons:** state-specific `actionButton` formatting needs the matching
  selector, for example `"selector":{"id":"default"}`. Inspect label,
  enabled and disabled behavior. A `ClearAllSlicers` button can be disabled
  when nothing is selected; a portable disabled-style recipe is not yet verified.
- **Extra matrix statistics:** columns after a dynamic month field may need
  a disconnected column table and a `SWITCH` measure. Define the aggregation
  and filter context before adopting that model pattern.
- **Theme overrides:** existing visual formatting or a table style preset can
  override a theme. Inspect the actual table/matrix; use an explicit `None`
  style preset where the installed version requires it for custom row colors.
  Do not remove user formatting outside the approved redesign.

Reference: Microsoft's [table and matrix authoring guide](https://github.com/microsoft/skills-for-fabric/blob/main/plugins/powerbi-authoring/skills/powerbi-report-authoring/references/table.md)
and [custom theme documentation](https://learn.microsoft.com/en-us/power-bi/create-reports/report-themes-create-custom).
