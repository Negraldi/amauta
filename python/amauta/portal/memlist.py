"""The memory list and memory search (/api/memories): one page of rows plus how many match in all, so the Memory page and
the search palette can say "50 of 728" and fetch the rest with an offset instead of stopping silently at the limit."""
from __future__ import annotations

import sqlite3

from ..memory import store as mstore
from .api import _OBS_COLUMNS, _int, _str, columns, has_table

LIMIT, MAX_LIMIT, MAX_OFFSET = 50, 200, 1_000_000


def _escape_like(text):
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _fts(conn, cols, live, filt, fargs, match, limit, offset):
    """(rows, total) from the full-text index, or None when the index cannot answer (the caller falls back to LIKE)."""
    if not has_table(conn, "observations_fts"):
        return None
    base = f"FROM observations_fts JOIN observations o ON o.id = observations_fts.rowid WHERE observations_fts MATCH ? AND {live}{filt}"
    try:
        total = conn.execute(f"SELECT count(*) {base}", [match, *fargs]).fetchone()[0]
        rows = conn.execute(f"SELECT {cols}, snippet(observations_fts, 1, '', '', '...', 24) AS snippet {base} "
                            "ORDER BY bm25(observations_fts) LIMIT ? OFFSET ?", [match, *fargs, limit, offset]).fetchall()
    except sqlite3.Error:
        return None
    return rows, total


def _search(conn, cols, live, filt, fargs, text, limit, offset):
    match = mstore.fts_query(text)
    if not match:
        return [], 0
    found = _fts(conn, cols, live, filt, fargs, match, limit, offset)
    if found is not None:
        return found
    like = _escape_like(text)
    base = f"FROM observations o WHERE (o.title LIKE ? ESCAPE '\\' OR o.content LIKE ? ESCAPE '\\') AND {live}{filt}"
    total = conn.execute(f"SELECT count(*) {base}", [like, like, *fargs]).fetchone()[0]
    rows = conn.execute(f"SELECT {cols}, substr(o.content, 1, 160) AS snippet {base} ORDER BY o.updated_at DESC LIMIT ? OFFSET ?",
                        [like, like, *fargs, limit, offset]).fetchall()
    return rows, total


def memories(portal, q):
    source, conn = portal._memory_conn(q)
    out = {"source": source, "available": False, "items": [], "total": 0, "offset": 0, "facets": {"projects": [], "types": []}}
    if conn is None:
        return out
    try:
        if not has_table(conn, "observations") or not _OBS_COLUMNS <= set(columns(conn, "observations")):
            return out  # not an engram-compatible schema
        rev = portal._revision_column(conn)
        live = "o.deleted_at IS NULL" if "deleted_at" in columns(conn, "observations") else "1=1"
        limit, offset = _int(q, "limit", LIMIT, 1, MAX_LIMIT), _int(q, "offset", 0, 0, MAX_OFFSET)
        project, typ, text = _str(q, "project"), _str(q, "type"), _str(q, "q", 300)
        filt, fargs = "", []
        for col, value in (("project", project), ("type", typ)):
            if value:
                filt += f" AND o.{col} = ?"
                fargs.append(value)
        cols = f"o.id, o.title, o.type, o.project, o.topic_key, o.updated_at, {f'o.{rev}' if rev else '1'} AS revision"
        if text:
            rows, total = _search(conn, cols, live, filt, fargs, text, limit, offset)
        else:
            total = conn.execute(f"SELECT count(*) FROM observations o WHERE {live}{filt}", fargs).fetchone()[0]
            rows = conn.execute(f"SELECT {cols}, substr(o.content, 1, 160) AS snippet FROM observations o WHERE {live}{filt} "
                                "ORDER BY o.updated_at DESC, o.id DESC LIMIT ? OFFSET ?", [*fargs, limit, offset]).fetchall()
        facet = lambda col, cap: [r[0] for r in conn.execute(  # noqa: E731
            f"SELECT DISTINCT o.{col} FROM observations o WHERE {live} AND o.{col} IS NOT NULL ORDER BY 1 LIMIT {cap}")]
        out.update(items=[dict(r) for r in rows], total=total, offset=offset,
                   facets={"projects": facet("project", 200), "types": facet("type", 100)})
        out["available"] = True
    finally:
        conn.close()
    return out


class Hits(list):
    """Search hits that also know how many matched in all."""

    def __init__(self, rows, total):
        super().__init__(rows)
        self.total = total


def search_hits(portal, text, cap, hit):
    """The palette's memory group: the first `cap` matches as hit(kind, id, title, snippet), with the total match count."""
    res = memories(portal, {"q": text, "limit": str(cap)})
    if not res.get("available"):
        return []
    return Hits([hit("memory", i["id"], i["title"], (i.get("snippet") or "")[:160]) for i in res["items"]], res["total"])
