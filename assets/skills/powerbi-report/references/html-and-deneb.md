# HTML in DAX and Deneb visuals

Read before building a card, banner or micro-chart from a DAX measure that returns HTML, or a Deneb (Vega-Lite or
Vega) visual. Both are custom visuals: use them only when the organization approved the visual and a native visual
cannot answer the question. Colors, fonts and radii come from the selected profile's brand (`amauta profile show`),
never from an example.

## Choose

| Need | Use |
| --- | --- |
| A number, a ranking, a trend, exact detail | A native visual (see the [visual catalog](visual-catalog.md)) |
| A composed card: value, comparison, small bar, short note | An HTML measure in an approved HTML visual |
| A chart the native visuals lack (diverging bars, bullets, strip plots, small multiples) | Deneb with Vega-Lite |
| Custom interaction, signals or layouts Vega-Lite cannot express | Deneb with full Vega, only if someone can maintain it |

## HTML measures

- Compute numbers in their own measures and reference them; the HTML measure only formats. A text measure cannot be
  summed, sorted by value or exported as a number.
- Escape any text that comes from data before it enters the markup, so a value can never become markup.
- Keep the markup small and the same for every row; long strings slow the visual. No scripts, no external images or
  fonts; inline SVG for shapes.
- Give each visual alt text and keep the plain value available in a tooltip or a table: screen readers do not read the
  rendered HTML the way they read a native card.
- Rising is not always good: pick the semantic color by the metric's direction (see
  [storytelling and charts](storytelling-and-charts.md)).

```dax
Card Sales HTML =
VAR _value = [Sales]
VAR _prev = [Sales Previous Month]
VAR _delta = DIVIDE ( _value - _prev, _prev )
VAR _label = SUBSTITUTE ( SUBSTITUTE ( SUBSTITUTE ( SELECTEDVALUE ( Region[Name], "All regions" ),
    "&", "&amp;" ), "<", "&lt;" ), ">", "&gt;" )
VAR _color = IF ( _delta >= 0, "var(--good)", "var(--bad)" )
VAR _bar = FORMAT ( MIN ( MAX ( DIVIDE ( _value, [Sales Target] ), 0 ), 1 ) * 100, "0" )
RETURN
    "<style>:root{--good:#2e7d32;--bad:#c62828;--ink:#222;--line:#ddd}</style>"
        & "<div style='font-family:sans-serif;color:var(--ink);border:1px solid var(--line);padding:8px'>"
        & "<div>" & _label & "</div>"
        & "<div style='font-size:24px'>" & FORMAT ( _value, "#,0" ) & "</div>"
        & "<div style='color:" & _color & "'>" & FORMAT ( _delta, "+0.0%;-0.0%" ) & " vs previous month</div>"
        & "<svg viewBox='0 0 100 6' width='100%' height='6'><rect width='100' height='6' fill='var(--line)'/>"
        & "<rect width='" & _bar & "' height='6' fill='var(--ink)'/></svg></div>"
```

The colors above are neutral placeholders; replace them with the profile's tokens. `FORMAT` is right here because the
result is display text; numeric measures keep their format string instead.

## Deneb

- The visual's data is the dataset named `dataset`; fields are the names in the field well.
- Use the model's format strings with `"formatType": "pbiFormat"` in an encoding (or `pbiFormat()` in an expression)
  instead of writing a second format.
- Turn on tooltips, the context menu and cross-filtering in the visual's properties, then use `datum.__selected__`
  to dim the points that are not selected. Check the installed Deneb version's documentation: these names have changed.
- Keep the spec in the PBIR visual under version control and review it as code.

```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": { "name": "dataset" },
  "mark": { "type": "bar", "tooltip": true },
  "encoding": {
    "y": { "field": "Region", "type": "nominal", "sort": "-x", "title": null },
    "x": { "field": "Sales", "type": "quantitative", "title": "Sales (units)", "format": "#,0", "formatType": "pbiFormat" },
    "opacity": { "condition": { "test": "datum.__selected__ == 'off'", "value": 0.35 }, "value": 1 }
  }
}
```

## Check

Look at every changed HTML or Deneb visual in Desktop with permission: empty selection, one selected item, a long
label, a zero and a blank value, and the smallest viewport the report supports.
