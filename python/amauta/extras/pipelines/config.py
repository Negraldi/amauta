"""`.amauta/pipelines.json`: the pipelines a project defines (plan S1a, ADR 0010).

{"pipelines": [{"id", "name", "description", "category", "schedule",
  "steps": [{"name", "type", ...}]}]}. Step types: `command` (`argv`, a list,
never a shell string), `python` and `r` (`script`, `args`, optional `interpreter`), `notebook` (`path`). Paths are
relative to the project and stay inside it. `timeout` (seconds, default 3600), `enabled` (default true), `cwd`,
`retries` (0-5, default 0) with `retry_delay` (seconds, default 30) and `outputs` (files the step must refresh) are
optional. A definition that holds a secret-like value is refused: credentials belong to the scripts' own config.
"""

import json
import os
import re
from pathlib import Path, PurePosixPath

from ...detectors import secretlike

FILE = Path(".amauta") / "pipelines.json"
ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,60}$")
TYPES = {"command", "python", "r", "notebook"}
MAX_TIMEOUT = 24 * 3600
DAYS = ("sun", "mon", "tue", "wed", "thu", "fri", "sat")
EVERY = (5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720, 1440)  # each fits cron, Task Scheduler and launchd
MAX_RETRIES = 5
MAX_RETRY_DELAY = 3600


class ConfigError(ValueError):
    pass


def _inside(rel, what):
    text = rel.replace("\\", "/") if isinstance(rel, str) else ""
    absolute = os.path.isabs(text) or PurePosixPath(text).is_absolute() or bool(re.match(r"^[A-Za-z]:", text))
    if not isinstance(rel, str) or not rel or absolute or ".." in re.split(r"[\\/]", rel):
        raise ConfigError(f"{what} must be a relative path inside the project: {str(rel)[:80]!r}")
    return rel


def _int(s, key, default, low, high, i):
    value = s.get(key, default)
    if type(value) is not int or not low <= value <= high:
        raise ConfigError(f"step {i + 1}: {key} must be a whole number from {low} to {high}")
    return value


def _step(i, s):
    if not isinstance(s, dict) or s.get("type") not in TYPES:
        raise ConfigError(f"step {i + 1}: type must be one of {', '.join(sorted(TYPES))}")
    out = {"name": str(s.get("name") or f"Step {i + 1}")[:80], "type": s["type"], "enabled": s.get("enabled", True) is not False}
    timeout = s.get("timeout", 3600)
    if not isinstance(timeout, int) or not 0 < timeout <= MAX_TIMEOUT:
        raise ConfigError(f"step {i + 1}: timeout must be 1 to {MAX_TIMEOUT} seconds")
    out["timeout"] = timeout
    out["cwd"] = _inside(s["cwd"], f"step {i + 1}: cwd") if "cwd" in s else "."
    out["retries"] = _int(s, "retries", 0, 0, MAX_RETRIES, i)
    out["retry_delay"] = _int(s, "retry_delay", 30, 0, MAX_RETRY_DELAY, i)
    outputs = s.get("outputs", [])
    if not isinstance(outputs, list):
        raise ConfigError(f"step {i + 1}: outputs must be a list of paths")
    out["outputs"] = [_inside(o, f"step {i + 1}: output") for o in outputs]
    if s["type"] == "command":
        argv = s.get("argv")
        if not isinstance(argv, list) or not argv or not all(isinstance(a, str) and a for a in argv):
            raise ConfigError(f"step {i + 1}: argv must be a non-empty list of strings (no shell)")
        out["argv"] = argv
    elif s["type"] in ("python", "r"):
        out["script"] = _inside(s.get("script"), f"step {i + 1}: script")
        out["args"] = [str(a) for a in s.get("args", []) if isinstance(a, (str, int, float))]
        if isinstance(s.get("interpreter"), str):
            out["interpreter"] = s["interpreter"]
    else:
        out["path"] = _inside(s.get("path"), f"step {i + 1}: path")
    return out


def parse_time(at):
    m = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", at if isinstance(at, str) else "")
    if not m:
        raise ValueError(f"a time must be HH:MM (24 h): {str(at)[:20]!r}")
    return int(m.group(1)), int(m.group(2))


def _schedule(pid, sched):
    """Daily {at}, weekly {at, days}, monthly {at, day_of_month} or {every_minutes}: what the OS scheduler should do."""
    if not isinstance(sched, dict) or not sched or set(sched) - {"at", "days", "day_of_month", "every_minutes"}:
        raise ConfigError(f"{pid}: schedule must be {{at, days?}}, {{at, day_of_month}} or {{every_minutes}}")
    if "every_minutes" in sched:
        if len(sched) > 1 or sched["every_minutes"] not in EVERY or type(sched["every_minutes"]) is not int:
            raise ConfigError(f"{pid}: every_minutes stands alone and is one of {', '.join(map(str, EVERY))}")
        return {"every_minutes": sched["every_minutes"]}
    try:
        hour, minute = parse_time(sched.get("at"))
    except ValueError as e:
        raise ConfigError(f"{pid}: schedule {e}") from None
    out = {"at": f"{hour:02d}:{minute:02d}"}
    days, dom = sched.get("days"), sched.get("day_of_month")
    if days is not None and dom is not None:
        raise ConfigError(f"{pid}: a schedule has days or day_of_month, not both")
    if days is not None:
        if not isinstance(days, list) or not days or not all(isinstance(d, str) and d.lower()[:3] in DAYS for d in days):
            raise ConfigError(f"{pid}: schedule days must be a list of {', '.join(DAYS)}")
        out["days"] = sorted({d.lower()[:3] for d in days}, key=DAYS.index)
    if dom is not None:
        if type(dom) is not int or not 1 <= dom <= 28:
            raise ConfigError(f"{pid}: day_of_month must be 1 to 28 (every month has it)")
        out["day_of_month"] = dom
    return out


def parse(data):
    items = data.get("pipelines") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise ConfigError('the file must be {"pipelines": [...]}')
    seen, out = set(), []
    for p in items:
        if not isinstance(p, dict) or not ID.match(str(p.get("id", ""))):
            raise ConfigError("every pipeline needs an id: lowercase letters, digits, '-' and '_'")
        if p["id"] in seen:
            raise ConfigError(f"duplicate pipeline id: {p['id']}")
        seen.add(p["id"])
        steps = p.get("steps")
        if not isinstance(steps, list) or not steps:
            raise ConfigError(f"{p['id']}: steps must be a non-empty list")
        out.append({"id": p["id"], "name": str(p.get("name") or p["id"])[:120], "description": str(p.get("description") or "")[:500],
                    "category": str(p.get("category") or "")[:40],
                    "schedule": _schedule(p["id"], p["schedule"]) if "schedule" in p else None,
                    "steps": [_step(i, s) for i, s in enumerate(steps)]})
    return out


def load(repo):
    f = Path(repo) / FILE
    if not f.is_file():
        return []
    text = f.read_text(encoding="utf-8")
    if secretlike.contains_secret(text):
        raise ConfigError(f"{FILE} holds a secret-like value; keep credentials in the scripts' own configuration")
    try:
        data = json.loads(text)
    except ValueError as e:
        raise ConfigError(f"{FILE} is not valid JSON: {e}") from None
    return parse(data)
