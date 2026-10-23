"""Codex rollout ingestion: one usage row per model response, runtime='codex'. Token counts and metadata only.

A rollout (`<codex-home>/sessions/YYYY/MM/DD/rollout-*.jsonl`) also holds prompts and tool output; none of it is read past
the record type, and nothing but numbers and short identifiers reaches the database. Rows are keyed by the response id,
so a rescan of a grown file is idempotent. The file is rescanned from the start when it changed (the model and the cwd
come from earlier lines), with a cheap substring filter so large rollouts stay fast.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path

WANTED = (b'"session_meta"', b'"turn_context"', b'"token_usage_record"', b'"token_count"')

_UPSERT = (
    "INSERT INTO usage_messages (message_id, session_id, project, model, ts, input, output, cache_read, cache_write_5m, cache_write_1h, thinking, sidechain, runtime) "
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'codex') ON CONFLICT(message_id) DO UPDATE SET "
    "input=max(input, excluded.input), output=max(output, excluded.output), cache_read=max(cache_read, excluded.cache_read), "
    "cache_write_5m=max(cache_write_5m, excluded.cache_write_5m), thinking=max(thinking, excluded.thinking)"
)


def _int(value) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0


def _text(value, limit=128):
    return value[:limit] if isinstance(value, str) and value else None


def _project(cwd) -> str:
    cwd = _text(cwd, 1024)
    return (os.path.basename(cwd.rstrip("/")) if cwd else "") or "unknown"


def _tokens(usage) -> tuple[int, int, int, int, int]:
    """(input, output, cache_read, cache_write, reasoning). Codex input includes the cached part; reasoning is inside output."""
    if not isinstance(usage, dict):
        return 0, 0, 0, 0, 0
    cached = _int(usage.get("cached_input_tokens"))
    return max(_int(usage.get("input_tokens")) - cached, 0), _int(usage.get("output_tokens")), cached, _int(usage.get("cache_write_input_tokens")), _int(usage.get("reasoning_output_tokens"))


def parse(path: Path) -> list[tuple]:
    """Usage rows (without the runtime) of one rollout, in file order."""
    session = None
    parent = False
    cwd = None
    models: dict[str, str] = {}  # turn id -> model
    model = None
    records: list[tuple] = []  # (id, session, cwd, model, ts, usage)
    counts: list[tuple] = []  # token_count fallbacks
    seen_counts: set[int] = set()
    with open(path, "rb") as f:
        for raw in f:
            if not any(w in raw for w in WANTED):
                continue
            try:
                line = json.loads(raw)
            except ValueError:
                continue
            payload = line.get("payload") if isinstance(line, dict) else None
            if not isinstance(payload, dict):
                continue
            kind = line.get("type")
            ts = _text(line.get("timestamp") or payload.get("timestamp"), 40)
            if kind == "session_meta":
                session = _text(payload.get("session_id")) or _text(payload.get("id")) or session
                cwd = _text(payload.get("cwd"), 1024) or cwd
                parent = parent or bool(payload.get("parent_thread_id"))
            elif kind == "turn_context":
                m = _text(payload.get("model"))
                if m:
                    model = m
                    turn = _text(payload.get("turn_id"))
                    if turn:
                        models[turn] = m
                cwd = _text(payload.get("cwd"), 1024) or cwd
            elif kind == "token_usage_record":
                usage = payload.get("usage")
                if not isinstance(usage, dict):
                    continue
                sess = _text(payload.get("session_id")) or session
                turn = _text(payload.get("turn_id"))
                rid = _text(payload.get("response_id")) or f"codex:{sess}:{turn}:{len(records)}"
                records.append((rid, sess, cwd, models.get(turn) or model, ts, usage))
            elif kind == "event_msg" and payload.get("type") == "token_count":
                info = payload.get("info")
                last = info.get("last_token_usage") if isinstance(info, dict) else None
                total = info.get("total_token_usage") if isinstance(info, dict) else None
                cumulative = _int(total.get("total_tokens")) if isinstance(total, dict) else 0
                if not isinstance(last, dict) or not cumulative or cumulative in seen_counts:
                    continue
                seen_counts.add(cumulative)
                counts.append((f"codex:{session}:{cumulative}", session, cwd, model, ts, last))
    out = []
    for rid, sess, c, m, ts, usage in records or counts:
        inp, output, cache_read, cache_write, reasoning = _tokens(usage)
        out.append((rid, sess or session, _project(c or cwd), m, ts, inp, output, cache_read, cache_write, 0, reasoning, 1 if parent else 0))
    return out


def ingest_file(conn, path, max_lines: int | None = None, deadline: float | None = None) -> dict:
    """Ingest one rollout when it changed since the last run. Returns {"messages": new rows, "lines": 0}."""
    path = Path(path)
    stats = {"messages": 0, "lines": 0}
    st = path.stat()
    row = conn.execute('SELECT size, mtime FROM ingest_state WHERE path = ?', (str(path),)).fetchone()
    if row and st.st_size == row["size"] and st.st_mtime == row["mtime"]:
        return stats
    if deadline is not None and time.monotonic() > deadline:
        return stats
    parsed = parse(path)
    with conn:  # rows and the state they were read at commit together
        for r in parsed:
            existed = conn.execute("SELECT 1 FROM usage_messages WHERE message_id = ?", (r[0],)).fetchone()
            conn.execute(_UPSERT, r)
            if not existed:
                stats["messages"] += 1
        conn.execute(
            'INSERT INTO ingest_state (path, size, mtime, "offset") VALUES (?,?,?,?) '
            'ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, "offset"=excluded."offset"',
            (str(path), st.st_size, st.st_mtime, st.st_size),
        )
    return stats


def rollout_files(codex_home) -> list[Path]:
    root = Path(codex_home) / "sessions"
    if not root.is_dir():
        return []
    return sorted(p for p in root.rglob("*.jsonl") if p.is_file() and not p.is_symlink())


def backfill(conn, codex_home, deadline: float | None = None) -> dict:
    total = {"files": 0, "messages": 0, "errors": 0}
    for p in rollout_files(codex_home):
        try:
            s = ingest_file(conn, p, deadline=deadline)
        except (OSError, ValueError, sqlite3.Error):
            total["errors"] += 1
            continue
        total["files"] += 1
        total["messages"] += s["messages"]
        if deadline is not None and time.monotonic() > deadline:
            break
    return total
