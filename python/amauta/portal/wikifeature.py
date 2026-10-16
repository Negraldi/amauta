"""ODD feature pages: task progress and the commits a document mentions. Hashes found in the text are resolved against the feature's own repository
with `git log -1` (argument list, no shell, validated hex, short timeout); anything that does not resolve stays plain text in the document."""
from __future__ import annotations

import os
import re
import subprocess
import time

MAX_HASHES = 60
GIT_TIMEOUT = 5
BUDGET = 10.0
HEX = re.compile(r"^[0-9a-f]{7,12}$")
_TICKED = re.compile(r"`([0-9a-f]{7,12})`")
_PLAIN = re.compile(r"(?<![\w`-])([0-9a-f]{7,12})(?![\w`-])")
_CACHE: dict = {}
_FORMAT = "--format=%H%x00%s%x00%cI"


def extract_hashes(text):
    """Short hashes in order of first appearance. In backticks any 7-12 hex string counts; in plain text it must mix digits and letters."""
    found = []
    for m in re.finditer(_TICKED.pattern + "|" + _PLAIN.pattern, text or ""):
        h = m.group(1) or m.group(2)
        if m.group(1) is None and not (re.search(r"\d", h) and re.search(r"[a-f]", h)):
            continue
        if h not in found:
            found.append(h)
            if len(found) >= MAX_HASHES:
                break
    return found


def resolve(repo, short):
    """{hash, full, subject, date} for a commit of `repo`, or None (not hex, not a git repo, unknown, ambiguous, git missing or too slow)."""
    if not isinstance(short, str) or not HEX.match(short):
        return None
    key = (str(repo), short)
    if key in _CACHE:
        return _CACHE[key]
    if not (repo / ".git").exists():
        return None
    try:
        out = subprocess.run(["git", "-C", str(repo), "log", "-1", _FORMAT, short, "--"], capture_output=True, text=True, timeout=GIT_TIMEOUT,
                             env={**os.environ, "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0"}, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    parts = out.stdout.rstrip("\n").split("\x00")
    if out.returncode != 0 or len(parts) != 3 or not parts[0].startswith(short):
        return None
    found = {"hash": short, "full": parts[0], "subject": parts[1][:200], "date": parts[2]}
    _CACHE[key] = found
    return found


def commits(repo, text):
    deadline = time.monotonic() + BUDGET
    out = []
    for short in extract_hashes(text):
        if time.monotonic() > deadline:
            break
        c = resolve(repo, short)
        if c:
            out.append(c)
    return out


def progress(tasks):
    done = sum(1 for d, _ in tasks if d)
    return {"done": done, "total": len(tasks), "percent": round(100 * done / len(tasks)) if tasks else 0}
