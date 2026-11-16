"""Where a session ran: its transcript (a Claude Code project file or a Codex rollout) and the cwd it records, read-only.

The transcript folders are listed at most once per TTL (a dict lookup per session instead of a folder walk per request);
a cwd once found never changes, so it is kept for the life of the portal. Codex rollouts are read only up to their first
line (session_meta: the session id and its cwd); nothing else in them is parsed."""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

TTL = 15.0
META_BYTES = 1 << 20  # a session_meta line carries the base instructions: allow a large first line, never more
MAX_CACHED = 50_000
_lock = threading.Lock()


def _state(portal):
    st = getattr(portal, "_sesswhere", None)
    if st is None:
        st = portal._sesswhere = {"at": None, "claude": {}, "codex": {}, "rollouts": {}, "cwd": {}}
    return st


def _claude_files(root: Path) -> dict:
    out = {}
    if not root.is_dir():
        return out
    for folder in sorted(root.iterdir()):
        if folder.is_dir() and not folder.is_symlink():
            for f in folder.glob("*.jsonl"):
                if f.is_file() and not f.is_symlink():
                    out.setdefault(f.stem, f)
    return out


def _rollout_meta(path: Path):
    """(session id, cwd) from a rollout's first line; (None, None) when it is not a session_meta line."""
    try:
        with path.open("rb") as fh:
            line = json.loads(fh.readline(META_BYTES).decode("utf-8", "replace"))
    except (OSError, ValueError):
        return None, None
    payload = line.get("payload") if isinstance(line, dict) and line.get("type") == "session_meta" else None
    if not isinstance(payload, dict):
        return None, None
    sid = payload.get("session_id") or payload.get("id")
    cwd = payload.get("cwd")
    return (sid if isinstance(sid, str) and sid else None), (cwd[:1024] if isinstance(cwd, str) and cwd else None)


def _codex_files(st, home) -> dict:
    root = Path(home) / "sessions" if home else None
    if root is None or not root.is_dir():
        return {}
    out = {}
    for f in root.rglob("*.jsonl"):
        if f.is_file() and not f.is_symlink():
            if f not in st["rollouts"]:  # a rollout's first line never changes: read each file once
                st["rollouts"][f] = _rollout_meta(f)
            sid, cwd = st["rollouts"][f]
            if sid:
                out.setdefault(sid, (f, cwd))
    return out


def _refresh(portal, st):
    if st["at"] is not None and time.monotonic() - st["at"] < TTL:
        return
    st["claude"] = _claude_files(Path(portal.cfg.claude_home) / "projects")
    st["codex"] = _codex_files(st, portal.cfg.codex_home)
    st["at"] = time.monotonic()


def claude_transcript(portal, session_id):
    """The Claude Code transcript of a session id (a plain file in a plain project folder), or None."""
    with _lock:
        st = _state(portal)
        _refresh(portal, st)
        return st["claude"].get(str(session_id))


def cwd(portal, session_id):
    """The session's working directory from its Claude transcript or Codex rollout; None when neither is found."""
    sid = str(session_id)
    with _lock:
        st = _state(portal)
        if sid in st["cwd"]:
            return st["cwd"][sid]
        _refresh(portal, st)
        found = st["codex"].get(sid, (None, None))[1]
    if found is None and claude_transcript(portal, sid) is not None:
        from . import wikisess  # wikisess reads the transcript head with its own rules
        found = wikisess.session_info(portal, sid).get("cwd")
    if found:
        with _lock:
            if len(st["cwd"]) >= MAX_CACHED:
                st["cwd"].clear()
            st["cwd"][sid] = found
    return found
