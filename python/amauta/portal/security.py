"""The portal Security page (plan D14, ADR 0006 and 0007): what protects this machine's work, in counts and names.

Protections (the memory guard is always on; the privacy hook and the checks follow state.json), the projects trusted
for code-executing checkers, which checkers are installed, the organization profiles and their selections, and how
many values the memory guard replaced, per kind. Never a value, a key or a row. Read-only.
"""

import json
import os
import re
import shutil
import sqlite3
from pathlib import Path

CHECKERS = ("node", "bash", "tsc", "eslint", "mypy", "cargo", "gitleaks", "bandit", "semgrep")
TRUST = {"tsc", "eslint", "mypy", "cargo"}  # these execute project code: trusted projects only
PLACEHOLDER = re.compile(r"\[REDACTED_([A-Z]+)\]")


def read_json(path, default):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return data if isinstance(data, type(default)) else default
    except (OSError, ValueError):
        return default


def _redactions(db):
    counts = {}
    if not Path(db).is_file():
        return counts
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            rows = conn.execute("SELECT title || ' ' || content FROM observations WHERE deleted_at IS NULL "
                                "UNION ALL SELECT content FROM prompts").fetchall()
        finally:
            conn.close()
    except sqlite3.Error:
        return counts
    for (text,) in rows:
        for kind in PLACEHOLDER.findall(text or ""):
            counts[kind.lower()] = counts.get(kind.lower(), 0) + 1
    return counts


def report(cfg, search_path=None):
    state_dir = Path(cfg.state_dir)
    state_file = state_dir / "state.json"
    state = read_json(state_file, {})
    onoff = lambda key: "off" if state.get(key) is False else "on"  # noqa: E731
    projects = read_json(state_dir / "checks" / "trust.json", {}).get("projects", [])
    trusted = [{"name": os.path.basename(p["path"]), "path": p["path"], "since": p.get("trusted_at")}
               for p in projects if isinstance(p, dict) and isinstance(p.get("path"), str)]
    pdir = state_dir / "profiles"
    entries = sorted(p.name for p in pdir.iterdir() if p.is_dir()) if pdir.is_dir() else []
    selected = [{"project": os.path.basename(k), "profile": v} for k, v in sorted(read_json(pdir / "selection.json", {}).items())]
    path = os.environ.get("PATH", "") if search_path is None else search_path
    return {
        "protections": {"memory_guard": "on", "privacy": onoff("privacy"), "checks": onoff("checks"), "installed": state_file.is_file()},
        "trusted": trusted,
        "checkers": [{"name": n, "installed": shutil.which(n, path=path) is not None, "needs_trust": n in TRUST} for n in CHECKERS],
        "profiles": {"names": ["default", *[e for e in entries if "." not in e]], "drafts": sum(e.endswith(".draft") for e in entries),
                     "selected": selected},
        "redacted": _redactions(state_dir / "memory.db"),
    }
