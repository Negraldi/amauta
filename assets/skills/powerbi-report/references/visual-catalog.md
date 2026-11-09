# Verified native visual roles

Use this small catalog when selecting a native visual. These roles were read
from the installed Power BI Authoring CLI 0.4.0 `catalog describe` output;
query the installed version again before authoring because the catalog can
change. The role names are CLI binding names, not a guarantee that a visual
will render or answer the business question.

| Visual | Required role | Optional roles checked | Typical question |
| --- | --- | --- | --- |
| `cardVisual` | `Data` | — | What is the one key value? |
| `slicer` | `Values` | — | Which population is selected? |
| `clusteredColumnChart` | `Category`, `Y` | `Series`, `Rows`, `Tooltips` | How do categories compare? |
| `donutChart` | `Category`, `Y` | — | How do a few parts add to one total? |
| `tableEx` | `Values` | — | What are the exact records or aggregates? |
| `pivotTable` | `Values` | `Rows`, `Columns` | How do exact aggregates cross two dimensions? |
| `lineChart` | `Category`, `Y` | `Series`, `Y2`, `Rows`, `Tooltips` | How does a measure change over time? |

For a concrete fixture, run the versioned
`tools/build-phase1-powerbi-v4.py` synthetic builder and inspect its four
visuals in Desktop. It is an example of bindings and layout, not a source
of brand colors or a reusable business model. For visual styling use the
[internal profile](../profiles/example.md) when the project selects it.
