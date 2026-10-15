"""Aggregate the events table."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..memory import store as mstore
from . import housekeeping


def build(db_path, days: int = 7, env=None) -> dict:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = mstore.connect(db_path)
    try:
        q = lambda sql: conn.execute(sql, (since,)).fetchall()  # noqa: E731
        events = {r["event"]: r["n"] for r in q("SELECT event, count(*) n FROM events WHERE ts >= ? GROUP BY event ORDER BY n DESC, event")}
        tools = [
            {"tool": r["tool_name"], "count": r["n"]}
            for r in q("SELECT tool_name, count(*) n FROM events WHERE ts >= ? AND tool_name IS NOT NULL GROUP BY tool_name ORDER BY n DESC, tool_name LIMIT 10")
        ]
        per_day = {
            r["day"]: r["n"]
            for r in q("SELECT substr(ts, 1, 10) day, count(DISTINCT session_id) n FROM events WHERE ts >= ? AND session_id IS NOT NULL GROUP BY day ORDER BY day")
        }
    finally:
        conn.close()
    return {"days": days, "since": since, "total": sum(events.values()), "events": events, "top_tools": tools, "sessions_per_day": per_day, "dropped": housekeeping.dropped(env)}


def render(data: dict) -> str:
    lines = [f"Telemetry, last {data['days']} day(s): {data['total']} event(s)", "", "Events"]
    lines += [f"  {name:<20} {n}" for name, n in data["events"].items()] or ["  (none)"]
    lines += ["", "Top tools"] + ([f"  {t['tool']:<28} {t['count']}" for t in data["top_tools"]] or ["  (none)"])
    lines += ["", "Sessions per day"] + ([f"  {d}  {n}" for d, n in data["sessions_per_day"].items()] or ["  (none)"])
    lines += ["", f"Dropped events: {data.get('dropped', 0)}"]
    return "\n".join(lines) + "\n"
