"""Comparative per-skill impact metrics. Correlation, not causation: sessions that load a skill differ in other ways too.

Pure functions over in-memory sessions (`analyze`) plus a loader for the usage tables (`load_sessions`). A session is
{"id", "project", "calls": [{"ts", "tool", "skill", "result", "cmd_class"}] ordered by time, "turns": [{"ts", "tokens"}]}.
Exposed sessions are measured after the first load of the skill; control sessions are whole sessions that never loaded it.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .api import columns, has_table

MIN_SESSIONS = 5  # below this on either side a metric is suppressed: the numbers would only be noise
RETRY_WINDOW = 3
DAYS = 30
RATE_FLAT = 0.02  # absolute difference under which two rates are "no clear difference"
MEAN_FLAT = 0.05  # relative difference under which two means are "no clear difference"
MAX_ROWS = 500_000
SECTIONS = {
    "error_rate": "Tool error rate after load", "retry_rate": "Retry proxy after an error", "tokens_per_turn": "Output tokens per assistant turn",
    "test_failure_rate": "Test-command failure rate", "unused_after_load": "Loaded but unused",
}


def _outcome(c):
    return c.get("result") if c.get("result") in ("ok", "error") else None  # denied and unknown results are neither success nor failure


def retries(calls, window=RETRY_WINDOW):
    """(errors, retried): an error is retried when the same tool is called again within the next `window` calls (no target is known)."""
    errors = retried = 0
    for i, c in enumerate(calls):
        if _outcome(c) != "error":
            continue
        errors += 1
        if any(n["tool"] == c["tool"] for n in calls[i + 1:i + 1 + window]):
            retried += 1
    return errors, retried


def verdict(kind, baseline, exposed):
    """'better' | 'worse' | 'no clear difference' (lower is better for every metric here), None when a side is missing."""
    if baseline is None or exposed is None:
        return None
    diff = exposed - baseline
    flat = abs(diff) < RATE_FLAT if kind == "rate" else abs(diff) <= MEAN_FLAT * abs(baseline) if baseline else diff == 0
    return "no clear difference" if flat else "worse" if diff > 0 else "better"


def _split(sessions, skill):
    """([(session, load index)], [control sessions])."""
    exp, ctl = [], []
    for s in sessions:
        idx = next((i for i, c in enumerate(s["calls"]) if c.get("skill") == skill and c.get("tool") == "Skill"), None)
        (ctl if idx is None else exp).append(s if idx is None else (s, idx))
    return exp, ctl


def _after(session, idx):
    """(calls, turns) after the load, or the whole session for a control (idx None). The load message's own tokens are excluded."""
    if idx is None:
        return session["calls"], session["turns"]
    load_ts = session["calls"][idx]["ts"]
    return session["calls"][idx + 1:], [t for t in session["turns"] if t["ts"] > load_ts]


def _side(rows, pick):
    """rows: [(calls, turns)] per session; pick(calls, turns) -> (numerator, denominator). Pooled value, n and contributing sessions."""
    num = den = with_data = 0
    for calls, turns in rows:
        a, b = pick(calls, turns)
        num, den, with_data = num + a, den + b, with_data + (1 if b else 0)
    return {"num": num, "n": den, "sessions": with_data}


def _errors(calls, _turns):
    out = [_outcome(c) for c in calls]
    return out.count("error"), sum(1 for o in out if o)


def _retry(calls, _turns):
    errors, retried = retries(calls)
    return retried, errors


def _tokens(_calls, turns):
    return sum(t["tokens"] for t in turns), len(turns)


def _tests(calls, _turns):
    out = [_outcome(c) for c in calls if c.get("cmd_class") == "test"]
    return out.count("error"), sum(1 for o in out if o)


_PICKS = (("error_rate", _errors, "rate"), ("retry_rate", _retry, "rate"), ("tokens_per_turn", _tokens, "mean"), ("test_failure_rate", _tests, "rate"))


def _value(side):
    return side["num"] / side["n"] if side["n"] else None


def _metric(name, kind, exp_rows, ctl_rows, pick, min_sessions):
    e, b = _side(exp_rows, pick), _side(ctl_rows, pick)
    reason = None
    if len(exp_rows) < min_sessions or len(ctl_rows) < min_sessions:
        reason = f"fewer than {min_sessions} sessions on a side"
    elif not e["n"] or not b["n"]:
        reason = "no data on one side"
    elif e["sessions"] < min_sessions or b["sessions"] < min_sessions:
        reason = f"fewer than {min_sessions} sessions with data on a side"
    shown = reason is None
    ev, bv = (_value(e) if shown else None), (_value(b) if shown else None)
    label = {"num": "errors" if name != "tokens_per_turn" else "tokens"}
    return {"label": SECTIONS[name], "kind": kind, "suppressed": not shown, "reason": reason,
            "exposed": {"value": ev, "n": e["n"], "sessions": e["sessions"], label["num"]: e["num"]},
            "baseline": {"value": bv, "n": b["n"], "sessions": b["sessions"], label["num"]: b["num"]},
            "delta": ev - bv if shown else None, "verdict": verdict(kind, bv, ev) if shown else None}


def analyze(sessions, skill, min_sessions=MIN_SESSIONS):
    exp, ctl = _split(sessions, skill)
    exp_rows = [_after(s, i) for s, i in exp]
    projects = {s["project"] for s, _ in exp}
    same = [s for s in ctl if s["project"] in projects]
    scope, chosen = ("same-project", same) if len(same) >= min_sessions else ("all-projects", ctl)
    ctl_rows = [_after(s, None) for s in chosen]
    metrics = {name: _metric(name, kind, exp_rows, ctl_rows, pick, min_sessions) for name, pick, kind in _PICKS}
    unused = sum(1 for calls, _ in exp_rows if not calls)
    small = len(exp_rows) < min_sessions
    metrics["unused_after_load"] = {"label": SECTIONS["unused_after_load"], "kind": "rate", "suppressed": small, "reason": f"fewer than {min_sessions} loaded sessions" if small else None,
                                    "unused": unused, "n": len(exp_rows), "value": None if small or not exp_rows else unused / len(exp_rows)}
    return {"skill": skill, "exposed_sessions": len(exp_rows), "control_sessions": len(chosen), "control_scope": scope, "min_sessions": min_sessions, "metrics": metrics}


# ---- loader ---------------------------------------------------------------------------------------------------------
def load_sessions(conn, since):
    """Sessions with any usage since the ISO date `since`: calls (time order) and main-thread assistant turns, read-only. Outcome columns may be missing on an old schema."""
    have = columns(conn, "tool_calls")
    cols = ", ".join(f"c.{n}" if n in have else f"NULL AS {n}" for n in ("result", "cmd_class"))
    ids = ("SELECT session_id FROM tool_calls WHERE session_id IS NOT NULL AND substr(ts, 1, 10) >= ? UNION SELECT session_id FROM usage_messages WHERE session_id IS NOT NULL AND substr(ts, 1, 10) >= ?")
    sessions: dict = {}
    for r in conn.execute(f"SELECT c.session_id, c.ts, c.tool, c.skill, {cols} FROM tool_calls c WHERE c.session_id IN ({ids}) AND c.ts IS NOT NULL ORDER BY c.ts, c.rowid LIMIT {MAX_ROWS}", (since, since)):
        s = sessions.setdefault(r["session_id"], {"id": r["session_id"], "project": None, "calls": [], "turns": []})
        s["calls"].append({"ts": r["ts"], "tool": r["tool"], "skill": r["skill"], "result": r["result"], "cmd_class": r["cmd_class"]})
    for r in conn.execute(f"SELECT u.session_id, u.ts, u.output, u.project FROM usage_messages u WHERE u.session_id IN ({ids}) AND u.ts IS NOT NULL AND u.sidechain = 0 ORDER BY u.ts LIMIT {MAX_ROWS}", (since, since)):
        s = sessions.setdefault(r["session_id"], {"id": r["session_id"], "project": None, "calls": [], "turns": []})
        s["project"] = s["project"] or r["project"]
        s["turns"].append({"ts": r["ts"], "tokens": r["output"]})
    return list(sessions.values())


def outcomes_recorded(conn):
    return has_table(conn, "tool_calls") and "result" in columns(conn, "tool_calls") and bool(conn.execute("SELECT 1 FROM tool_calls WHERE result IS NOT NULL LIMIT 1").fetchone())


def since_date(days=DAYS, today=None):
    return ((today or datetime.now(timezone.utc).date()) - timedelta(days=days)).isoformat()


def impact(portal, skill, days=DAYS, today=None, min_sessions=MIN_SESSIONS):
    """Comparative metrics for one skill over the last `days` days, read-only; {"available": False, ...} when the usage tables are missing."""
    conn = portal._usage_conn()
    if conn is None:
        return {"available": False, "reason": "no usage data yet"}
    try:
        sessions = load_sessions(conn, since_date(days, today))
        out = analyze(sessions, skill, min_sessions)
        return {"available": True, "days": days, "outcomes_recorded": outcomes_recorded(conn), **out}
    finally:
        conn.close()
