"""Graph queries over the mirrored tables: recursive CTEs with a hard depth cap. Edges are walked in both directions."""
from __future__ import annotations

import json

MAX_DEPTH = 5
PATH_MAX_DEPTH = 8
NODE_LIMIT = 200
EDGE_LIMIT = 500


class QueryError(Exception):
    pass


def _check_repo(conn, repo):
    if conn.execute("SELECT 1 FROM graph_sync WHERE repo = ?", (repo,)).fetchone() is None:
        raise QueryError(f"repository is not synced: {repo} (run `python3 -P -m gentle_lite.graph sync --repo <path>`)")


def _like(text):
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def resolve(conn, repo, ref, limit=20):
    """Node ids for `ref`: an exact id, else every node whose label equals it (case-insensitive)."""
    _check_repo(conn, repo)
    if not isinstance(ref, str) or not ref:
        raise QueryError("node must be a non-empty string")
    row = conn.execute("SELECT id FROM graph_nodes WHERE repo = ? AND id = ?", (repo, ref)).fetchone()
    if row:
        return [row[0]]
    ids = [r[0] for r in conn.execute("SELECT id FROM graph_nodes WHERE repo = ? AND label = ? COLLATE NOCASE ORDER BY id LIMIT ?", (repo, ref, limit))]
    if not ids:
        raise QueryError(f"no node with id or label {ref!r}")
    return ids


def _node(r):
    return {"id": r["id"], "label": r["label"], "kind": r["kind"], "file": r["file"]}


def _nodes(conn, repo, ids, extra=None):
    out = []
    for r in conn.execute("SELECT n.id, n.label, n.kind, n.file FROM graph_nodes n WHERE n.repo = ? AND n.id IN (SELECT value FROM json_each(?))", (repo, json.dumps(ids))):
        d = _node(r)
        if extra is not None:
            d["depth"] = extra[d["id"]]
        out.append(d)
    return out


_WALK = """
WITH RECURSIVE walk(node, depth, parent) AS (
  SELECT value, 0, NULL FROM json_each(:seeds)
  UNION
  SELECT e.dst, w.depth + 1, w.node FROM walk w JOIN graph_edges e ON e.repo = :repo AND e.src = w.node WHERE w.depth < :cap
  UNION
  SELECT e.src, w.depth + 1, w.node FROM walk w JOIN graph_edges e ON e.repo = :repo AND e.dst = w.node WHERE w.depth < :cap
)
"""


def _depth(value, cap, name="depth"):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise QueryError(f"{name} must be an integer >= 1")
    return min(value, cap)


def neighbors(conn, repo, node, depth=1):
    depth = _depth(depth, MAX_DEPTH)
    seeds = resolve(conn, repo, node)
    reached = {r["node"]: r["depth"] for r in conn.execute(
        _WALK + "SELECT node, min(depth) AS depth FROM walk GROUP BY node ORDER BY min(depth), node LIMIT :limit",
        {"seeds": json.dumps(seeds), "repo": repo, "cap": depth, "limit": NODE_LIMIT})}
    ids = list(reached)
    edges = [dict(r) for r in conn.execute(
        "SELECT src, dst, relation FROM graph_edges WHERE repo = ? AND src IN (SELECT value FROM json_each(?)) AND dst IN (SELECT value FROM json_each(?)) "
        "ORDER BY src, dst, relation LIMIT ?", (repo, json.dumps(ids), json.dumps(ids), EDGE_LIMIT))]
    nodes = sorted(_nodes(conn, repo, ids, reached), key=lambda n: (n["depth"], n["id"]))
    return {"repo": repo, "start": seeds, "depth": depth, "nodes": nodes, "edges": edges, "truncated": len(ids) >= NODE_LIMIT}


def path(conn, repo, a, b, max_depth=PATH_MAX_DEPTH):
    cap = _depth(max_depth, PATH_MAX_DEPTH, "max_depth")
    starts, goals = resolve(conn, repo, a), set(resolve(conn, repo, b))
    args = {"seeds": json.dumps(starts), "repo": repo, "cap": cap}
    # SQLite evaluates the queue first-in-first-out, so the first row that is a goal sits at the minimum depth.
    first = conn.execute(_WALK + "SELECT depth FROM walk WHERE node IN (SELECT value FROM json_each(:goals)) LIMIT 1", {**args, "goals": json.dumps(sorted(goals))}).fetchone()
    if first is None:
        return {"repo": repo, "found": False, "max_depth": cap, "nodes": [], "edges": []}
    found = first["depth"]
    rows = conn.execute(_WALK + "SELECT node, depth, parent FROM walk", {**args, "cap": found}).fetchall()
    parents = {}
    for r in rows:
        parents.setdefault((r["node"], r["depth"]), r["parent"])
    node = min(n for (n, d) in parents if d == found and n in goals)
    chain = [node]
    for d in range(found, 0, -1):
        node = parents[(node, d)]
        chain.append(node)
    chain.reverse()
    edges = []
    for x, y in zip(chain, chain[1:]):
        e = conn.execute(
            "SELECT src, dst, relation FROM graph_edges WHERE repo = ? AND ((src = ? AND dst = ?) OR (src = ? AND dst = ?)) ORDER BY relation LIMIT 1", (repo, x, y, y, x)).fetchone()
        edges.append(dict(e))
    by_id = {n["id"]: n for n in _nodes(conn, repo, chain)}
    return {"repo": repo, "found": True, "depth": found, "max_depth": cap, "nodes": [by_id[i] for i in chain], "edges": edges}


def search_nodes(conn, repo, text="", limit=50):
    """Nodes whose label or id contains `text` (LIKE wildcards in `text` are literal)."""
    _check_repo(conn, repo)
    limit = max(1, min(int(limit), 200))
    pat = _like(text or "")
    return [_node(r) for r in conn.execute(
        "SELECT id, label, kind, file FROM graph_nodes WHERE repo = ? AND (label LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\') ORDER BY label COLLATE NOCASE, id LIMIT ?", (repo, pat, pat, limit))]


def stats(conn, repo):
    row = conn.execute("SELECT * FROM graph_sync WHERE repo = ?", (repo,)).fetchone()
    return dict(row) if row else None
