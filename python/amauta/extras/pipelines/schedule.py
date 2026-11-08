"""Schedule hints (plan S1c, ADR 0010): the entry the operating system's own scheduler needs to run a pipeline at a
time of day, daily or on one weekday. amauta registers nothing: the user pastes the entry into Task Scheduler
(`schtasks`), their crontab or a launchd agent. Each entry runs `node <amauta> pipeline run <id> --cwd <project>`.
"""

import re
import shutil
from pathlib import Path
from xml.sax.saxutils import escape

from . import config

DAYS = ("sun", "mon", "tue", "wed", "thu", "fri", "sat")
BIN = Path(__file__).resolve().parents[4] / "bin" / "amauta.js"


def _sh(arg):
    return "'" + str(arg).replace("'", "'\\''") + "'"


def _time(at):
    m = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", at or "")
    if not m:
        raise ValueError(f"--at must be HH:MM (24 h): {at!r}")
    return int(m.group(1)), int(m.group(2))


def hint(system, repo, pipeline_id, at, day, node=None, bin_=None):
    if pipeline_id not in [p["id"] for p in config.load(repo)]:
        raise config.ConfigError(f"no pipeline {pipeline_id!r} in {config.FILE}")
    hour, minute = _time(at)
    if day is not None and day.lower()[:3] not in DAYS:
        raise ValueError(f"--day must be one of {', '.join(DAYS)}")
    dow = DAYS.index(day.lower()[:3]) if day else None
    node, bin_ = node or shutil.which("node") or "node", bin_ or str(BIN)
    name, repo = f"amauta {pipeline_id}", str(repo)
    if system == "windows":
        when = f"/SC WEEKLY /D {DAYS[dow].upper()}" if dow is not None else "/SC DAILY"
        run = f'\\"{node}\\" \\"{bin_}\\" pipeline run {pipeline_id} --trigger schedule --cwd \\"{repo}\\"'
        return ("# Task Scheduler: run once in a terminal (schtasks /Delete /TN \"amauta ...\" removes it)\n"
                f'schtasks /Create /TN "{name}" {when} /ST {hour:02d}:{minute:02d} /TR "{run}"')
    if system == "darwin":
        label = f"local.amauta.{pipeline_id}"
        argv = (node, bin_, "pipeline", "run", pipeline_id, "--trigger", "schedule", "--cwd", repo)
        args = "".join(f"<string>{escape(a)}</string>" for a in argv)
        cal = f"<key>Hour</key><integer>{hour}</integer><key>Minute</key><integer>{minute}</integer>"
        cal += f"<key>Weekday</key><integer>{dow}</integer>" if dow is not None else ""
        plist = (f'<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>{label}</string>'
                 f"<key>ProgramArguments</key><array>{args}</array><key>StartCalendarInterval</key><dict>{cal}</dict></dict></plist>")
        return (f"# launchd: save as ~/Library/LaunchAgents/{label}.plist, then: launchctl load ~/Library/LaunchAgents/{label}.plist\n"
                + plist)
    return ("# cron: add with `crontab -e` (runs while you are logged in or the machine is on)\n"
            f"{minute} {hour} * * {dow if dow is not None else '*'} "
            f"{_sh(node)} {_sh(bin_)} pipeline run {pipeline_id} --trigger schedule --cwd {_sh(repo)}")
