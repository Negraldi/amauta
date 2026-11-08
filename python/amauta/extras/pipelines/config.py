"""`.amauta/pipelines.json`: the pipelines a project defines (plan S1a, ADR 0010).

{"pipelines": [{"id", "name", "description", "steps": [{"name", "type", ...}]}]}. Step types: `command` (`argv`, a list,
never a shell string), `python` and `r` (`script`, `args`, optional `interpreter`), `notebook` (`path`). Paths are
relative to the project and stay inside it. `timeout` (seconds, default 3600), `enabled` (default true) and `cwd` are
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


class ConfigError(ValueError):
    pass


def _inside(rel, what):
    text = rel.replace("\\", "/") if isinstance(rel, str) else ""
    absolute = os.path.isabs(text) or PurePosixPath(text).is_absolute() or bool(re.match(r"^[A-Za-z]:", text))
    if not isinstance(rel, str) or not rel or absolute or ".." in re.split(r"[\\/]", rel):
        raise ConfigError(f"{what} must be a relative path inside the project: {str(rel)[:80]!r}")
    return rel


def _step(i, s):
    if not isinstance(s, dict) or s.get("type") not in TYPES:
        raise ConfigError(f"step {i + 1}: type must be one of {', '.join(sorted(TYPES))}")
    out = {"name": str(s.get("name") or f"Step {i + 1}")[:80], "type": s["type"], "enabled": s.get("enabled", True) is not False}
    timeout = s.get("timeout", 3600)
    if not isinstance(timeout, int) or not 0 < timeout <= MAX_TIMEOUT:
        raise ConfigError(f"step {i + 1}: timeout must be 1 to {MAX_TIMEOUT} seconds")
    out["timeout"] = timeout
    out["cwd"] = _inside(s["cwd"], f"step {i + 1}: cwd") if "cwd" in s else "."
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
