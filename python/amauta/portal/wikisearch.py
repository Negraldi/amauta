"""Global search (/api/wiki/search): every kind searched by its own rule, grouped by kind. Each searcher stops at FETCH_CAP;
a group says when it did ("capped"), and the memory group also carries how many memories match in all ("total")."""
from __future__ import annotations

import re

from ..graph import query as graph_query
from .api import MAX_TEXT, _int, _str
from . import memlist, sessfacts, wikiharness, wikisess, wikiusage
from .wikiusage import USAGE_COLUMN as _USAGE_COLUMN
from .wikibase import _like
from .wiki import _feature_docs, feature_id

# ---- global search --------------------------------------------------------------------------------------------
PER_KIND = 8
FETCH_CAP = 50


def search(portal, q):
    text = (_str(q, "q", 200) or "").replace("\x00", " ").strip()
    per_kind = _int(q, "limit", PER_KIND, 1, 25)
    out = {"q": text, "groups": []}
    if not text:
        return out
    for label, fn in _searchers():
        rows = fn(portal, text)
        if rows:  # a searcher stops at FETCH_CAP: the group says so ("50+"), and memories also say how many match in all
            out["groups"].append({"kind": label, "count": len(rows), "capped": len(rows) >= FETCH_CAP,
                                  "total": getattr(rows, "total", None), "items": rows[:per_kind]})
    return out


def _searchers():
    usage = {k: _search_usage(k) for k in ("skill", "tool", "mcp")}
    return (("memory", _search_memories), ("skill", usage["skill"]), ("tool", wikiharness.merged_search("tool", usage["tool"])),
            ("mcp", wikiharness.merged_search("mcp", usage["mcp"])), *[(k, wikiharness.search(k)) for k in wikiharness.NEW_KINDS],
            ("session", _search_sessions), ("project", _search_projects), ("feature", _search_features), ("task", _search_tasks),
            ("node", _search_nodes))


def _hit(kind, ident, title, snippet=None):
    return {"kind": kind, "id": str(ident), "title": str(title), "snippet": snippet}


def _search_memories(portal, text):
    return memlist.search_hits(portal, text, FETCH_CAP, _hit)


def _search_usage(kind):
    col = _USAGE_COLUMN[kind]

    def run(portal, text):
        conn = portal._usage_conn()
        if conn is None:
            return []
        try:
            rows = conn.execute(f"SELECT {col} name, count(*) n FROM tool_calls c WHERE {col} LIKE ? ESCAPE '\\' "
                                f"GROUP BY name ORDER BY n DESC, name LIMIT {FETCH_CAP}", (_like(text),)).fetchall()
            return [_hit(kind, r["name"], r["name"], wikiusage.calls(r["n"])) for r in rows]
        finally:
            conn.close()
    return run


def _search_sessions(portal, text):
    conn = portal._usage_conn()
    if conn is None:
        return []
    try:
        rows = conn.execute(f"SELECT u.session_id, max(u.project) project, {sessfacts.MAIN_MODEL} model, min(u.ts) first_ts, "
                            "max(u.ts) last_ts, count(*) n FROM usage_messages u GROUP BY u.session_id "
                            "HAVING u.session_id LIKE ? ESCAPE '\\' OR session_project(u.session_id, max(u.project)) LIKE ? ESCAPE '\\' "
                            "ORDER BY last_ts DESC LIMIT ?",
                            (_like(text), _like(text), FETCH_CAP)).fetchall()
        label = lambda r: wikisess.label(portal, r["session_id"], r["project"], r["model"], r["n"], r["first_ts"])  # noqa: E731
        return [_hit("session", r["session_id"], label(r), r["last_ts"]) for r in rows]
    finally:
        conn.close()


def _search_projects(portal, text):
    needle = text.lower()
    return [_hit("project", r.name, r.name, str(r)) for r in portal.repos() if needle in r.name.lower()][:FETCH_CAP]


def _search_features(portal, text):
    needle = text.lower()
    found = [(repo, f) for repo, f in _feature_docs(portal) if needle in f.stem.lower()]
    return [_hit("feature", feature_id(repo, f), f.stem, repo.name) for repo, f in found][:FETCH_CAP]


def _search_tasks(portal, text):
    needle, out = text.lower(), []
    for repo, f in _feature_docs(portal):
        try:
            body = f.read_text(errors="replace")[:MAX_TEXT]
        except OSError:
            continue
        for m in re.finditer(r"^- \[( |x|X)\] (.+)$", body, re.M):
            if needle in m.group(2).lower():
                state = "done" if m.group(1).lower() == "x" else "pending"
                out.append(_hit("feature", feature_id(repo, f), m.group(2).strip()[:160], f"{f.stem}, {state}"))
                if len(out) >= FETCH_CAP:
                    return out
    return out


def _search_nodes(portal, text):
    conn = portal._graph_conn()
    if conn is None:
        return []
    out = []
    try:
        for repo in portal.repos():
            try:
                nodes = graph_query.search_nodes(conn, str(repo.resolve()), text, FETCH_CAP)
            except graph_query.QueryError:
                continue
            out += [_hit("node", f"{repo.name}::{n['id']}", n["label"] or n["id"], n["file"]) for n in nodes]
    finally:
        conn.close()
    return out[:FETCH_CAP]
