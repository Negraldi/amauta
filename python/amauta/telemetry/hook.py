"""Claude Code hook entrypoint: record one event row, never fail, never print."""
from __future__ import annotations

import json
import os
import sys

from .. import paths
from ..memory import store as mstore
from . import housekeeping

# The hook must not slow Claude Code down: give up quickly when the database is locked.
BUSY_MS = 500


def _text(value, limit):
    return value[:limit] if isinstance(value, str) and value else None


def _ok(payload) -> int:
    response = payload.get("tool_response")
    if isinstance(response, dict) and (response.get("is_error") is True or response.get("success") is False or response.get("error")):
        return 0
    return 1


def record(payload: dict, payload_bytes: int, env=None) -> None:
    """Insert one event. Only names, sizes and flags are kept; no prompt text or tool input/output."""
    if not isinstance(payload, dict):
        return
    cwd = _text(payload.get("cwd"), 1024)
    duration = payload.get("duration_ms")
    row = (
        mstore.now(),
        _text(payload.get("session_id"), 128),
        _text(payload.get("hook_event_name"), 64) or "unknown",
        _text(payload.get("tool_name"), 128),
        cwd,
        os.path.basename(cwd.rstrip("/")) if cwd else None,  # no git subprocess on the hot path
        duration if isinstance(duration, int) and not isinstance(duration, bool) and duration >= 0 else None,
        payload_bytes,
        _ok(payload),
        paths.runtime(env),
    )
    try:
        conn = mstore.connect(paths.db_path(env), busy_ms=BUSY_MS)
        try:
            with conn:
                conn.execute(
                    "INSERT INTO events (ts, session_id, event, tool_name, cwd, project, duration_ms, payload_bytes, ok, runtime) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    row,
                )
            housekeeping.maybe_prune(conn, env)
        finally:
            conn.close()
    except Exception:  # lock contention, full disk, unwritable state: count the loss so the portal can show it
        housekeeping.count_dropped(env)


def main() -> int:
    try:
        raw = sys.stdin.buffer.read()
        record(json.loads(raw), len(raw))
    except Exception:  # fail open: telemetry must never break a session
        pass
    return 0
