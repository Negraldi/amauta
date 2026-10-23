"""Home data: recent activity grouped by day (main column), a compact spending summary and harness health (right rail). Read-only."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from . import skillimpact, wiki
from .api import columns

PER_DAY = 20
DAYS_SHOWN = 14
FETCH = 100
WINDOWS = (7, 30)
TOP_MODELS = 3


def _today():
    return datetime.now(timezone.utc).date()


def activity(portal):
    days: dict = {}
    for item in wiki.recent(portal, {"limit": str(FETCH)})["items"]:
        day = item["ts"][:10]
        if day:
            days.setdefault(day, []).append(item)
    return [{"day": d, "items": days[d][:PER_DAY]} for d in sorted(days, reverse=True)[:DAYS_SHOWN]]


def _by_runtime(conn, today, cw):
    """The same token windows per runtime that has usage (Claude first); a database from before the runtime column is all Claude."""
    rt = "u.runtime" if "runtime" in columns(conn, "usage_messages") else "'claude'"
    names = [r[0] for r in conn.execute(f"SELECT DISTINCT {rt} FROM usage_messages u ORDER BY {rt} = 'codex', {rt}")]
    out = []
    for name in names:
        windows = []
        for days in WINDOWS:
            since = (today - timedelta(days=days)).isoformat()
            r = conn.execute(f"SELECT coalesce(sum(u.input),0) input, coalesce(sum(u.output),0) output, coalesce(sum(u.cache_read),0) cache_read, "
                             f"coalesce(sum({cw}),0) cache_write FROM usage_messages u WHERE {rt} = ? AND substr(u.ts, 1, 10) >= ?", (name, since)).fetchone()
            windows.append({"days": days, **dict(r)})
        out.append({"runtime": name, "windows": windows})
    return out


def spending(portal):
    conn = portal._usage_conn()
    if conn is None:
        return {"available": False, "windows": [], "cache_hit_ratio": None, "top_models": [], "runtimes": []}
    cw = "u.cache_write_5m + u.cache_write_1h"
    today = _today()
    try:
        windows = []
        for days in WINDOWS:
            since = (today - timedelta(days=days)).isoformat()
            r = conn.execute(f"SELECT coalesce(sum(u.input),0) input, coalesce(sum(u.output),0) output, coalesce(sum(u.cache_read),0) cache_read, "
                             f"coalesce(sum({cw}),0) cache_write FROM usage_messages u WHERE substr(u.ts, 1, 10) >= ?", (since,)).fetchone()
            windows.append({"days": days, **dict(r)})
        longest = windows[-1]
        denom = longest["input"] + longest["cache_read"] + longest["cache_write"]
        since = (today - timedelta(days=WINDOWS[-1])).isoformat()
        models = conn.execute(
            f"SELECT coalesce(u.model, 'unknown') model, sum(u.input + u.output + u.cache_read + {cw}) tokens FROM usage_messages u WHERE substr(u.ts, 1, 10) >= ? "
            f"GROUP BY model ORDER BY tokens DESC, model LIMIT {TOP_MODELS}", (since,)).fetchall()
        return {"available": True, "windows": windows, "cache_hit_ratio": longest["cache_read"] / denom if denom else None,
                "top_models": [{"model": r["model"], "tokens": r["tokens"]} for r in models], "runtimes": _by_runtime(conn, today, cw)}
    finally:
        conn.close()


def health(portal):
    hs = portal.harness({})
    if not hs.get("installed"):
        return {"installed": False}
    return {"installed": True, "version": hs.get("version"), "hooks": len(hs.get("hooks") or []), "mcp_servers": len(hs.get("mcp_servers") or []),
            "skills": hs.get("skills") or 0, "agents": hs.get("agents") or 0, "telemetry": bool(hs.get("telemetry"))}


def home(portal, q):
    return {"activity": activity(portal), "spending": spending(portal), "health": health(portal), "impact": skillimpact.ranking(portal)}
