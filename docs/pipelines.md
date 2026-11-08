# Pipelines

Run a project's recurring processes (queries, workbook refreshes, scripts, notebooks, reports) and see their output
live, from the terminal or the portal (ADR 0010).

## Defining them

`.amauta/pipelines.json` in the project:

```json
{
  "pipelines": [
    {
      "id": "weekly-sales",
      "name": "Weekly sales report",
      "steps": [
        { "name": "Extract", "type": "python", "script": "etl/extract.py", "args": ["--week", "last"], "timeout": 900 },
        { "name": "Model", "type": "r", "script": "analysis/model.R" },
        { "name": "Notebook", "type": "notebook", "path": "reports/weekly.ipynb" },
        { "name": "Refresh workbook", "type": "command", "argv": ["python", "tools/refresh_excel.py", "out/sales.xlsx"] }
      ]
    }
  ]
}
```

| Step type | Runs |
| --- | --- |
| `command` | `argv` exactly as listed: a list, never a shell string, so nothing is expanded or chained |
| `python` | `python3` (or `interpreter`) `script args...` |
| `r` | `Rscript` (or `interpreter`) `script args...` |
| `notebook` | `jupyter nbconvert --to notebook --execute`, writing `<name>.run.ipynb` beside the source |

Paths are relative to the project. Optional per step: `timeout` (seconds, default 3600), `cwd`, `enabled: false`.
Database, workbook and mail steps are your own scripts: amauta has no drivers, so a step does whatever its script does.
Keep credentials in those scripts' own configuration; a definition with a secret-like value is refused.

## Running them

```
amauta pipeline list [--cwd DIR]
amauta pipeline run <id> [--cwd DIR] [--python EXE]   # prints "[step] line" as it runs; exit 0 ok, 1 failed, 130 cancelled
amauta pipeline status [--json]                       # the last run of each pipeline
amauta pipeline cancel <id>                           # stops the running step's whole process tree
```

Steps run in order; a failed, timed-out or cancelled step stops the run. Every output line is written to
`<state dir>/pipelines/runs/<project>/<id>-<time>.jsonl` with secrets and identifiers redacted.

## In the portal

Projects > Pipelines lists every known project that defines pipelines, with the last run of each. **Run** asks first,
then starts the run as a separate process (it keeps going if the window closes) and shows each step's mark
(✓ ok, ✗ failed, ⏱ timed out, ■ cancelled, – skipped) and the output in a console as it arrives. A project must be
trusted first (`amauta check trust`), because a run executes its code; the page sends only the project and the
pipeline id, never a command.
