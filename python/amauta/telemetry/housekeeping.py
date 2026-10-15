"""Dropped-event counter and retention for the events table."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from .. import paths

DEFAULT_RETENTION_DAYS = 90
DROPPED_FILE = "telemetry.dropped"
PRUNED_FILE = "telemetry.pruned"


def count_dropped(env=None) -> None:
    """Record one lost event. One byte appended per drop (O_APPEND is atomic, so concurrent hooks cannot lose counts)."""
    try:
        d = paths.state_dir(env)
        d.mkdir(parents=True, exist_ok=True)
        fd = os.open(d / DROPPED_FILE, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(fd, b"x")
        finally:
            os.close(fd)
    except Exception:  # best effort: the hook must stay silent
        pass


def dropped(env=None) -> int:
    try:
        return (paths.state_dir(env) / DROPPED_FILE).stat().st_size
    except OSError:
        return 0


def retention_days(env=None) -> int:
    env = os.environ if env is None else env
    raw = env.get("GENTLE_LITE_TELEMETRY_RETENTION_DAYS", "")
    try:
        days = int(raw)
    except ValueError:
        return DEFAULT_RETENTION_DAYS
    return days if days > 0 else DEFAULT_RETENTION_DAYS


def prune(conn, days: int) -> int:
    """Delete events older than `days`; returns the number removed."""
    if days < 1:
        raise ValueError("days must be >= 1")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    with conn:
        return conn.execute("DELETE FROM events WHERE ts < ?", (cutoff,)).rowcount


def maybe_prune(conn, env=None) -> None:
    """Prune at most once per UTC day; the check is one small file read."""
    try:
        marker = paths.state_dir(env) / PRUNED_FILE
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        try:
            if marker.read_text().strip() == today:
                return
        except OSError:
            pass
        prune(conn, retention_days(env))
        marker.write_text(today)
    except Exception:
        pass
