"""Mirror <repo>/graphify-out/graph.json into memory.db.

Format observed in Graphify-Labs/graphify (export.to_json / validate.py): a top-level object with `nodes`
(`id`, `label`, `file_type`, `source_file`, `community`, ...) and `links` (older/other writers: `edges`) with
`source`, `target`, `relation`, `confidence`, `confidence_score`, `source_file`. The file stays the source of truth.
"""
from __future__ import annotations

import json
from pathlib import Path

from ..memory import store as mstore

MAX_BYTES = 128_000_000
MAX_ATTRS = 4096  # attrs_json per row; the largest values are dropped first
NODE_MAPPED = {"id", "label", "file_type", "source_file", "norm_label"}
EDGE_MAPPED = {"source", "target", "relation", "_src", "_tgt"}


class GraphError(Exception):
    pass


def repo_key(repo) -> str:
    return str(Path(repo).resolve())


def graph_file(repo) -> Path:
    return Path(repo) / "graphify-out" / "graph.json"


def _sid(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    text = str(value)
    return text[:512] if text else None


def _text(value, limit):
    return value[:limit] if isinstance(value, str) and value else None


def _attrs(item: dict, mapped: set) -> str:
    rest = {k: v for k, v in item.items() if k not in mapped}
    text = json.dumps(rest, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if len(text) <= MAX_ATTRS:
        return text
    for key in sorted(rest, key=lambda k: len(json.dumps(rest[k], ensure_ascii=False)), reverse=True):
        del rest[key]
        text = json.dumps(rest, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if len(text) <= MAX_ATTRS:
            return text
    return "{}"


def load(repo):
    """Return (nodes, edges) rows ready to insert, plus the file mtime."""
    path = graph_file(repo)
    try:
        st = path.stat()
        if st.st_size > MAX_BYTES:
            raise GraphError(f"{path} is larger than {MAX_BYTES} bytes")
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise GraphError(f"no graph.json at {path} (run `graphify update .` in the repository first)") from None
    except (OSError, ValueError) as err:
        raise GraphError(f"cannot read {path}: {err}") from None
    if not isinstance(data, dict) or not isinstance(data.get("nodes"), list):
        raise GraphError(f"{path} is not a graphify graph (expected an object with a `nodes` list)")
    links = data.get("links") if "links" in data else data.get("edges", [])
    if not isinstance(links, list):
        raise GraphError(f"{path}: `links`/`edges` must be a list")

    key = repo_key(repo)
    nodes = {}
    for n in data["nodes"]:
        nid = _sid(n.get("id")) if isinstance(n, dict) else None
        if nid is None:
            continue
        nodes[nid] = (key, nid, _text(n.get("label"), 512) or nid, _text(n.get("file_type"), 64), _text(n.get("source_file"), 1024), _attrs(n, NODE_MAPPED))
    edges = []
    for e in links:
        if not isinstance(e, dict):
            continue
        src, dst = _sid(e.get("source")), _sid(e.get("target"))
        if src in nodes and dst in nodes:  # dangling edges (graphify prunes them too) are not mirrored
            edges.append((key, src, dst, _text(e.get("relation"), 128) or "", _attrs(e, EDGE_MAPPED)))
    return list(nodes.values()), edges, st.st_mtime


def _insert_nodes(conn, rows):
    conn.executemany("INSERT OR REPLACE INTO graph_nodes (repo, id, label, kind, file, attrs_json) VALUES (?,?,?,?,?,?)", rows)


def _insert_edges(conn, rows):
    conn.executemany("INSERT INTO graph_edges (repo, src, dst, relation, attrs_json) VALUES (?,?,?,?,?)", rows)


def sync_repo(conn, repo) -> dict:
    """Replace this repo's mirrored rows with the current graph.json in one short transaction. Idempotent."""
    nodes, edges, mtime = load(repo)  # parse first: a bad file never touches the database
    key = repo_key(repo)
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM graph_edges WHERE repo = ?", (key,))
        conn.execute("DELETE FROM graph_nodes WHERE repo = ?", (key,))
        _insert_nodes(conn, nodes)
        _insert_edges(conn, edges)
        conn.execute(
            "INSERT INTO graph_sync (repo, graph_mtime, synced_at, nodes, edges) VALUES (?,?,?,?,?) "
            "ON CONFLICT(repo) DO UPDATE SET graph_mtime=excluded.graph_mtime, synced_at=excluded.synced_at, nodes=excluded.nodes, edges=excluded.edges",
            (key, mtime, mstore.now(), len(nodes), len(edges)),
        )
    return {"repo": key, "nodes": len(nodes), "edges": len(edges)}
