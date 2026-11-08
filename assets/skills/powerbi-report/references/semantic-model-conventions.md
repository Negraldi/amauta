# Semantic model organization and integrity

Read for a new model, a semantic change, a model audit or new shared measures.
For a layout-only edit, use these criteria to report relevant defects without
restructuring the model outside the authorized scope.

## Grain and layers

- Prefer a stable business grain in each fact and dimensions for reusable
  grouping, classification and filtering. This is a default, not a mandate
  to create a dimension for every attribute. State why a different structure
  serves the actual report requirements.
- Record the business key and the physical row grain separately. Unpivoting
  date roles or joining overlapping classifications can multiply rows while
  preserving business entities. Define valid counts and sums at that grain;
  do not equate COUNTROWS with business entities without a uniqueness check.
- Choose date-role relationships from the requirements: switching one role
  at a time differs from independently filtering several roles. Do not
  replace a role-playing design with row multiplication merely to simplify
  a slicer. Conversely, do not ban an event/role fact when its grain is useful.
- Keep ingestion and stable cleaning in SQL/M, relationships in the model,
  context-dependent metrics in DAX, and visual composition in PBIR. Explain
  refresh-time rankings and business classifications that are materialized.
- Prefer explicit source columns and types for maintained queries. A short
  SELECT * query is not automatically cleaner. Check schema drift, source
  connections and refresh dependencies; do not claim folding or performance
  gains without inspecting and measuring the relevant path.

## Measures and terminology

For new models or authorized organization work, centralize measures in a
dedicated measure table and business-purpose folders, for example Counts,
Amounts, Dates, Context and Presentation. Match the report's language and
existing conventions; the example folder names are not universal requirements.
Use descriptive names and hide implementation helpers. Keep numeric measures
reusable and separate from contextual labels, HTML and display formatting.
Do not rename tables/measures during an unrelated visual fix.

Each measure description must identify what it counts or sums, its unit,
grain, applicable date role/window and important exclusions. A name such as
Premium must not silently add a financial interpretation to a source field
that merely stores Product value. Distinguish latest event date, latest loaded
date, refresh timestamp and displayed period.

## Dimensions and classifications

Check unique dimension keys, missing keys, nulls and fan-out with authorized
aggregate queries. Reconcile counts and amounts before and after joins.
Measure unmapped entities and their impact, not just the number of missing
category names. Use an explicit Unmapped category when the agreed contract
requires preserving their contribution; do not silently exclude them.

Prefer maintained, reviewable classification sources over duplicated or
opaque embedded tables. If a manual lookup is retained, record its owner,
version, update method and unmatched-key policy. A DISTINCT over several
attributes does not prove uniqueness of the relationship key. A catch-all
classification must be supported by a business rule, not inferred from the
absence of another label.

Prefer one-way dimension-to-fact filtering. Document the exact purpose of
each bidirectional or many-to-many relationship and test combinations that
could change propagation. Their mere presence is not a failure.

## Dependency review

Validate active query fields, filters, conditional-format measures, sort-by
columns, relationships, parent groups, interaction targets and navigation
destinations against the exact candidate. Include hidden components that the
changed interaction can activate. Separate active expressions from old
format selectors and from queryRef display identifiers. Do not treat an old
queryRef name as proof of a missing binding when Entity/Property is valid.

amauta's PBIR tools read the candidate's own files (no metadata export needed):

```text
{{AMAUTA_PY}} amauta.extras.pbir lint path/to/Model.SemanticModel        # DAX and model rules, warnings only
{{AMAUTA_PY}} amauta.extras.pbir diff old/Model.SemanticModel new/Model.SemanticModel
{{AMAUTA_PY}} amauta.extras.pbir layout path/to/Report.Report             # outside the page, overlaps, tiny visuals
{{AMAUTA_PY}} amauta.extras.pbir rename path/to/Report.Report --table T --from Old --to New   # dry run; --apply writes
```

They parse model.bim or TMDL and the PBIR JSON; they do not compile DAX or M, prove key uniqueness or render
visuals. A clean run means only that these static checks passed. Keep the official schema validation and real DAX
checks; if the model metadata is unavailable, record static dependency validation as unavailable.

Column references inside formatting objects can be dormant selectors or
active formatting expressions. Review them as warnings; inspect their property/state and runtime before accepting the
affected visual. Missing measures used in formatting remain errors.
Hierarchy bindings need metadata and runtime review; static tools do not validate hierarchy expansion or field-parameter selection semantics.

Missing active bindings, enabled static navigation targets and scoped model
dependencies block acceptance of the affected change. Old selector references,
unverified dynamic destinations and apparently unused components require
review. Remove them only after checking their callers/states and authorized
scope. Do not automatically delete an object because a static scan finds no
visible use: bookmarks, field parameters, RLS and external consumers can matter.

References: [Microsoft star schema guidance](https://learn.microsoft.com/en-us/power-bi/guidance/star-schema),
[date-role relationships](https://learn.microsoft.com/en-us/power-bi/guidance/relationships-active-inactive),
[bidirectional filtering](https://learn.microsoft.com/en-us/power-bi/guidance/relationships-bidirectional-filtering).
