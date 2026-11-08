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
      "category": "Sales",
      "steps": [
        { "name": "Extract", "type": "python", "script": "etl/extract.py", "args": ["--week", "last"], "timeout": 900,
          "retries": 2, "retry_delay": 60, "outputs": ["out/sales.parquet"] },
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

Paths are relative to the project. Optional per step: `timeout` (seconds, default 3600), `cwd`, `enabled: false`, and:

- `retries` (0 to 5) and `retry_delay` (seconds, default 30): a failed or timed-out step is tried again, for the
  failures that pass on their own (a dropped database connection, a busy file share). A cancel stops the waiting too.
- `outputs`: files the step must write, e.g. `["out/sales.parquet", "reports/weekly.xlsx"]`. If one is missing or was
  not modified during the step, the step fails even though its script exited 0: this catches the workbook that did
  not refresh or the query that wrote nothing. The run records each output's size and time, and the portal lists them.
Optional per pipeline: `description`, and `category`, which groups the cards in the portal.
Database, workbook and mail steps are your own scripts: amauta has no drivers, so a step does whatever its script does.
Keep credentials in those scripts' own configuration; a definition with a secret-like value is refused.

## Running them

```
amauta pipeline list [--cwd DIR]
amauta pipeline run <id> [--cwd DIR] [--python EXE]   # prints "[step] line" as it runs; exit 0 ok, 1 failed, 130 cancelled
amauta pipeline run <id> --step 2                     # only that step (1-based); the others are skipped
amauta pipeline status [--json]                       # the last run of each pipeline
amauta pipeline cancel <id>                           # stops the running step's whole process tree
amauta pipeline schedule-hint <id> [--at HH:MM] [--day mon] [--os windows|linux|darwin]
```

Steps run in order; a failed, timed-out or cancelled step stops the run. Every output line is written to
`<state dir>/pipelines/runs/<project>/<id>-<time>.jsonl` with secrets and identifiers redacted, together with what
started the run (`cli`, `portal` or `schedule`) and how long each step took.

Each step's process gets `AMAUTA_PIPELINE` (the id), `AMAUTA_PIPELINE_TRIGGER` (`cli`, `portal` or `schedule`) and
`AMAUTA_PIPELINE_STEP` (its number). A script can use them, for example to send its mail only on a scheduled run and
skip it when you try a step from the portal:

```python
import os
if os.environ.get("AMAUTA_PIPELINE_TRIGGER") == "schedule":
    send_report()  # your own code: amauta sends nothing
```

Dates in a subject or a file name ("cut-off yesterday") are your script's to compute; amauta has no placeholders.

## In the portal

Projects > Pipelines lists every known project that defines pipelines, with the last run of each (its result, when,
how long it took and what started it). Category pills and a search narrow the cards. **Run** asks first,
then starts the run as a separate process (it keeps going if the window closes) and shows each step's mark
(✓ ok, ✗ failed, ⏱ timed out, ■ cancelled, – skipped) and the output in a console as it arrives. A project must be
trusted first (`amauta check trust`), because a run executes its code; the page sends only the project and the
pipeline id (and, for **Only this**, the step number), never a command. The console has **Copy** and **Clear**.

## On a schedule

amauta does not schedule anything: your operating system does. `schedule-hint` prints the entry for it, which runs
`amauta pipeline run <id> --trigger schedule --cwd <project>` at the time you give (daily, or weekly on `--day`):

- Windows: a `schtasks /Create ...` line to run once in a terminal (Task Scheduler then shows the task).
- Linux: a crontab line for `crontab -e`.
- macOS: a launchd agent to save under `~/Library/LaunchAgents/` and `launchctl load`.

A scheduled run is the same as one from the terminal: its output goes to the events file and the portal shows it as
the last run.
