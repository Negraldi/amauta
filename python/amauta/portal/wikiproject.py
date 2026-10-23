"""Project pages: ODD features with progress, recent sessions, memories and graph status of one known repository. Read-only."""
from __future__ import annotations

from pathlib import Path

from . import diagrams, projects, wikifeature
from .api import NotFound, has_table
from .wikibase import LINK_CAP, _blank, _item, _live, _meta, _ref

MAX_DIAGRAMS = 8


def _repo(portal, ident):
    return next((r for r in portal.repos() if r.name == ident), None)


def title(portal, ident):
    return ident if _repo(portal, ident) is not None else None


def _features(repo):
    folder = Path(repo) / "odd" / "tasks"
    out = []
    for f in sorted(folder.glob("*.md")) if folder.is_dir() else []:
        if f.is_file() and not f.is_symlink():
            try:
                out.append((f, wikifeature.parse_tasks(f.read_text(errors="replace")[:200_000])))
            except OSError:
                continue
    return out


def _sessions(portal, repo):
    from . import wikisess
    ids = projects.session_ids(portal, repo)
    conn = portal._usage_conn()
    if conn is None or not ids:
        return []
    try:
        marks = ",".join("?" for _ in ids)
        rows = conn.execute(f"SELECT u.session_id, max(u.project) project, max(u.model) model, min(u.ts) first_ts, max(u.ts) last_ts, count(*) n FROM usage_messages u "
                            f"WHERE u.session_id IN ({marks}) GROUP BY u.session_id ORDER BY last_ts DESC LIMIT ?", [*ids, LINK_CAP]).fetchall()
        return [(r["session_id"], wikisess.label(portal, r["session_id"], r["project"], r["model"], r["n"], r["first_ts"])) for r in rows]
    finally:
        conn.close()


def _memories(portal, name):
    source, conn = portal._memory_conn({})
    if conn is None:
        return []
    try:
        if not has_table(conn, "observations"):
            return []
        rows = conn.execute(f"SELECT o.id, o.title FROM observations o WHERE o.project = ? AND {_live(conn)} ORDER BY o.updated_at DESC LIMIT {LINK_CAP}", (name,)).fetchall()
        return [(r["id"], r["title"]) for r in rows]
    finally:
        conn.close()


def page(portal, ident, q):
    repo = _repo(portal, ident)
    if repo is None:
        raise NotFound()
    feats = _features(repo)
    done, total = sum(t["done"] for _, ts in feats for t in ts), sum(len(ts) for _, ts in feats)
    sessions, memories, graph = _sessions(portal, repo), _memories(portal, repo.name), projects.graph_status(portal, repo, detail=True)
    origin = ", ".join(projects.collect(portal)["origin"].get(str(repo.resolve()), []))
    pg = _blank("project", repo.name, repo.name)
    pg["meta"] = _meta(("Path", str(repo.resolve())), ("Found by", origin), ("Features", len(feats)), ("Tasks done", f"{done} of {total}" if total else None),
                       ("Sessions", len(projects.session_ids(portal, repo))), ("Memories", projects.memory_count(portal, repo.name)),
                       ("Graph memory", f"{graph['nodes']} nodes, {graph['edges']} edges, synced {graph['synced_at']}" if graph["mirrored"] else "not mirrored"))
    pg["progress"] = {"done": done, "total": total, "percent": round(100 * done / total) if total else 0}
    pg["sections"] = []
    if feats:
        pg["sections"].append({"heading": "ODD features", "items": [_item(f.stem, f"{sum(t['done'] for t in ts)} of {len(ts)} tasks done", "feature", f"{repo.name}/{f.stem}") for f, ts in feats]})
    if sessions:
        pg["sections"].append({"heading": "Recent sessions", "items": [_item(label, None, "session", sid) for sid, label in sessions]})
    if memories:
        pg["sections"].append({"heading": "Memories", "items": [_item(t, None, "memory", i) for i, t in memories]})
    pg["links"] = [_ref("feature", f"{repo.name}/{f.stem}", f.stem) for f, _ in feats][:LINK_CAP]
    pg["odd_diagrams"] = []
    for f, ts in feats[:MAX_DIAGRAMS]:
        src = diagrams.odd_progress(f.name, ts)
        if src:
            pg["odd_diagrams"].append({"feature": f"{repo.name}/{f.stem}", "name": f.name, "done": sum(t["done"] for t in ts), "total": len(ts), "source": src})
    pg["graph"] = graph
    return pg
