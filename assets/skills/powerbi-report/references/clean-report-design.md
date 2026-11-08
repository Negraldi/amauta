# Clean report composition and presentation

Read for new pages, authorized layout redesigns and visual critique. Keep
existing layout and unrelated formatting during narrow semantic fixes.

## Small page design contract

Record the primary question, reading order, dominant visual, first-viewport
content, blocks, local/global filters, and empty/error states. Use the
canonical skill's **1280 px canvas width** rule; height follows useful content.
Canvas width is not the inspection viewport: review at least 1366 x 768 and
the whole scrollable page. Record any explicit user width exception.

Choose an alignment grid, outer margins, gaps, typography and restrained
colors from the selected profile. Keep matching elements aligned and spaced
consistently. Increase useful height or separate questions across pages before
shrinking essential labels. Do not impose a universal number of cards/charts
or generate unused KPI placeholders merely to fill a composition.

Group visual components that move or behave together. Use names identifying
their purpose, such as Header, Primary filters, Period summary and Daily
matrix, in the report's language. Replace names such as Group 3 only during
authorized organization work. Stable visual IDs support review and interaction
bindings; changing a display name does not justify regenerating IDs.

## Order and interaction

Declare chronological versus ranked order, ties, hierarchy behavior and
fixed-at-refresh versus dynamic rankings. Check the order after meaningful
filters and save/reopen. A field parameter changes an axis; it does not
automatically change the date role governing the measure.

Keep active filter state and reset behavior understandable. Every button
needs a real supported action and working destination. A floating filter
panel requires complete hidden/visible states, valid bookmarks and a tested
open/change/close/reset path. Prefer exposed controls when a panel adds states
without helping the actual task. Hidden components are part of the journey
if a changed action can reveal them.

Review alt text, keyboard/tab order, accessible labels, contrast, long titles,
large numbers, clipping, tooltips and meaningful no-data/error states. Do not
promise accessibility merely because a visual is native or has alt text.

## Numeric logic and renderers

Start from supported native visuals. Keep canonical numeric measures in the
model and presentation rules in the chosen renderer. For an approved HTML or
other custom visual, document the unmet native need and the maintenance,
interaction, export and accessibility implications.

Avoid repeating business calculations inside several HTML measures. Reuse
numeric measures and maintain repeated templates/styles from one source when
the chosen tool supports it. If generated templates are needed, keep the
source and deterministic regeneration method reviewable. Do not introduce an
unsupported templating mechanism or extra renderer just to satisfy a rule.

Review stale formatting selectors and apparently unused visual objects
alongside dependency findings. Do not remove another page, dormant feature,
bookmark state or user formatting without authorization. A clean diff and a
clean-looking screenshot do not prove identical filter behavior.

## Acceptance boundary

Check an early working slice and the final affected view in the real target,
under the existing desktop permission policy. Schema validation and an HTML
sketch cannot prove DAX, interactions, layout fidelity or accessibility.
For several changed navigation destinations, perform one meaningful synthetic
headless journey and repeat after a relevant fix. Record any target that
cannot be verified, including Service when it is in delivery scope.

Keep one concise acceptance record for design contract, source/model identity, static
dependency findings, executed metric/filter cases, viewports, real-target
review, exceptions, retained unused objects, cleanup and rollback point.
