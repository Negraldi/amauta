---
name: tabular-data
description: "Trigger: reading or validating Excel xlsx xls, Parquet, CSV, TXT data with pandas, pyarrow, openpyxl, or R readr readxl arrow; dtypes, encodings, large files. Apply safe tabular data handling."
license: MIT
metadata:
  author: amauta
  version: "1.0"
---

## Activation Contract

Load this skill when reading, profiling, validating, converting, or writing tabular files (Excel, Parquet, CSV, TXT) from Python or R.

## Hard Rules

- Never modify the original file. Open read-only, and write results to a new path (new name or an `output/` dir). Do not save back into a workbook you loaded.
- Look before parsing: size (`stat`), first lines (`head -n 5`), encoding, delimiter, header row, sheet names. Do not guess.
- Declare dtypes and parse dates explicitly; read identifiers, zip codes and phone numbers as strings (leading zeros).
- Validate right after reading: expected columns, dtypes, null counts, duplicate keys, value ranges; fail loudly with the column name.
- Large files: never load everything blindly. Sample with `nrows`, read selected `usecols`, or stream in chunks; prefer Parquet for intermediate data.
- Excel traps: formulas return cached values only (`data_only=True`), merged cells and multi-row headers need `header=`/`skiprows`, `.xls` needs `xlrd`, dates may be serial numbers.

## Reference

| Format | Python | R |
|---|---|---|
| CSV / TXT | `pd.read_csv(p, sep=..., encoding=..., dtype=..., na_values=..., chunksize=N)`; sniff with `csv.Sniffer` | `readr::read_delim(p, delim=, locale=locale(encoding=), col_types=)`; `vroom`/`data.table::fread` for big |
| Excel | `pd.read_excel(p, sheet_name=, header=, usecols=, dtype=)`; `openpyxl.load_workbook(p, read_only=True, data_only=True)` for huge sheets | `readxl::read_excel(p, sheet=, range=, col_types=)`, `excel_sheets()` |
| Parquet | `pd.read_parquet(p, columns=[...])`; `pyarrow.parquet.ParquetFile(p).iter_batches()`; schema via `pq.read_schema(p)` | `arrow::read_parquet(p, col_select=)`, `open_dataset()` + `dplyr` verbs for larger-than-memory |

- Encodings: try `utf-8`, then `utf-8-sig` (BOM), `latin-1`/`cp1252` (Spanish accents); detect with `file -i`.
- Delimiters: `,` `;` (decimal comma locales) `\t` `|`; set `decimal=","` / `locale(decimal_mark=",")` when needed.
- Writing: `to_csv(index=False, encoding="utf-8")`, `to_parquet(compression="snappy")`, `write_csv`, `arrow::write_parquet`.

## Execution Steps

1. Inspect the file (size, head, sheets/schema) without loading it fully.
2. Read with explicit options; run the schema checks.
3. Transform in memory; write to a new file; verify row/column counts against the source.
