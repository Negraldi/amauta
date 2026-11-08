# 0010 Pipelines: run a project's processes from the portal, with their output live

Status: accepted 2026-11-08 (user decisions on the orchestrator review).

## Context

The user runs recurring data processes (queries, workbook refreshes, scripts, notebooks, mail) from a local
orchestrator with a web page and a live console. The plan kept `harness-pipelines` as a sibling project; the user wants
the orchestrator inside amauta, running processes and showing their command output in its own UI.

## Decision

- A Pipelines page in the portal (a tab of Projects), implemented as an extra (`python/amauta/extras/pipelines/`,
  ADR 0009): deleting the folder removes the feature.
- Pipelines are defined per project in `.amauta/pipelines.json`: named steps of type `command` (an argv list, never a
  shell string), `python`, `r` or `notebook`. Database, workbook and mail steps are the project's own scripts; amauta
  stays stdlib-only and portable.
- `amauta pipeline list|run|status|schedule-hint` works without the portal. A run writes JSON-lines events (step start,
  each output line, step end, run end) under `<state dir>/pipelines/runs/`; secret-like values in output are redacted.
- The portal starts a run as a separate process (it survives the window closing) and polls its events: cards, a step
  diagram and a live console. The browser sends a project and a pipeline id, never a command. Running from the portal
  needs the project to be trusted (`amauta check trust`), because it executes project code.
- Scheduling is left to the operating system (Task Scheduler, cron, launchd): `schedule-hint` prints the entry that
  runs `amauta pipeline run`; amauta registers nothing.

## Rejected

Built-in SQL Server, Excel and Outlook steps (Windows-only dependencies); a scheduler inside amauta (needs a process
always running); commands sent from the browser.

## Consequences

The sibling `harness-pipelines` is no longer needed for running processes. Pipelines run with the user's permissions;
the trust step and the confirmation before a portal run are the friction, not isolation.
