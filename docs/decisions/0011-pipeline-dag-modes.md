# 0011 Pipelines as a DAG, with reuse, modes and one run at a time

Status: accepted 2026-11-08 (user decisions after an independent review). Refines 0010.

## Context

ADR 0010 made a pipeline a list of steps run in order. The user's processes need more: two steps that do not depend
on each other should run side by side; a cleaning step or a whole sub-process is shared by several pipelines; a model
pipeline runs in a mode (train, train and predict, predict only) that turns steps on or off, often on its own schedule.
An independent review of the 0.6 code also found that "one run at a time" was a race, that a stopped runner left a run
"running" forever, that a background child defeated the timeout, and that trust did not cover what a pipeline runs.

## Decision

- A step may have an `id` and `needs` (ids of steps it waits for). Without `needs` a step needs the step before it, so
  a 0.6 file keeps its meaning. Ready steps run in parallel up to `max_parallel` (default 4). A failed, timed-out or
  cancelled step skips only the steps that need it; independent branches finish and the run ends failed.
- Reuse, both ways: `blocks` at the top of the file are step templates a step takes with `use` (its own fields win);
  a step of type `pipeline` is replaced at load by that pipeline's steps (ids prefixed with the step's id). Loops and
  unknown references are refused when the file is read.
- `modes` and `default_mode` on a pipeline; a step lists the modes it runs in (none: all). A step outside the run's
  mode is skipped and counts as done for the steps that need it. `schedule` may be a list, each entry with its mode;
  `schedule-hint` prints one OS entry per schedule and the portal checks each one against its mode's last run.
- One run of a pipeline at a time: a lock file taken atomically by whoever starts the run (portal, CLI, a scheduled
  run) and adopted by the runner, stale when its process is gone. A run without its end whose runner is gone reads as
  abandoned. The runner ends its run on SIGTERM and SIGINT.
- A step owns its processes: on POSIX its leftovers are stopped when it ends; timeout and cancel hold until its output
  closes. Scripts and notebooks resolve from the project root and may not lead outside it (symlinks included).
- `amauta check trust` records the sha256 of `.amauta/pipelines.json`; the portal runs pipelines only while the file is
  the one trusted. The CLI and the OS scheduler run what the user asked for and need no trust.

## Rejected

A scheduler or a queue inside amauta (still the OS's job); retries across runs; parallel runs of one pipeline;
isolating steps (containers, sandboxes): steps run with the user's permissions and environment, documented.

## Consequences

Event lines and step ends carry the step `id`; `run-start` carries the graph (`ids`, `needs`) and the `mode`. The
portal shows the flow by levels and a mode picker. Trusting a project again is needed after every change of its
pipelines.json, and once after upgrading to this version (the hash was not recorded before). On Windows a step's
child that outlives it can still hold its output open (no process groups without job objects); this is documented.
