"""Per-skill change log: installed SKILL.md versions (hash + first-seen time) and the git commits that touched the skill, with
before/after metric deltas around each change. Only hashes and times are stored, never the skill text. Fail-open and read-mostly."""
from __future__ import annotations

import hashlib
import os
import subprocess
from datetime import datetime, timezone

from ..memory import store as mstore
from . import skillimpact as si
from .api import has_table, ro_connect
from .wikiusage import SKILL_NAME

GIT_TIMEOUT = 5
SKILL_DIRS = ("assets/skills", "skills", ".claude/skills")
MAX_SKILLS = 500
MAX_BYTES = 1_000_000
LIST_CAP = 20
BUSY_MS = 500


def norm_ts(value):
    """UTC 'YYYY-MM-DDTHH:MM:SS' for any ISO-8601 timestamp (Z, offset or naive), None when it does not parse."""
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


# ---- before/after windows ---------------------------------------------------------------------------------------------
def _first_load(session, skill):
    return next((i for i, c in enumerate(session["calls"]) if c.get("skill") == skill and c.get("tool") == "Skill"), None)


def exposed_window(sessions, skill, lo, hi):
    """Metrics after the load for the sessions whose first load falls in [lo, hi) (None = open end); no control group here."""
    rows = []
    for s in sessions:
        i = _first_load(s, skill)
        ts = norm_ts(s["calls"][i]["ts"]) if i is not None else None
        if ts and (lo is None or ts >= lo) and (hi is None or ts < hi):
            rows.append(si._after(s, i))
    return {"sessions": len(rows), "metrics": {name: {**side, "value": si._value(side)} for name, pick, _ in si._PICKS for side in [si._side(rows, pick)]}}


def deltas(sessions, skill, points, min_sessions=si.MIN_SESSIONS):
    """Each point {kind, ts (UTC, second precision), label, ...} plus before/after sessions and metric deltas. Windows run between consecutive points of the same kind."""
    by_kind: dict = {}
    for p in points:
        by_kind.setdefault(p["kind"], []).append(p)
    out = []
    for group in by_kind.values():
        group.sort(key=lambda p: p["ts"])
        for i, p in enumerate(group):
            before = exposed_window(sessions, skill, group[i - 1]["ts"] if i else None, p["ts"])
            after = exposed_window(sessions, skill, p["ts"], group[i + 1]["ts"] if i + 1 < len(group) else None)
            reason = (f"fewer than {min_sessions} loaded sessions before or after" if min(before["sessions"], after["sessions"]) < min_sessions else None)
            metrics = {}
            for name, _pick, kind in si._PICKS:
                b, a = before["metrics"][name], after["metrics"][name]
                shown = reason is None and bool(a["n"]) and bool(b["n"])
                bv, av = (si._value(b) if shown else None), (si._value(a) if shown else None)
                metrics[name] = {"label": si.SECTIONS[name], "before": bv, "after": av, "n_before": b["n"], "n_after": a["n"],
                                 "delta": av - bv if shown else None, "verdict": si.verdict(kind, bv, av) if shown else None}
            out.append({**p, "before_sessions": before["sessions"], "after_sessions": after["sessions"], "suppressed": reason is not None,
                        "reason": reason, "metrics": metrics})
    return out


# ---- installed versions -----------------------------------------------------------------------------------------------
def _skill_files(portal):
    root = portal.cfg.claude_home / "skills"
    try:
        names = sorted(d.name for d in root.iterdir() if d.is_dir() and SKILL_NAME.match(d.name))[:MAX_SKILLS]
    except OSError:
        return
    for name in names:
        yield name, root / name / "SKILL.md"


def observe(portal):
    """Record the sha256 of every installed SKILL.md that is not known yet, stamped with the file time (clamped to now). Idempotent, fail-open,
    never creates the database and writes only when something is new."""
    try:
        ro = ro_connect(portal.cfg.db_path)
        if ro is None:
            return
        try:
            known = {(r[0], r[1]) for r in ro.execute("SELECT skill, hash FROM skill_versions")} if has_table(ro, "skill_versions") else set()
        finally:
            ro.close()
        fresh = []
        now = mstore.now()
        for name, path in _skill_files(portal):
            try:
                with path.open("rb") as fh:
                    raw = fh.read(MAX_BYTES)
                mtime = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            except OSError:
                continue
            digest = hashlib.sha256(raw).hexdigest()
            if (name, digest) not in known:
                fresh.append((name, digest, min(mtime, now)))
                known.add((name, digest))
        if not fresh:
            return
        conn = mstore.connect(portal.cfg.db_path, busy_ms=BUSY_MS)
        try:
            with conn:
                conn.executemany("INSERT OR IGNORE INTO skill_versions (skill, hash, first_seen) VALUES (?,?,?)", fresh)
        finally:
            conn.close()
    except Exception:  # a locked or read-only database must never break a page
        pass


def versions(portal, skill):
    conn = ro_connect(portal.cfg.db_path)
    if conn is None:
        return []
    try:
        if not has_table(conn, "skill_versions"):
            return []
        return [{"hash": r["hash"], "first_seen": r["first_seen"]} for r in conn.execute("SELECT hash, first_seen FROM skill_versions WHERE skill = ? ORDER BY first_seen, hash", (skill,))]
    finally:
        conn.close()


# ---- git --------------------------------------------------------------------------------------------------------------
def git_commits(portal, skill):
    """Newest commits touching the skill's directory in the first --repo that has one; [] when there is none, git is missing or slow."""
    if not SKILL_NAME.match(skill) or ".." in skill:
        return []
    for repo in portal.repos():
        for base in SKILL_DIRS:
            rel = f"{base}/{skill}"
            if not (repo / rel).is_dir() or not (repo / ".git").exists():
                continue
            try:
                out = subprocess.run(["git", "-C", str(repo), "log", f"-n{LIST_CAP}", "--format=%h%x00%cI%x00%s", "--", rel], capture_output=True, text=True, timeout=GIT_TIMEOUT,
                                     env={**os.environ, "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0"}, stdin=subprocess.DEVNULL)
            except (OSError, subprocess.SubprocessError):
                return []
            found = []
            for line in out.stdout.splitlines() if out.returncode == 0 else []:
                parts = line.split("\x00")
                if len(parts) == 3:
                    found.append({"hash": parts[0], "date": parts[1], "subject": parts[2][:200]})
            if found:
                return found
    return []


# ---- the page block ---------------------------------------------------------------------------------------------------
def changes(portal, skill, sessions):
    vs, commits = versions(portal, skill), git_commits(portal, skill)
    points = [{"kind": "installed", "ts": norm_ts(v["first_seen"]), "label": v["hash"][:12], "when": v["first_seen"]} for v in vs[1:]]  # the first version is a baseline, not a change
    points += [{"kind": "commit", "ts": norm_ts(c["date"]), "label": f"{c['hash']} {c['subject'][:80]}", "when": c["date"]} for c in commits]
    points = [p for p in points if p["ts"]]
    done = sorted(deltas(sessions, skill, points), key=lambda p: p["ts"], reverse=True)
    return {"versions": [{"hash": v["hash"][:12], "first_seen": v["first_seen"], "current": i == len(vs) - 1} for i, v in reversed(list(enumerate(vs)))][:LIST_CAP],
            "commits": commits, "changes": done[:LIST_CAP]}


def block(portal, skill, days=si.DAYS, today=None):
    """The skill page's "Impact (comparative)" data: metrics, sample sizes, change log with before/after deltas, and the correlation note."""
    observe(portal)
    conn = portal._usage_conn()
    if conn is None:
        return {"available": False, "reason": "no usage data yet", "note": si.NOTE}
    try:
        sessions = si.load_sessions(conn, si.since_date(days, today))
        recorded = si.outcomes_recorded(conn)
    finally:
        conn.close()
    return {"available": True, "days": days, "outcomes_recorded": recorded, "note": si.NOTE, **si.analyze(sessions, skill), "changes": changes(portal, skill, sessions)}
