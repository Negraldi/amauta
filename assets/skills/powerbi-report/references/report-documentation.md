# Report documentation outline

Read when a report needs its documentation written or updated, for handover, an audit or a catalog. Write it in the
report's language and in plain words. Facts come from the PBIP and the project's records; what is not known stays
marked as open, never invented. The selected profile may name a required template or format (Word, a wiki page);
the content below fits any of them.

Generate the parts that can be read from the files instead of typing them: the data dictionary with
`amauta.extras.pbir dictionary MODEL`, the pages and visuals from the PBIR folder, and the sources from the lineage
record of the `data` skill's provenance reference. Screenshots need the user's permission to open Desktop.

```markdown
# <Report name>
Owner: <role> · Version: <n> · Last updated: <date> · Status: <draft | in review | approved>

## 1. Summary
What the report is for, who reads it and the decision it supports, in three to five sentences.

## 2. Recommendations for readers
How to read it well: the default period, what a blank means, which page to start with.

## 3. Description and objective
The questions each page answers and what is out of scope.

## 4. Audience
Roles (not names) that use it, and how often.

## 5. Data sources
Each source by reference (system, schema and table, or file), its owner role, refresh cadence and as-of rule; the
lineage record for each output table.

## 6. Pages and design
Per page: its question, the main visuals, the reading order and a screenshot when allowed.

## 7. Measures and metrics
Each critical measure with its contract: definition, grain, population, unit, comparison and direction (is a rise
good or bad). Link the data dictionary.

## 8. Filters and controls
Slicers, filter-pane fields, bookmarks and buttons; their defaults and how to reset them.

## 9. Interpreting the data
Known limits, partial periods, exclusions and how totals behave.

## 10. Refresh
Schedule, gateway or credentials owner role, how a failed refresh is noticed and who acts.

## 11. Access and security
Workspace and app audience, row-level security roles and how access is requested. No personal data in the document.

## 12. Maintenance and support
Where the source is kept (repository and branch), how to change it, the checks to run and the support channel.

## 13. Version history
| Version | Date | Change | Approved by (role) |
| --- | --- | --- | --- |
```

Keep the document next to the PBIP in version control. When the report changes, update the sections it touches in the
same change, and run `amauta.extras.pbir diff OLD NEW` to see which measures and columns moved.
