"""Schedules (plan S1c, ADR 0010 and 0011). amauta registers nothing: `hint` prints the entries the operating system's
own scheduler needs (Task Scheduler via `schtasks`, crontab lines, launchd agents), one per declared schedule (daily,
some weekdays, a day of the month, every N minutes, each with its mode) or one from `--at`/`--day`. Each entry runs
`node <amauta> pipeline run <id> --trigger schedule [--mode M] --cwd <project>`; cron and launchd get this PATH, since
they start programs with a minimal one.

`state` compares a schedule with the newest scheduled run of its mode, in local wall time (a clock change between the
two does not make a run look missed), so the portal can say when one did not happen.
"""

import os
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from xml.sax.saxutils import escape

from . import config
from .config import DAYS

BIN = Path(__file__).resolve().parents[4] / "bin" / "amauta.js"
GRACE = timedelta(minutes=30)  # a scheduled run may start late (the machine was asleep, the scheduler was busy)


def _sh(arg):
    return "'" + str(arg).replace("'", "'\\''") + "'"


def _resolve(repo, pipeline_id, at, day):
    """The schedules to print: the pipeline's own, or one from --at/--day (07:00 daily when it declares none)."""
    pipeline = next((p for p in config.load(repo) if p["id"] == pipeline_id), None)
    if pipeline is None:
        raise config.ConfigError(f"no pipeline {pipeline_id!r} in {config.FILE}")
    if at is None and day is None and pipeline["schedules"]:
        return pipeline["schedules"]
    if day is not None and day.lower()[:3] not in DAYS:
        raise ValueError(f"--day must be one of {', '.join(DAYS)}")
    config.parse_time(at or "07:00")
    sched = {"at": at or "07:00"}
    return [{**sched, "days": [day.lower()[:3]]} if day else sched]


def _windows(sched, run, name):
    n = sched.get("every_minutes")
    if n:  # /SC MINUTE takes 1 to 1439 only
        when = f"/SC MINUTE /MO {n}" if n < 60 else ("/SC DAILY /ST 00:00" if n == 1440 else f"/SC HOURLY /MO {n // 60}")
    elif "days" in sched:
        when = f"/SC WEEKLY /D {','.join(d.upper() for d in sched['days'])} /ST {sched['at']}"
    elif "day_of_month" in sched:
        when = f"/SC MONTHLY /D {sched['day_of_month']} /ST {sched['at']}"
    else:
        when = f"/SC DAILY /ST {sched['at']}"
    return f'schtasks /Create /TN "{name}" {when} /TR "{run}"'


def _cron_when(sched):
    n = sched.get("every_minutes")
    if n:
        return f"*/{n} * * * *" if n < 60 else ("0 0 * * *" if n == 1440 else f"0 */{n // 60} * * *")
    hour, minute = config.parse_time(sched["at"])
    dom = sched.get("day_of_month", "*")
    dow = ",".join(str(DAYS.index(d)) for d in sched["days"]) if "days" in sched else "*"
    return f"{minute} {hour} {dom} * {dow}"


def _launchd(sched, argv, label):
    args = "".join(f"<string>{escape(a)}</string>" for a in argv)
    env = f"<key>EnvironmentVariables</key><dict><key>PATH</key><string>{escape(os.environ.get('PATH', ''))}</string></dict>"
    if "every_minutes" in sched:
        when = f"<key>StartInterval</key><integer>{sched['every_minutes'] * 60}</integer>"
    else:
        hour, minute = config.parse_time(sched["at"])
        base = f"<key>Hour</key><integer>{hour}</integer><key>Minute</key><integer>{minute}</integer>"
        if "days" in sched:
            dicts = "".join(f"<dict>{base}<key>Weekday</key><integer>{DAYS.index(d)}</integer></dict>" for d in sched["days"])
            when = f"<key>StartCalendarInterval</key><array>{dicts}</array>"
        else:
            extra = f"<key>Day</key><integer>{sched['day_of_month']}</integer>" if "day_of_month" in sched else ""
            when = f"<key>StartCalendarInterval</key><dict>{base}{extra}</dict>"
    plist = (f'<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>{label}</string>'
             f"<key>ProgramArguments</key><array>{args}</array>{env}{when}</dict></plist>")
    return f"# launchd: save as ~/Library/LaunchAgents/{label}.plist, then: launchctl load ~/Library/LaunchAgents/{label}.plist\n" + plist


def _entry(system, sched, repo, pipeline_id, node, bin_):
    mode = sched.get("mode")
    tail = ["--trigger", "schedule", *(["--mode", mode] if mode else [])]
    name = f"amauta {pipeline_id}" + (f" {mode}" if mode else "")
    if system == "windows":
        run = f'\\"{node}\\" \\"{bin_}\\" pipeline run {pipeline_id} {" ".join(tail)} --cwd \\"{repo}\\"'
        return _windows(sched, run, name)
    if system == "darwin":
        label = f"local.amauta.{pipeline_id}" + (f".{mode}" if mode else "")
        plist = _launchd(sched, (node, bin_, "pipeline", "run", pipeline_id, *tail, "--cwd", repo), label)
        return f"# save as ~/Library/LaunchAgents/{label}.plist, then: launchctl load ~/Library/LaunchAgents/{label}.plist\n" + plist
    line = (f"env PATH={_sh(os.environ.get('PATH', ''))} {_sh(node)} {_sh(bin_)} pipeline run {pipeline_id} "
            f"{' '.join(tail)} --cwd {_sh(repo)}")
    return f"{_cron_when(sched)} {line.replace('%', chr(92) + '%')}"  # cron reads a bare % as a newline


HEADS = {"windows": "# Task Scheduler: run each line once in a terminal (schtasks /Delete /TN \"amauta ...\" removes it)",
         "darwin": "# launchd: one agent per schedule",
         "linux": "# cron: add with `crontab -e` (runs while you are logged in or the machine is on)"}


def hint(system, repo, pipeline_id, at=None, day=None, node=None, bin_=None):
    scheds = _resolve(repo, pipeline_id, at, day)
    node, bin_, repo = node or shutil.which("node") or "node", bin_ or str(BIN), str(repo)
    head = HEADS.get(system, HEADS["linux"])
    return "\n".join([head, *(_entry(system, sc, repo, pipeline_id, node, bin_) for sc in scheds)])


def expected_before(sched, now):
    """The newest moment at or before `now` (an aware datetime, in the schedule's time zone) when a run was due."""
    if "every_minutes" in sched:
        return now - timedelta(minutes=sched["every_minutes"])
    hour, minute = config.parse_time(sched["at"])
    for back in range(0, 62):
        day = (now - timedelta(days=back)).replace(hour=hour, minute=minute, second=0, microsecond=0)
        if day > now:
            continue
        if "days" in sched and DAYS[(day.weekday() + 1) % 7] not in sched["days"]:
            continue
        if "day_of_month" in sched and day.day != sched["day_of_month"]:
            continue
        return day
    return None


def _wall(moment):
    """Local wall-clock time without a zone: an aware moment is converted with the zone rules of its own date."""
    return moment.astimezone().replace(tzinfo=None) if moment.tzinfo else moment


def state(sched, last_scheduled, now):
    """"ok", "missed" (a due run did not start) or "never" (no scheduled run yet: the OS entry may not be registered)."""
    if last_scheduled is None:
        return "never"
    last, now = _wall(datetime.fromisoformat(last_scheduled)), _wall(now)
    if "every_minutes" in sched:
        return "ok" if now - last <= timedelta(minutes=sched["every_minutes"]) + GRACE else "missed"
    due = expected_before(sched, now - GRACE)
    return "ok" if due is None or last >= due - timedelta(minutes=5) else "missed"
