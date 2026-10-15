"""python3 -P -m gentle_lite.graph <sync|query> ..."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .. import paths
from ..memory import store as mstore
from . import query, sync


def build_parser():
    p = argparse.ArgumentParser(prog="gentle_lite.graph", description="Mirror and query a repository's graphify graph.")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sync", help="mirror <repo>/graphify-out/graph.json into memory.db")
    s.add_argument("--repo", default=".")
    s.add_argument("--semantic-pending", choices=("0", "1"), help="graphify check-update verdict: 1 when a semantic re-extraction is pending")
    s.add_argument("--semantic-model", help="a semantic pass just finished with this model (records model and time, clears pending)")
    q = sub.add_parser("query", help="query the mirrored graph")
    qs = q.add_subparsers(dest="kind", required=True)
    n = qs.add_parser("neighbors", help="nodes within --depth hops of a node (id or label)")
    n.add_argument("node")
    n.add_argument("--depth", type=int, default=1)
    n.add_argument("--repo", default=".")
    pa = qs.add_parser("path", help="shortest path between two nodes (ids or labels)")
    pa.add_argument("a")
    pa.add_argument("b")
    pa.add_argument("--max-depth", type=int, default=query.PATH_MAX_DEPTH)
    pa.add_argument("--repo", default=".")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    repo = str(Path(args.repo).resolve())
    conn = mstore.connect(paths.db_path())
    try:
        if args.cmd == "sync":
            result = sync.sync_repo(conn, repo, None if args.semantic_pending is None else args.semantic_pending == "1", args.semantic_model)
        elif args.kind == "neighbors":
            result = query.neighbors(conn, repo, args.node, args.depth)
        else:
            result = query.path(conn, repo, args.a, args.b, args.max_depth)
    except (sync.GraphError, query.QueryError) as err:
        sys.stderr.write(f"gentle_lite.graph: {err}\n")
        return 2
    finally:
        conn.close()
    sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
