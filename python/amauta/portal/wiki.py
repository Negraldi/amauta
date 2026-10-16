"""Wiki layer: one page schema for every entity, a recent-changes feed and a global search. Read-only, built on Portal's own readers.

Page schema (every kind): {kind, id, title, body_md (str|None), meta [{label, value}], links [{kind, id, title}],
backlinks [{kind, id, title}], sections [{heading, items [{label, value, kind, id}]}], missing [{kind, id}]}.
All strings are raw data: the UI renders them with text nodes only.
"""
from __future__ import annotations

import re
from ..graph import query as graph_query
from .api import MAX_TEXT, BadRequest, NotFound, _int, _str, has_table, columns
from . import diagrams, wikifeature, wikimem, wikisess, wikiusage
from .wikiusage import USAGE_COLUMN as _USAGE_COLUMN
from .wikibase import LINK_CAP, _blank, _iso, _item, _like, _live, _meta, _mtime, _ref, strip_title_h1

MAX_ID = 512
WIKILINK = re.compile(r"\[\[([^\[\]\n]{1,200})\]\]")
KINDS = ("memory", "skill", "tool", "mcp", "session", "feature", "node")


# ---- dispatch ----------------------------------------------------------------------------------------------
def page(portal, q):
    kind, ident = q.get("kind", ""), q.get("id", "")
    if not kind or not ident:
        raise BadRequest("kind and id are required")
    if len(ident) > MAX_ID:
        raise BadRequest(f"id must be at most {MAX_ID} characters")
    builder = _PAGES.get(kind)
    if builder is None:
        raise NotFound()
    return builder(portal, ident, q)


# ---- memory ------------------------------------------------------------------------------------------------
def _find_memory(conn, ident):
    """Observation row for a numeric id, else the newest live one with that topic_key, else with that title (case-insensitive)."""
    if not has_table(conn, "observations"):
        return None
    if ident.isdigit() and len(ident) < 19:
        row = conn.execute("SELECT o.* FROM observations o WHERE o.id = ?", (int(ident),)).fetchone()
        if row:
            return row
    live = _live(conn)
    row = conn.execute(f"SELECT o.* FROM observations o WHERE o.topic_key = ? AND {live} ORDER BY o.updated_at DESC, o.id DESC LIMIT 1", (ident,)).fetchone()
    return row or conn.execute(f"SELECT o.* FROM observations o WHERE o.title = ? COLLATE NOCASE AND {live} ORDER BY o.updated_at DESC, o.id DESC LIMIT 1", (ident,)).fetchone()


def _parse_wikilinks(text):
    """(kind, id, label) for every [[slug]] or [[kind:id|label]] in `text`; a bare slug points at a memory page."""
    out, seen = [], set()
    for m in WIKILINK.finditer(text or ""):
        target, _, label = m.group(1).partition("|")
        kind, sep, ident = target.partition(":")
        if not sep or kind not in KINDS:
            kind, ident = "memory", target
        kind, ident = kind.strip(), ident.strip()
        if ident and (kind, ident) not in seen:
            seen.add((kind, ident))
            out.append((kind, ident, label.strip() or ident))
        if len(out) >= LINK_CAP:
            break
    return out


def _wikilink_links(portal, body):
    links, missing = [], []
    for kind, ident, label in _parse_wikilinks(body):
        try:
            found = _TITLES[kind](portal, ident)
        except (BadRequest, NotFound):
            found = None
        (links if found else missing).append(_ref(kind, ident, found) if found else {"kind": kind, "id": ident})
    return links, missing


def _dedupe(refs, skip=()):
    seen, out = set(skip), []
    for r in refs:
        key = (r["kind"], r["id"])
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def _memory_page(portal, ident, q):
    source, conn = portal._memory_conn(q)
    if conn is None:
        raise NotFound()
    try:
        row = _find_memory(conn, ident)
        if row is None:
            raise NotFound()
        d = dict(row)
        d["content"] = (d.get("content") or "")[:MAX_TEXT]
        rev = d.get("revision") or d.get("revision_count") or 1
        pg = _blank("memory", d["id"], d.get("title") or ident, strip_title_h1(d["content"], d.get("title") or ident))
        pg["meta"] = _meta(("Type", d.get("type")), ("Project", d.get("project")), ("Scope", d.get("scope")), ("Topic", d.get("topic_key")),
                           ("Revision", rev), ("Created", d.get("created_at")), ("Updated", d.get("updated_at")), ("Deleted", d.get("deleted_at")), ("Source", source))
        pg["links"], pg["missing"] = _wikilink_links(portal, d["content"])
        parents, children = wikimem.hierarchy(conn, d)
        said, said_by = wikimem.mentions(conn, d)
        pg["links"] = _dedupe(pg["links"] + parents + wikimem.siblings(conn, d) + said)
        pg["backlinks"] = _dedupe(_memory_backlinks(conn, d) + children + said_by)
        pg["links"] += wikimem.related_nodes(portal, f"{d.get('title') or ''}\n{d['content']}")
        sid = d.get("session_id")
        title = wikiusage.session_title(portal, sid) if sid else None
        if title:
            pg["links"].append(_ref("session", sid, title))
        pg["history"] = wikimem.history(conn, d)
        pg["sections"] = _same_topic(conn, d)
        return pg
    finally:
        conn.close()


def _memory_backlinks(conn, d):
    needles = [f"[[memory:{d['id']}]]", f"[[memory:{d['id']}|"]
    if d.get("topic_key"):
        needles += [f"[[{d['topic_key']}]]", f"[[{d['topic_key']}|", f"[[memory:{d['topic_key']}]]", f"[[memory:{d['topic_key']}|"]
    cond = " OR ".join("o.content LIKE ? ESCAPE '\\'" for _ in needles)
    rows = conn.execute(f"SELECT o.id, o.title FROM observations o WHERE ({cond}) AND o.id != ? AND {_live(conn)} ORDER BY o.updated_at DESC LIMIT {LINK_CAP}",
                        [_like(n) for n in needles] + [d["id"]]).fetchall()
    return [_ref("memory", r["id"], r["title"]) for r in rows]


def _same_topic(conn, d):
    """Other rows that share this topic_key (another project or scope); the same row is never listed as its own revision."""
    topic = d.get("topic_key")
    if not topic:
        return []
    rows = conn.execute("SELECT o.id, o.project, o.scope, o.updated_at, o.deleted_at FROM observations o WHERE o.topic_key = ? AND o.id != ? ORDER BY o.created_at, o.id LIMIT 50", (topic, d["id"])).fetchall()
    items = [_item(f"#{r['id']} ({r['project'] or 'no project'}, {r['scope'] or 'no scope'})" + (" deleted" if r["deleted_at"] else ""), r["updated_at"], "memory", r["id"]) for r in rows]
    return [{"heading": "Same topic key in other rows", "items": items}] if items else []


def _memory_title(portal, ident):
    source, conn = portal._memory_conn({})
    if conn is None:
        return None
    try:
        row = _find_memory(conn, ident)
        return row["title"] if row else None
    finally:
        conn.close()


# ---- ODD features -------------------------------------------------------------------------------------------
def _feature_docs(portal):
    for repo in portal.cfg.repos:
        folder = repo / "odd" / "tasks"
        for f in sorted(folder.glob("*.md")) if folder.is_dir() else []:
            if f.is_file() and not f.is_symlink():
                yield repo, f


def _find_feature(portal, ident):
    return next(((repo, f) for repo, f in _feature_docs(portal) if f.stem == ident), None)


def _feature_page(portal, ident, q):
    found = _find_feature(portal, ident)
    if found is None:
        raise NotFound()
    repo, f = found
    try:
        text = f.read_text(errors="replace")[:MAX_TEXT]
    except OSError:
        raise NotFound() from None
    tasks = [(m.group(1).lower() == "x", m.group(2).strip()[:160]) for m in re.finditer(r"^- \[( |x|X)\] (.+)$", text, re.M)]
    title = next((m.group(1).strip() for m in re.finditer(r"^# (.+)$", text, re.M)), ident)
    pg = _blank("feature", ident, title, strip_title_h1(text, title))
    pg["meta"] = _meta(("Repository", repo.name), ("File", f.name), ("Tasks done", f"{sum(d for d, _ in tasks)} of {len(tasks)}"), ("Modified", _mtime(f)))
    pg["sections"] = [{"heading": "Tasks", "items": [_item(t, "done" if d else "pending") for d, t in tasks]}] if tasks else []
    pg["progress"] = wikifeature.progress(tasks)
    pg["commits"] = wikifeature.commits(repo, text)
    pg["links"], pg["missing"] = _wikilink_links(portal, text)
    pg["links"] += _feature_memories(portal, ident)
    return pg


def _feature_memories(portal, ident):
    """Memories saved under the convention topic `odd/<feature>/...`."""
    source, conn = portal._memory_conn({})
    if conn is None:
        return []
    try:
        if not has_table(conn, "observations"):
            return []
        rows = conn.execute(f"SELECT o.id, o.title FROM observations o WHERE o.topic_key LIKE ? ESCAPE '\\' AND {_live(conn)} ORDER BY o.updated_at DESC LIMIT {LINK_CAP}",
                            (_like(f"odd/{ident}/"),)).fetchall()
        return [_ref("memory", r["id"], r["title"]) for r in rows]
    finally:
        conn.close()


# ---- graph nodes --------------------------------------------------------------------------------------------
def _split_node(portal, ident):
    name, sep, node = ident.partition("::")
    repo = next((r for r in portal.cfg.repos if sep and r.name == name), None)
    if repo is None or not node:
        raise NotFound()
    return repo, str(repo.resolve()), node


def _node_page(portal, ident, q):
    repo, key, node = _split_node(portal, ident)
    conn = portal._graph_conn()
    if conn is None:
        raise NotFound()
    try:
        try:
            g = graph_query.neighbors(conn, key, node, 1)
        except graph_query.QueryError:
            raise NotFound() from None
    finally:
        conn.close()
    by_id = {n["id"]: n for n in g["nodes"]}
    me = by_id[g["start"][0]]
    ref = lambda n: _ref("node", f"{repo.name}::{n['id']}", n["label"] or n["id"])  # noqa: E731
    pg = _blank("node", ident, me["label"] or me["id"])
    pg["meta"] = _meta(("Repository", repo.name), ("Kind", me["kind"]), ("File", me["file"]), ("Node id", me["id"]))
    out = [(e, by_id[e["dst"]]) for e in g["edges"] if e["src"] == me["id"] and e["dst"] in by_id and e["dst"] != me["id"]]
    inc = [(e, by_id[e["src"]]) for e in g["edges"] if e["dst"] == me["id"] and e["src"] in by_id and e["src"] != me["id"]]
    pg["links"], pg["backlinks"] = _dedupe([ref(n) for _, n in out]), _dedupe([ref(n) for _, n in inc])
    pg["meta"] += _meta(("Outgoing edges", len(out)), ("Incoming edges", len(inc)))
    pg["sections"] = _relation_groups(repo.name, out, "outgoing") + _relation_groups(repo.name, inc, "incoming")
    src = diagrams.graph_neighborhood(g)
    pg["diagram"] = {"source": src, "nodes": len(g["nodes"]), "edges": len(g["edges"]), "truncated": bool(g["truncated"]) or len(g["nodes"]) > diagrams.MAX_GRAPH_NODES}
    pg["truncated"] = bool(g["truncated"])
    return pg


def _relation_groups(repo_name, pairs, direction):
    """One section per relation, largest group first: 'calls (outgoing)' lists the nodes this one calls."""
    groups: dict = {}
    for e, n in pairs:
        groups.setdefault(e["relation"] or "related", []).append(_item(n["label"] or n["id"], n["kind"], "node", f"{repo_name}::{n['id']}"))
    return [{"heading": f"{rel} ({direction})", "items": items} for rel, items in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0]))]


# ---- light existence checks (wikilink targets, search) --------------------------------------------------------
def _feature_title(portal, ident):
    return ident if _find_feature(portal, ident) else None


def _node_title(portal, ident):
    try:
        _, key, node = _split_node(portal, ident)
    except NotFound:
        return None
    conn = portal._graph_conn()
    if conn is None:
        return None
    try:
        row = conn.execute("SELECT label FROM graph_nodes WHERE repo = ? AND id = ?", (key, node)).fetchone()
        return (row["label"] or node) if row else None
    finally:
        conn.close()


_PAGES = {"memory": _memory_page, "skill": wikiusage.usage_page("skill"), "tool": wikiusage.usage_page("tool"), "mcp": wikiusage.usage_page("mcp"),
          "session": wikiusage.session_page, "feature": _feature_page, "node": _node_page}
_TITLES = {"memory": _memory_title, "skill": wikiusage.usage_title("skill"), "tool": wikiusage.usage_title("tool"), "mcp": wikiusage.usage_title("mcp"),
           "session": wikiusage.session_title, "feature": _feature_title, "node": _node_title}


# ---- recent changes -------------------------------------------------------------------------------------------
def recent(portal, q):
    limit = _int(q, "limit", 20, 1, 100)
    items = _recent_memories(portal, limit) + _recent_sessions(portal, limit) + _recent_features(portal)
    items.sort(key=lambda i: i["ts"], reverse=True)
    return {"items": items[:limit]}


def _recent_memories(portal, limit):
    source, conn = portal._memory_conn({})
    if conn is None:
        return []
    try:
        if not has_table(conn, "observations"):
            return []
        rev = "o.revision" if "revision" in columns(conn, "observations") else "1"
        rows = conn.execute(f"SELECT o.id, o.title, o.type, o.updated_at, {rev} AS rev FROM observations o WHERE {_live(conn)} ORDER BY o.updated_at DESC, o.id DESC LIMIT ?", (limit,)).fetchall()
        return [{"kind": "memory", "id": str(r["id"]), "title": r["title"], "ts": _iso(r["updated_at"]),
                 "what": "memory saved" if (r["rev"] or 1) <= 1 else f"memory revised (revision {r['rev']})"} for r in rows]
    finally:
        conn.close()


def _recent_sessions(portal, limit):
    conn = portal._usage_conn()
    if conn is None:
        return []
    try:
        rows = conn.execute("SELECT u.session_id, max(u.project) project, max(u.model) model, min(u.ts) first_ts, max(u.ts) last_ts, count(*) n FROM usage_messages u WHERE u.ts IS NOT NULL "
                            "GROUP BY u.session_id ORDER BY last_ts DESC LIMIT ?", (limit,)).fetchall()
        return [{"kind": "session", "id": r["session_id"], "title": wikisess.label(portal, r["session_id"], r["project"], r["model"], r["n"], r["first_ts"]), "ts": _iso(r["last_ts"]),
                 "what": f"session, {r['n']} messages"} for r in rows]
    finally:
        conn.close()


def _recent_features(portal):
    return [{"kind": "feature", "id": f.stem, "title": f.stem, "ts": _mtime(f), "what": "ODD document updated"} for _, f in _feature_docs(portal)]


# ---- global search --------------------------------------------------------------------------------------------
PER_KIND = 8
FETCH_CAP = 50


def search(portal, q):
    text = (_str(q, "q", 200) or "").replace("\x00", " ").strip()
    per_kind = _int(q, "limit", PER_KIND, 1, 25)
    out = {"q": text, "groups": []}
    if not text:
        return out
    for label, fn in (("memory", _search_memories), ("skill", _search_usage("skill")), ("tool", _search_usage("tool")), ("mcp", _search_usage("mcp")),
                      ("session", _search_sessions), ("feature", _search_features), ("task", _search_tasks), ("node", _search_nodes)):
        rows = fn(portal, text)
        if rows:
            out["groups"].append({"kind": label, "count": len(rows), "items": rows[:per_kind]})
    return out


def _hit(kind, ident, title, snippet=None):
    return {"kind": kind, "id": str(ident), "title": str(title), "snippet": snippet}


def _search_memories(portal, text):
    res = portal.memories({"q": text, "limit": str(FETCH_CAP)})
    return [_hit("memory", i["id"], i["title"], (i.get("snippet") or "")[:160]) for i in res.get("items", [])] if res.get("available") else []


def _search_usage(kind):
    col = _USAGE_COLUMN[kind]

    def run(portal, text):
        conn = portal._usage_conn()
        if conn is None:
            return []
        try:
            rows = conn.execute(f"SELECT {col} name, count(*) n FROM tool_calls c WHERE {col} LIKE ? ESCAPE '\\' GROUP BY name ORDER BY n DESC, name LIMIT {FETCH_CAP}", (_like(text),)).fetchall()
            return [_hit(kind, r["name"], r["name"], f"{r['n']} calls") for r in rows]
        finally:
            conn.close()
    return run


def _search_sessions(portal, text):
    conn = portal._usage_conn()
    if conn is None:
        return []
    try:
        rows = conn.execute("SELECT u.session_id, max(u.project) project, max(u.model) model, min(u.ts) first_ts, max(u.ts) last_ts, count(*) n FROM usage_messages u GROUP BY u.session_id "
                            "HAVING u.session_id LIKE ? ESCAPE '\\' OR max(u.project) LIKE ? ESCAPE '\\' ORDER BY last_ts DESC LIMIT ?", (_like(text), _like(text), FETCH_CAP)).fetchall()
        return [_hit("session", r["session_id"], wikisess.label(portal, r["session_id"], r["project"], r["model"], r["n"], r["first_ts"]), r["last_ts"]) for r in rows]
    finally:
        conn.close()


def _search_features(portal, text):
    needle = text.lower()
    return [_hit("feature", f.stem, f.stem, repo.name) for repo, f in _feature_docs(portal) if needle in f.stem.lower()][:FETCH_CAP]


def _search_tasks(portal, text):
    needle, out = text.lower(), []
    for _, f in _feature_docs(portal):
        try:
            body = f.read_text(errors="replace")[:MAX_TEXT]
        except OSError:
            continue
        for m in re.finditer(r"^- \[( |x|X)\] (.+)$", body, re.M):
            if needle in m.group(2).lower():
                out.append(_hit("feature", f.stem, m.group(2).strip()[:160], f"{f.stem}, {'done' if m.group(1).lower() == 'x' else 'pending'}"))
                if len(out) >= FETCH_CAP:
                    return out
    return out


def _search_nodes(portal, text):
    conn = portal._graph_conn()
    if conn is None:
        return []
    out = []
    try:
        for repo in portal.cfg.repos:
            try:
                nodes = graph_query.search_nodes(conn, str(repo.resolve()), text, FETCH_CAP)
            except graph_query.QueryError:
                continue
            out += [_hit("node", f"{repo.name}::{n['id']}", n["label"] or n["id"], n["file"]) for n in nodes]
    finally:
        conn.close()
    return out[:FETCH_CAP]
