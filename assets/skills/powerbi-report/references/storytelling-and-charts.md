# Storytelling and chart choice

Read when planning the pages of a new report, choosing a visual, or critiquing a page that does not read well. It
complements [clean report design](clean-report-design.md), which sets the composition rules.

## The story of a page

1. Headline: the few numbers that answer the page's question, each with its comparison (target, previous period,
   same period last year). A number without a reference is not a finding.
2. Evidence: from general to specific, the trend over time and the breakdown that explain the headline.
3. Detail: the exact figures behind the evidence, and the note on method (population, as-of date, exclusions).

A report moves the same way across pages: summary first, then one page per question, then detail and method.

## Choosing a visual

| Visual | Answers | Use it when | Avoid |
| --- | --- | --- | --- |
| Card | What is the key value now? | Three to five headline numbers, each with a comparison | Many cards, or values with no reference |
| Bar (horizontal) | Which is largest, how do they rank? | Categories with long names, sorted by value | More than about fifteen bars without a top-N and "other" |
| Column | How do a few categories or periods compare? | Few categories, or discrete periods | Long labels, many series stacked |
| Line | How did it change over time? | Continuous periods, actual against target | Categories with no order |
| Donut | How do two to four parts make a whole? | Few parts with clear differences | More than four parts, or parts of similar size |
| Table or matrix | What are the exact figures? | Backing the charts with detail, with light conditional format | Finding a trend in long rows of numbers |

## Four common mistakes

1. Too many blocks: beyond four or five main visuals besides the headline, split the page or use a dimension switch.
2. Too many colors: one accent for the data in focus, grays for context, and green, amber and red only for meaning.
3. Decoration: no 3D, no heavy gridlines, no busy backgrounds.
4. Titles with no context: every title says what is measured, in which unit and for which cut, for example "Sales
   (units), last 12 closed months, by region".

## Color with direction

Decide for each metric whether a rise is good or bad before choosing colors. For cancellations, costs or delays,
higher is worse: a rise is red and a fall is green. Put the direction in the metric's contract, never in the visual
only, and never let color alone carry the meaning (add the sign or an arrow).

## Two header measures

The as-of date the page shows, from the data rather than from the refresh clock:

```dax
Data As Of =
VAR _last = CALCULATE ( MAX ( Sales[Date] ), REMOVEFILTERS () )
RETURN "Data as of " & FORMAT ( _last, "yyyy-mm-dd" )
```

How many of the page's main filters are active, for a label or a button that lights up:

```dax
Filters Applied =
VAR _n = INT ( ISFILTERED ( Region[Name] ) ) + INT ( ISFILTERED ( Product[Category] ) )
    + INT ( ISFILTERED ( Calendar[Month] ) )
RETURN IF ( _n = 0, "No filters applied", "Filters applied (" & _n & ")" )
```

List the columns the page's slicers actually use; a column missing from the list is a filter the label hides. Both
measures return text for a label; keep numeric measures numeric.
