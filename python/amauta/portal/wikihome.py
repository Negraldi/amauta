"""Home data: recent activity grouped by day (main column), a compact spending summary and harness health (right rail). Read-only."""
from __future__ import annotations

from .. import extensions
from . import wiki

PER_DAY = 20
DAYS_SHOWN = 14
FETCH = 100
WINDOWS = (7, 30)
TOP_MODELS = 3
KINDS = ("input", "output", "cache_read", "cache_write")


def activity(portal):
    days: dict = {}
    for item in wiki.recent(portal, {"limit": str(FETCH)})["items"]:
        day = item["ts"][:10]
        if day:
            days.setdefault(day, []).append(item)
    return [{"day": d, "items": days[d][:PER_DAY]} for d in sorted(days, reverse=True)[:DAYS_SHOWN]]


def _window(portal, days):
    """One /api/overview call: Today and Usage share the window, the local-day rule and the sums, so their figures cannot drift."""
    return portal.overview({"days": str(days)})


def _sums(row):
    return {k: row.get(k) or 0 for k in KINDS}


def _by_runtime(views):
    """The same token windows per runtime that has usage (Claude first); a database from before the runtime column is all Claude."""
    per = {days: {r["runtime"]: r for r in v["runtimes"]} for days, v in zip(WINDOWS, views)}
    names = sorted(set().union(*per.values()), key=lambda n: (n == "codex", n))
    return [{"runtime": n, "windows": [{"days": d, **_sums(per[d].get(n, {}))} for d in WINDOWS]} for n in names]


def spending(portal):
    views = [_window(portal, days) for days in WINDOWS]
    if not views[-1]["available"]:
        return {"available": False, "windows": [], "cache_hit_ratio": None, "top_models": [], "runtimes": []}
    longest = views[-1]
    models = sorted(({"model": m["model"], "tokens": sum(m.get(k) or 0 for k in KINDS)} for m in longest["models"]),
                    key=lambda m: (-m["tokens"], m["model"]))
    return {"available": True, "windows": [{"days": d, **_sums(v["totals"])} for d, v in zip(WINDOWS, views)],
            "cache_hit_ratio": longest["cache_hit_ratio"], "top_models": models[:TOP_MODELS], "runtimes": _by_runtime(views)}


def health(portal):
    hs = portal.harness({})
    if not hs.get("installed"):
        return {"installed": False}
    return {"installed": True, "version": hs.get("version"), "hooks": len(hs.get("hooks") or []), "mcp_servers": len(hs.get("mcp_servers") or []),
            "skills": hs.get("skills") or 0, "agents": hs.get("agents") or 0, "telemetry": bool(hs.get("telemetry"))}


def home(portal, q):
    impact = extensions.call("home.impact", portal)  # the skill_impact extra, when present
    return {"activity": activity(portal), "spending": spending(portal), "health": health(portal), "impact": impact}
