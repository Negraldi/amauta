"""Incremental transcript ingestion: one usage row per assistant message id, tool names only."""
from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path

from ..memory import store as mstore

CHUNK = 1 << 20  # bytes read per slice
BATCH_LINES = 200  # lines per write transaction


def _int(value) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0


def _text(value, limit=128):
    return value[:limit] if isinstance(value, str) and value else None


def _project(line: dict, path: Path) -> str:
    cwd = _text(line.get("cwd"), 1024)
    return (os.path.basename(cwd.rstrip("/")) if cwd else "") or path.parent.name


def parse_assistant(line: dict, path: Path):
    """Return (usage_row | None, tool_rows) for one transcript line; (None, []) when it is not a usable assistant line."""
    if not isinstance(line, dict) or line.get("type") != "assistant":
        return None, []
    msg = line.get("message")
    if not isinstance(msg, dict):
        return None, []
    message_id = _text(msg.get("id")) or _text(line.get("requestId"))
    if not message_id:
        return None, []
    session = _text(line.get("sessionId"))
    ts = _text(line.get("timestamp"), 40)

    usage_row = None
    usage = msg.get("usage")
    if isinstance(usage, dict):
        created = _int(usage.get("cache_creation_input_tokens"))
        breakdown = usage.get("cache_creation")
        w5 = _int(breakdown.get("ephemeral_5m_input_tokens")) if isinstance(breakdown, dict) else 0
        w1 = _int(breakdown.get("ephemeral_1h_input_tokens")) if isinstance(breakdown, dict) else 0
        if not (w5 or w1):
            w5 = created  # no breakdown: the whole write counts as 5m
        details = usage.get("output_tokens_details")
        usage_row = (
            message_id, session, _project(line, path), _text(msg.get("model")), ts,
            _int(usage.get("input_tokens")), _int(usage.get("output_tokens")), _int(usage.get("cache_read_input_tokens")),
            w5, w1, _int(details.get("thinking_tokens")) if isinstance(details, dict) else 0,
            1 if line.get("isSidechain") is True else 0,
        )

    tools = []
    content = msg.get("content")
    for n, item in enumerate(content if isinstance(content, list) else []):
        if not isinstance(item, dict) or item.get("type") != "tool_use":
            continue
        name = _text(item.get("name"))
        if not name:
            continue
        inp = item.get("input") if isinstance(item.get("input"), dict) else {}
        skill = _text(inp.get("skill")) if name == "Skill" else None
        agent = _text(inp.get("subagent_type")) if name in ("Agent", "Task") else None
        server = name.split("__")[1] if name.startswith("mcp__") and name.count("__") >= 2 else None
        call_id = _text(item.get("id")) or f"{message_id}#{n}"
        tools.append((message_id, call_id, session, ts, name, skill, agent, _text(server)))
    return usage_row, tools


_UPSERT = (
    "INSERT INTO usage_messages (message_id, session_id, project, model, ts, input, output, cache_read, cache_write_5m, cache_write_1h, thinking, sidechain) "
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(message_id) DO UPDATE SET "
    "input=max(input, excluded.input), output=max(output, excluded.output), cache_read=max(cache_read, excluded.cache_read), "
    "cache_write_5m=max(cache_write_5m, excluded.cache_write_5m), cache_write_1h=max(cache_write_1h, excluded.cache_write_1h), "
    "thinking=max(thinking, excluded.thinking)"
)


def ingest_file(conn, path, max_lines: int | None = None, deadline: float | None = None) -> dict:
    """Ingest new complete lines of one transcript. Returns {"messages": new usage rows, "tools": new tool rows, "lines": parsed lines}."""
    path = Path(path)
    stats = {"messages": 0, "tools": 0, "lines": 0}
    st = path.stat()
    row = conn.execute('SELECT size, mtime, "offset" AS off FROM ingest_state WHERE path = ?', (str(path),)).fetchone()
    offset = row["off"] if row else 0
    if row and (st.st_size < row["size"] or (st.st_size == row["size"] and st.st_mtime != row["mtime"])):
        offset = 0  # truncated, rotated or rewritten in place: rescan; inserts are idempotent
    if row and st.st_size == row["size"] and st.st_mtime == row["mtime"] and offset == st.st_size:
        return stats
    consumed = offset
    pending = b""
    done = False
    in_batch = 0
    with open(path, "rb") as f:
        f.seek(offset)
        while not done:
            chunk = f.read(CHUNK)
            if not chunk:
                break
            pending += chunk
            while True:
                nl = pending.find(b"\n")
                if nl < 0:
                    break
                raw, pending = pending[:nl], pending[nl + 1:]
                consumed += nl + 1
                stats["lines"] += 1
                in_batch += 1
                _store(conn, raw, path, stats)
                if in_batch >= BATCH_LINES:  # short transactions: never starve telemetry writers
                    _save_state(conn, path, st, consumed)
                    in_batch = 0
                if (max_lines is not None and stats["lines"] >= max_lines) or (deadline is not None and time.monotonic() > deadline):
                    done = True
                    break
    _save_state(conn, path, st, consumed)
    return stats


def _save_state(conn, path: Path, st, consumed: int) -> None:
    """Commit the rows of the current batch together with the offset they reach."""
    with conn:
        conn.execute(
            'INSERT INTO ingest_state (path, size, mtime, "offset") VALUES (?,?,?,?) '
            'ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, "offset"=excluded."offset"',
            (str(path), st.st_size, st.st_mtime, consumed),
        )


def _store(conn, raw: bytes, path: Path, stats: dict) -> None:
    try:
        line = json.loads(raw)
    except ValueError:
        return
    usage_row, tools = parse_assistant(line, path)
    if usage_row:
        before = conn.total_changes
        existed = conn.execute("SELECT 1 FROM usage_messages WHERE message_id = ?", (usage_row[0],)).fetchone()
        conn.execute(_UPSERT, usage_row)
        if not existed and conn.total_changes > before:
            stats["messages"] += 1
    for t in tools:
        cur = conn.execute("INSERT OR IGNORE INTO tool_calls (message_id, call_id, session_id, ts, tool, skill, subagent_type, mcp_server) VALUES (?,?,?,?,?,?,?,?)", t)
        stats["tools"] += cur.rowcount


def transcript_files(claude_home) -> list[Path]:
    root = Path(claude_home) / "projects"
    if not root.is_dir():
        return []
    return sorted(p for p in root.rglob("*.jsonl") if p.is_file() and not p.is_symlink())


def backfill(conn, claude_home, deadline: float | None = None) -> dict:
    total = {"files": 0, "messages": 0, "tools": 0, "errors": 0}
    for p in transcript_files(claude_home):
        try:
            s = ingest_file(conn, p, deadline=deadline)
        except (OSError, ValueError, sqlite3.Error):  # e.g. 'database is locked' while hooks write
            total["errors"] += 1
            continue
        total["files"] += 1
        total["messages"] += s["messages"]
        total["tools"] += s["tools"]
        if deadline is not None and time.monotonic() > deadline:
            break
    return total
