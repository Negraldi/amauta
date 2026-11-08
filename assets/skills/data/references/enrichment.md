# Row-preserving enrichment

Adding columns to an existing table or workbook from a lookup, without losing, adding or reordering rows.

## Preserve the input

Record the source fingerprint, sheet or range, expected grain, original column names and order, key roles, permitted
additions and the output path. Keep the original and write a separate candidate. Give every source row an internal
ordinal before any transform; at the end every ordinal appears exactly once, in the original order, and the original
columns are unchanged. Remove the ordinal from the deliverable unless asked. For a workbook, compare the original cells
outside the edited range, formulas and required formatting included; a values export does not prove workbook fidelity.

## Keys

Read identifiers as text and keep the raw value. Trimming, case, padding and invalid keys need the documented format.
Never turn blanks into fabricated identifiers. Normalization must detect collisions: distinct raw keys that become the
same normalized key. Stop and ask when an ambiguity changes meaning.

## Matching and output

At most one lookup result per key. Duplicates need an owner-approved ordering and a deterministic tie-breaker;
otherwise report how many keys are ambiguous and stop. Keep unmatched rows and label missing enrichment differently
from zero. Append only the requested columns, with a declared policy for name collisions. Imputation, fuzzy matching,
filtering and sampling need their own explicit rules and labels.

## Reconcile

Input and output rows, distinct and blank keys, matched, unmatched and ambiguous keys, normalization collisions and the
relevant totals. Report counts only: never paste keys, pseudonyms or rows into chat or evidence. Test the procedure on a
synthetic table built for the case (duplicates, blank keys, leading zeros, a collision, an unmatched key).
