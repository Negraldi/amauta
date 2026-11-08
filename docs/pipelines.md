# Pipelines

Run a project's recurring processes (queries, workbook refreshes, scripts, notebooks, reports) and see their output
live, from the terminal or the portal (ADR 0010). Steps form a graph: those that do not depend on each other run side
by side; steps and whole pipelines can be reused; modes switch steps on or off (ADR 0011).

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

Scripts, notebooks and outputs are relative to the project root and may not lead outside it (a symlink included);
`cwd` only sets the folder the step runs in. Optional per step: `timeout` (seconds, default 3600), `cwd`,
`enabled: false`, and:

- `retries` (0 to 5) and `retry_delay` (seconds, default 30): a failed or timed-out step is tried again, for the
  failures that pass on their own (a dropped database connection, a busy file share). A cancel stops the waiting too.
- `outputs`: files the step must write, e.g. `["out/sales.parquet", "reports/weekly.xlsx"]`. If one is missing or did
  not change during the step (size, file or modification time compared with a snapshot taken before it), the step
  fails even though its script exited 0: this catches the workbook that did not refresh or the query that wrote
  nothing. The run records each output's size and time, and the portal lists them.
Optional per pipeline: `description`, and `category`, which groups the cards in the portal.
Database, workbook and mail steps are your own scripts: amauta has no drivers, so a step does whatever its script does.
The `data` skill's pipeline recipes sketch them (SQL script to Parquet, workbook refresh, mail or reply-in-thread).
Keep credentials in those scripts' own configuration; a definition with a secret-like value is refused.

## Steps side by side, reuse and modes

A step may have an `id` and `needs`, the ids of the steps it waits for. A step without `needs` waits for the step
before it, so a list of steps stays a line; `needs: []` lets a step start at once. Ready steps run in parallel, at
most `max_parallel` at a time (default 4, up to 16).

```json
{
  "blocks": {
    "clean": { "type": "python", "script": "etl/clean.py", "retries": 1 }
  },
  "pipelines": [
    { "id": "prepare", "steps": [
        { "id": "sales", "use": "clean", "args": ["sales"] },
        { "id": "clients", "use": "clean", "args": ["clients"], "needs": [] } ] },
    { "id": "churn", "name": "Churn model", "max_parallel": 2,
      "modes": ["train", "train-predict", "predict"], "default_mode": "predict",
      "schedule": [ { "at": "06:00", "days": ["mon"], "mode": "train" }, { "at": "07:00", "mode": "predict" } ],
      "steps": [
        { "id": "data", "name": "Prepare data", "type": "pipeline", "pipeline": "prepare" },
        { "id": "features", "type": "python", "script": "ml/features.py", "needs": ["data"] },
        { "id": "train", "type": "python", "script": "ml/train.py", "needs": ["features"], "modes": ["train", "train-predict"],
          "outputs": ["models/churn.pkl"] },
        { "id": "predict", "type": "python", "script": "ml/predict.py", "needs": ["features", "train"],
          "modes": ["train-predict", "predict"], "outputs": ["out/scores.parquet"] } ] } ] }
```

- **A failure** skips only the steps that need the failed one (they end as skipped, reason `needs`); other branches
  finish, and the run ends failed.
- **Blocks** are step templates: a step with `use` starts from the block and overrides any field (`args`, `timeout`).
  A block holds step fields only.
- **A pipeline step** (`"type": "pipeline"`) is replaced by that pipeline's steps when the file is read, named
  `<step id>.<inner id>` (here `data.sales`, `data.clients`). Its first steps need what the pipeline step needs, and
  a step that needs it waits for all of its last steps. The used pipeline still runs on its own. Pipelines that use
  each other in a loop are refused.
- **Modes**: each step lists the modes it runs in (none: every mode). A run uses `--mode` or the portal's mode picker,
  or `default_mode`. A step outside the mode is skipped and counts as done, so `predict` in mode `predict` reads the
  model the last training wrote. Steps of a used pipeline take the modes of the step that uses it. Each step gets
  `AMAUTA_PIPELINE_MODE`.

## Running them

```
amauta pipeline list [--cwd DIR]
amauta pipeline check [<id>]                          # missing scripts, programs or folders, before a run; exit 1 on an error
amauta pipeline run <id> [--cwd DIR] [--python EXE]   # prints "[step] line" as it runs; exit 0 ok, 1 failed, 130 cancelled
amauta pipeline run <id> --step 2                     # only that step (1-based); the others are skipped
amauta pipeline run <id> --mode train                 # one of the pipeline's modes; exit 3 if it is already running
amauta pipeline status [--json]                       # the last run of each pipeline
amauta pipeline cancel <id>                           # stops the running step's whole process tree
amauta pipeline schedule-hint <id> [--at HH:MM] [--day mon] [--os windows|linux|darwin]
```

One run of a pipeline at a time, whoever starts it: the portal, the terminal or the OS scheduler take the same lock
(`<id>.lock` beside the runs), and a lock whose process is gone no longer counts; the lock also records when that
process started, so a process id the system reused for another program does not keep it. A run whose runner stopped without
ending it reads as abandoned. SIGTERM or Ctrl+C on the runner cancels the run and still writes its end.

A step owns its processes. On a timeout or cancel its whole process tree is stopped; on Linux and macOS whatever it
left running in the background is stopped when it ends, so a leftover cannot hold the step open. On Windows a child
that outlives the step's main process can keep its output open until it exits. Every output line is written to
`<state dir>/pipelines/runs/<project>/<id>-<time>.jsonl` with secrets and identifiers redacted, together with what
started the run (`cli`, `portal` or `schedule`) and how long each step took.

Each step's process gets `AMAUTA_PIPELINE` (the id), `AMAUTA_PIPELINE_TRIGGER` (`cli`, `portal` or `schedule`) and
`AMAUTA_PIPELINE_STEP` (its number), plus `AMAUTA_PIPELINE_MODE`. Steps inherit the environment of whoever started the
run (the terminal, the portal, the scheduler), with your own `PYTHONPATH`: amauta's module folder is removed. A script
can use these variables, for example to send its mail only on a scheduled run and
skip it when you try a step from the portal:

```python
import os
if os.environ.get("AMAUTA_PIPELINE_TRIGGER") == "schedule":
    send_report()  # your own code: amauta sends nothing
```

Dates in a subject or a file name ("cut-off yesterday") are your script's to compute; amauta has no placeholders.

Redaction is line by line through the detector catalog, plus a private key block from its BEGIN line to its END
line. A secret printed in pieces, or split across lines another way, can get through: print counts and timings, not
values. A `notebook` step's `.run.ipynb` keeps the cells' outputs unredacted, inside the project.

## In the portal

Projects > Pipelines lists every known project that defines pipelines. A summary line counts what needs attention
(failed last time, running, a missed scheduled run); the home page shows the same line. Category pills and a search
narrow the cards. Each card shows:

- the steps as a flow row, each with its kind, its last duration, its mark (✓ ok, ✗ failed, ⏱ timed out,
  ■ cancelled, – skipped) and **Only this**;
- the declared schedule and its state, the last run (result, time, duration, what started it), the line where it
  failed, and the files it wrote;
- the recent runs as marks, oldest first: a mark replays that run in the console;
- **Run** (asks first), and **Check**, which reports what would stop a run without running anything.

A run starts as a separate process (it keeps going if the window closes); its output arrives in the console as it
happens, with a timer against the usual duration. Error lines are marked; the console can jump to the first error,
show one step's lines, follow the output, copy and clear. When a run ends a notice appears; if the tab is in the
background its title is marked, and a desktop notice is shown once you allow it (**Desktop notices**).

A project must be trusted first (`amauta check trust`), because a run executes its code. Trust records the hash of
`.amauta/pipelines.json`: after any change to that file (yours or a `git pull`), review it and run `amauta check trust`
again before the portal runs it. The page sends only the
project, the pipeline id, and the step number for **Only this** or the mode, never a command. The steps are drawn
by levels: steps in one column may run side by side. A pipeline with modes has a mode picker; steps outside the
chosen mode are struck through.

## On a schedule

amauta does not schedule anything: your operating system does. Declare when a pipeline should run, and
`schedule-hint` prints the entry for your system's scheduler:

```json
{ "id": "weekly-sales", "schedule": { "at": "07:30", "days": ["mon", "thu"] }, "steps": [ ... ] }
```

| `schedule` | Runs |
| --- | --- |
| `{"at": "07:30"}` | every day at 07:30 |
| `{"at": "07:30", "days": ["mon", "thu"]}` | on those weekdays |
| `{"at": "06:00", "day_of_month": 1}` | once a month (1 to 28, so every month has the day) |
| `{"every_minutes": 30}` | every 5, 10, 15, 20, 30 minutes or 1, 2, 3, 4, 6, 8, 12, 24 hours |

`schedule` may also be a list, each entry with the `mode` it runs in (see the churn example above).
`amauta pipeline schedule-hint <id> [--os windows|linux|darwin]` prints one entry per schedule (or one for `--at HH:MM
[--day mon]` when you give them):

- Windows: a `schtasks /Create ...` line to run once in a terminal (Task Scheduler then shows the task).
- Linux: a crontab line for `crontab -e`, with this terminal's `PATH` (cron's own is minimal).
- macOS: a launchd agent to save under `~/Library/LaunchAgents/` and `launchctl load`, with this `PATH` too.

Each entry runs `amauta pipeline run <id> --trigger schedule [--mode M] --cwd <project>`. Run `schedule-hint` from the
terminal where `python3`, `Rscript` or `jupyter` resolve to the ones your steps need. A scheduled run is the same as one
from the terminal: its output goes to the events file and the portal shows it. Because the run says it was
scheduled, the portal compares it with the declared schedule: a card says **no scheduled run yet** (the entry may not
be registered) or **a scheduled run did not happen** (the machine was off, or the task was removed), with 30 minutes
of grace for a late start, per schedule and its mode, in local wall time (a daylight-saving change does not count).

The newest 50 runs of each pipeline are kept; older events files are removed when a new run starts.

## Limits

- Steps run with your permissions and inherit the starting environment, keys included: amauta does not isolate them.
- The portal's token keeps other web pages out; programs on your own computer can read it from the portal page.
- On Windows, a child process that outlives its step can hold the step's output open (see above).
- If the runner itself is killed outright (SIGKILL, a crash), the step running at that moment keeps running on its
  own; the run reads as abandoned and the next run may overlap with it. Stop a run with Cancel, Ctrl+C or SIGTERM.
