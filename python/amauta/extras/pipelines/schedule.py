"""Schedules (plan S1c, ADR 0010). amauta registers nothing: `hint` prints the entry the operating system's own
scheduler needs (Task Scheduler via `schtasks`, a crontab line, a launchd agent), built from the pipeline's declared
`schedule` (daily, some weekdays, a day of the month, every N minutes) or from `--at`/`--day`. Each entry runs
`node <amauta> pipeline run <id> --trigger schedule --cwd <project>`.

`state` compares the declared schedule with the newest scheduled run, so the portal can say when one did not happen.
"""

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
    pipeline = next((p for p in config.load(repo) if p["id"] == pipeline_id), None)
    if pipeline is None:
        raise config.ConfigError(f"no pipeline {pipeline_id!r} in {config.FILE}")
    if at is None and day is None and pipeline["schedule"]:
        return pipeline["schedule"]
    if day is not None and day.lower()[:3] not in DAYS:
        raise ValueError(f"--day must be one of {', '.join(DAYS)}")
    config.parse_time(at or "07:00")
    sched = {"at": at or "07:00"}
    return {**sched, "days": [day.lower()[:3]]} if day else sched


def _windows(sched, run, name):
    if "every_minutes" in sched:
        when = f"/SC MINUTE /MO {sched['every_minutes']}"
    elif "days" in sched:
        when = f"/SC WEEKLY /D {','.join(d.upper() for d in sched['days'])} /ST {sched['at']}"
    elif "day_of_month" in sched:
        when = f"/SC MONTHLY /D {sched['day_of_month']} /ST {sched['at']}"
    else:
        when = f"/SC DAILY /ST {sched['at']}"
    return ("# Task Scheduler: run once in a terminal (schtasks /Delete /TN \"amauta ...\" removes it)\n"
            f'schtasks /Create /TN "{name}" {when} /TR "{run}"')


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
             f"<key>ProgramArguments</key><array>{args}</array>{when}</dict></plist>")
    return f"# launchd: save as ~/Library/LaunchAgents/{label}.plist, then: launchctl load ~/Library/LaunchAgents/{label}.plist\n" + plist


def hint(system, repo, pipeline_id, at=None, day=None, node=None, bin_=None):
    sched = _resolve(repo, pipeline_id, at, day)
    node, bin_, repo = node or shutil.which("node") or "node", bin_ or str(BIN), str(repo)
    if system == "windows":
        run = f'\\"{node}\\" \\"{bin_}\\" pipeline run {pipeline_id} --trigger schedule --cwd \\"{repo}\\"'
        return _windows(sched, run, f"amauta {pipeline_id}")
    if system == "darwin":
        argv = (node, bin_, "pipeline", "run", pipeline_id, "--trigger", "schedule", "--cwd", repo)
        return _launchd(sched, argv, f"local.amauta.{pipeline_id}")
    return ("# cron: add with `crontab -e` (runs while you are logged in or the machine is on)\n"
            f"{_cron_when(sched)} {_sh(node)} {_sh(bin_)} pipeline run {pipeline_id} --trigger schedule --cwd {_sh(repo)}")


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


def state(sched, last_scheduled, now):
    """"ok", "missed" (a due run did not start) or "never" (no scheduled run yet: the OS entry may not be registered)."""
    if last_scheduled is None:
        return "never"
    last = datetime.fromisoformat(last_scheduled)
    if "every_minutes" in sched:
        return "ok" if now - last <= timedelta(minutes=sched["every_minutes"]) + GRACE else "missed"
    due = expected_before(sched, now - GRACE)
    return "ok" if due is None or last >= due - timedelta(minutes=5) else "missed"
