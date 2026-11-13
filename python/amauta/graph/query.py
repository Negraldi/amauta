"""Graph queries over the mirrored tables: recursive CTEs with a hard depth cap. Edges are walked in both directions."""
from __future__ import annotations

import json
import sqlite3

from . import vendored as vendored_rules

MAX_DEPTH = 5
PATH_MAX_DEPTH = 8
NODE_LIMIT = 200
EDGE_LIMIT = 500
WALK_ROWS = 20_000  # hard bound on rows the walk may produce, applied before any grouping
# Conservative floor, not a hard requirement: the walk is a single recursive SELECT (older SQLite also supports that, given
# json_each), but only builds >= 3.34 are tested with the CTE; older ones use the plain Python BFS below.
MIN_CTE_SQLITE = (3, 34)


class QueryError(Exception):
    pass


def _check_repo(conn, repo):
    if conn.execute("SELECT 1 FROM graph_sync WHERE repo = ?", (repo,)).fetchone() is None:
        raise QueryError(f"repository is not synced: {repo} (run `python3 -P -m amauta.graph sync --repo <path>`)")


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
WITH RECURSIVE walk(node, depth) AS (
  SELECT value, 0 FROM json_each(:seeds)
  UNION
  SELECT CASE WHEN e.src = w.node THEN e.dst ELSE e.src END, w.depth + 1
  FROM walk w JOIN graph_edges e ON e.repo = :repo AND (e.src = w.node OR e.dst = w.node)
  WHERE w.depth < :cap
  LIMIT :rows
)
SELECT node, depth FROM walk
"""


def _depth(value, cap, name="depth"):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise QueryError(f"{name} must be an integer >= 1")
    return min(value, cap)


def _cte_ok():
    """The recursive CTE is only used on SQLite >= MIN_CTE_SQLITE; older builds get the Python breadth-first search."""
    return sqlite3.sqlite_version_info >= MIN_CTE_SQLITE


def _adjacent(conn, repo, node):
    return [r[0] for r in conn.execute(
        "SELECT DISTINCT CASE WHEN src = :n THEN dst ELSE src END FROM graph_edges WHERE repo = :repo AND (src = :n OR dst = :n) ORDER BY 1", {"n": node, "repo": repo})]


def _reach(conn, repo, seeds, cap):
    """Breadth-first reach from `seeds`: ({node: min depth} in BFS order, truncated). Edges are walked in both directions.

    The walk is bounded at WALK_ROWS rows *before* any grouping, and the queue is FIFO so the nearest nodes survive a cut.
    """
    reached = {}
    if _cte_ok():
        rows = conn.execute(_WALK, {"seeds": json.dumps(seeds), "repo": repo, "cap": cap, "rows": WALK_ROWS}).fetchall()
        for r in rows:
            reached.setdefault(r["node"], r["depth"])  # first occurrence = minimum depth
        return reached, len(rows) >= WALK_ROWS
    reached = {s: 0 for s in seeds}
    frontier = list(seeds)
    for depth in range(1, cap + 1):
        nxt = []
        for node in frontier:
            for other in _adjacent(conn, repo, node):
                if other not in reached:
                    reached[other] = depth
                    nxt.append(other)
                    if len(reached) >= WALK_ROWS:
                        return reached, True
        frontier = nxt
    return reached, False


def neighbors(conn, repo, node, depth=1):
    depth = _depth(depth, MAX_DEPTH)
    seeds = resolve(conn, repo, node)
    reached, walk_cut = _reach(conn, repo, seeds, depth)
    ordered = sorted(reached.items(), key=lambda kv: (kv[1], kv[0]))
    kept = dict(ordered[:NODE_LIMIT])
    ids = list(kept)
    edges = [dict(r) for r in conn.execute(
        "SELECT src, dst, relation FROM graph_edges WHERE repo = ? AND src IN (SELECT value FROM json_each(?)) AND dst IN (SELECT value FROM json_each(?)) "
        "ORDER BY src, dst, relation LIMIT ?", (repo, json.dumps(ids), json.dumps(ids), EDGE_LIMIT))]
    nodes = sorted(_nodes(conn, repo, ids, kept), key=lambda n: (n["depth"], n["id"]))
    return {"repo": repo, "start": seeds, "depth": depth, "nodes": nodes, "edges": edges, "truncated": walk_cut or len(ordered) > NODE_LIMIT}


def path(conn, repo, a, b, max_depth=PATH_MAX_DEPTH):
    cap = _depth(max_depth, PATH_MAX_DEPTH, "max_depth")
    starts, goals = resolve(conn, repo, a), set(resolve(conn, repo, b))
    reached, cut = _reach(conn, repo, starts, cap)  # cut: the walk hit WALK_ROWS, so "not found" may be a false negative
    hits = {n: d for n, d in reached.items() if n in goals}
    if not hits:
        return {"repo": repo, "found": False, "max_depth": cap, "truncated": cut, "nodes": [], "edges": []}
    found = min(hits.values())
    node = min(n for n, d in hits.items() if d == found)
    chain = [node]
    for d in range(found - 1, -1, -1):  # step back through any neighbour one level closer to the start
        node = min(x for x in _adjacent(conn, repo, node) if reached.get(x) == d)
        chain.append(node)
    chain.reverse()
    edges = []
    for x, y in zip(chain, chain[1:]):
        e = conn.execute(
            "SELECT src, dst, relation FROM graph_edges WHERE repo = ? AND ((src = ? AND dst = ?) OR (src = ? AND dst = ?)) ORDER BY relation LIMIT 1", (repo, x, y, y, x)).fetchone()
        edges.append(dict(e))
    by_id = {n["id"]: n for n in _nodes(conn, repo, chain)}
    return {"repo": repo, "found": True, "depth": found, "max_depth": cap, "truncated": cut, "nodes": [by_id[i] for i in chain], "edges": edges}


# Dependency, vendored and minified sources (vendored.py): hidden from the portal's default node list, never from search or walks.
is_vendored = vendored_rules.is_vendored


_LINKS = ("(SELECT count(*) FROM graph_edges e WHERE e.repo = n.repo AND e.src = n.id)"
          " + (SELECT count(*) FROM graph_edges e WHERE e.repo = n.repo AND e.dst = n.id)")


def search_nodes(conn, repo, text="", limit=50, vendored=True, order=None):
    """Nodes whose label or id contains `text` (LIKE wildcards in `text` are literal), by label.

    order "links" (most connected first) or "name" adds each node's edge count as `links`; vendored=False leaves out
    is_vendored files. The defaults keep the original shape and order."""
    _check_repo(conn, repo)
    limit = max(1, min(int(limit), 200))
    pat = _like(text or "")
    conn.create_function("amauta_vendored", 1, vendored_rules.rule_for(repo), deterministic=True)
    rows = conn.execute(
        f"SELECT n.id, n.label, n.kind, n.file, {_LINKS if order else '0'} AS links FROM graph_nodes n WHERE n.repo = ? "
        "AND (n.label LIKE ? ESCAPE '\\' OR n.id LIKE ? ESCAPE '\\') AND (? OR NOT amauta_vendored(n.file)) "
        f"ORDER BY {'links DESC, ' if order == 'links' else ''}n.label COLLATE NOCASE, n.id LIMIT ?", (repo, pat, pat, 1 if vendored else 0, limit))
    return [{**_node(r), "links": r["links"]} if order else _node(r) for r in rows]


def node_counts(conn, repo, text="", vendored=True):
    """{"matched": nodes whose label or id contains `text`, "hidden": how many of them the list leaves out as vendored}."""
    _check_repo(conn, repo)
    pat = _like(text or "")
    conn.create_function("amauta_vendored", 1, vendored_rules.rule_for(repo), deterministic=True)
    row = conn.execute("SELECT count(*) matched, coalesce(sum(amauta_vendored(n.file)), 0) vendored FROM graph_nodes n WHERE n.repo = ? "
                       "AND (n.label LIKE ? ESCAPE '\\' OR n.id LIKE ? ESCAPE '\\')", (repo, pat, pat)).fetchone()
    return {"matched": row["matched"], "hidden": 0 if vendored else row["vendored"]}


def node_list(conn, repo, text="", limit=50, vendored=True, order=None):
    """The portal's node list: search_nodes() rows plus node_counts(), so the page can say how many it shows and hides."""
    return {"items": search_nodes(conn, repo, text, limit, vendored, order), **node_counts(conn, repo, text, vendored)}


def stats(conn, repo):
    row = conn.execute("SELECT * FROM graph_sync WHERE repo = ?", (repo,)).fetchone()
    return dict(row) if row else None
