"""Sibling projects (plan S1d, ADR 0001): projects beside amauta, such as a data catalog or an ETL repository, that the
portal only links and health-checks. No sibling code runs here: health is read from the sibling's folder (git, one
watched file) and from where its MCP server would be registered (Claude's .claude.json, Codex's config.toml).

portal.json `siblings`: [{"name", "path", "mcp"?, "watch"?, "max_age_days"?}] (a closed schema, at most 20). `watch` is
a file inside the sibling whose age tells how fresh it is (a catalog cut, an export); `max_age_days` makes it stale.
"""
from __future__ import annotations

import os
import re
import subprocess
import time
from pathlib import Path, PurePosixPath

MAX = 20
KEYS = {"name", "path", "mcp", "watch", "max_age_days"}
MCP_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")


def clean(items, check_path):
    """Validated sibling entries (ValueError on the first bad one). `check_path(raw)` resolves and checks a folder."""
    if not isinstance(items, list) or len(items) > MAX:
        raise ValueError(f"siblings must be a list of at most {MAX} entries")
    return [_entry(s, check_path) for s in items]


def _entry(s, check_path):
    if not isinstance(s, dict) or set(s) - KEYS or "name" not in s or "path" not in s:
        raise ValueError(f"a sibling is {{{', '.join(sorted(KEYS))}}} with name and path")
    name = s["name"]
    if not isinstance(name, str) or not name.strip() or len(name) > 60:
        raise ValueError("a sibling's name is 1 to 60 characters")
    out = {"name": name.strip(), "path": str(check_path(s["path"]))}
    if "mcp" in s:
        if not isinstance(s["mcp"], str) or not MCP_NAME.match(s["mcp"]):
            raise ValueError("mcp is the name of an MCP server (letters, digits, '.', '_', '-')")
        out["mcp"] = s["mcp"]
    if "watch" in s:
        w = s["watch"]
        parts = PurePosixPath(str(w).replace("\\", "/")).parts if isinstance(w, str) else ()
        if not parts or os.path.isabs(w) or PurePosixPath(w).is_absolute() or ".." in parts or re.match(r"^[A-Za-z]:", w):
            raise ValueError("watch is a relative path inside the sibling")
        out["watch"] = w
    if "max_age_days" in s:
        if type(s["max_age_days"]) is not int or not 1 <= s["max_age_days"] <= 366:
            raise ValueError("max_age_days is a whole number from 1 to 366")
        out["max_age_days"] = s["max_age_days"]
    return out


def _git(path):
    """{date, subject, dirty} of the sibling's repository, or None when it is not one (or git is missing)."""
    def run(*args):
        r = subprocess.run(["git", "-C", str(path), *args], capture_output=True, text=True, timeout=10)
        return r.stdout if r.returncode == 0 else None
    try:
        last = run("log", "-1", "--format=%cI%x09%s")
        status = run("status", "--porcelain")
    except (OSError, subprocess.SubprocessError):
        return None
    if not last:
        return None
    date, _, subject = last.strip().partition("\t")
    return {"date": date, "subject": subject[:120], "dirty": len([x for x in (status or "").splitlines() if x.strip()])}


def _registered(portal, name):
    """Whether an MCP server of that name is registered for Claude and for Codex (names only; specs are never read out)."""
    from .wikiharness import claude_json_path, read_json
    claude = name in (read_json(claude_json_path(portal)).get("mcpServers") or {})
    codex_home = portal.cfg.codex_home or (portal.cfg.claude_home.parent / ".codex")
    try:
        toml = (Path(codex_home) / "config.toml").read_text(encoding="utf-8")
    except OSError:
        toml = ""
    codex = bool(re.search(rf'^\[mcp_servers\.(?:"{re.escape(name)}"|{re.escape(name)})\]\s*$', toml, re.M))
    return {"name": name, "claude": claude, "codex": codex}


def _watch(path, s):
    f = Path(path) / s["watch"]
    try:
        age = int((time.time() - f.stat().st_mtime) // 86400)
    except OSError:
        return {"file": s["watch"], "state": "missing", "age_days": None}
    stale = "max_age_days" in s and age > s["max_age_days"]
    return {"file": s["watch"], "state": "stale" if stale else "ok", "age_days": age, "max_age_days": s.get("max_age_days")}


def _one(portal, s):
    path = Path(s["path"])
    out = {"name": s["name"], "path": s["path"], "exists": path.is_dir()}
    if not out["exists"]:
        return {**out, "state": "missing"}
    out["git"] = _git(path)
    out["mcp"] = _registered(portal, s["mcp"]) if "mcp" in s else None
    out["watch"] = _watch(path, s) if "watch" in s else None
    attention = (out["watch"] and out["watch"]["state"] != "ok") or (out["mcp"] and not (out["mcp"]["claude"] or out["mcp"]["codex"])) \
        or (out["git"] and out["git"]["dirty"])
    return {**out, "state": "attention" if attention else "ok"}


def health(portal):
    from .projects import read_config
    return {"siblings": [_one(portal, s) for s in read_config(portal.cfg.state_dir, portal.cfg.home)["siblings"]]}
