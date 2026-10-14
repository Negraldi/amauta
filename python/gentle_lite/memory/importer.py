"""Import an engram database into the local store. The source is opened read-only."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from . import store as mstore


def _columns(conn, table):
    return [r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')]


def _has_table(conn, table):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None


def _copy(src, dst, table, target, allowed, rename=None, synthetic_sync=None):
    """Copy rows of src.table into dst.target by column name; unknown source columns are skipped.

    `rename` maps source column -> target column. With `synthetic_sync`, rows lacking a sync_id get
    "<prefix>:<source id>" so re-imports stay idempotent. Returns the number of rows inserted.
    """
    rename = rename or {}
    dst_cols = set(_columns(dst, target))
    mapping = {c: rename.get(c, c) for c in _columns(src, table)}
    mapping = {s: d for s, d in mapping.items() if d in dst_cols and d in allowed}
    if not mapping:
        return 0
    src.row_factory = sqlite3.Row
    inserted = 0
    for row in src.execute(f'SELECT * FROM "{table}"'):
        values = {d: row[s] for s, d in mapping.items()}
        if synthetic_sync and not values.get("sync_id"):
            values["sync_id"] = f"{synthetic_sync}:{row['id']}"
        names = list(values)
        cur = dst.execute(
            f'INSERT OR IGNORE INTO {target} ({", ".join(names)}) VALUES ({", ".join("?" * len(names))})',
            [values[n] for n in names],
        )
        inserted += cur.rowcount
    return inserted


def import_engram(source, store: mstore.Store) -> dict:
    source = Path(source).expanduser()
    if not source.is_file():
        raise FileNotFoundError(f"engram database not found: {source}")
    src = sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True)
    try:
        counts = {"sessions": 0, "observations": 0, "prompts": 0}
        with store.conn:
            if _has_table(src, "sessions"):
                counts["sessions"] = _copy(
                    src, store.conn, "sessions", "sessions",
                    {"id", "project", "directory", "started_at", "ended_at", "summary"},
                )
            if _has_table(src, "observations"):
                counts["observations"] = _copy(
                    src, store.conn, "observations", "observations",
                    {"sync_id", "session_id", "project", "scope", "type", "title", "content", "topic_key",
                     "created_at", "updated_at", "revision", "deleted_at"},
                    rename={"revision_count": "revision"}, synthetic_sync="engram-obs",
                )
            for table in ("user_prompts", "prompts"):
                if _has_table(src, table):
                    counts["prompts"] = _copy(
                        src, store.conn, table, "prompts",
                        {"sync_id", "session_id", "project", "content", "created_at"}, synthetic_sync="engram-prompt",
                    )
                    break
        return counts
    finally:
        src.close()
