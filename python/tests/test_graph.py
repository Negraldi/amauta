import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from python.gentle_lite.graph import query, sync
from python.gentle_lite.memory import store as mstore

ROOT = Path(__file__).resolve().parents[2]
XSS = "<img src=x onerror=alert(1)>"


def node(id, label=None, **extra):
    return {"id": id, "label": label or id.upper(), "file_type": "code", "source_file": f"src/{id}.py", **extra}


def edge(src, dst, relation="calls", **extra):
    return {"source": src, "target": dst, "relation": relation, "confidence": "EXTRACTED", "confidence_score": 1.0, "source_file": f"src/{src}.py", **extra}


# Shape observed in Graphify-Labs/graphify (export.to_json): top-level "nodes" + "links" (or "edges").
GRAPH = {
    "directed": False, "multigraph": False, "graph": {},
    "nodes": [node("a", "Alpha", community=0, community_name="Core"), node("b", "Beta", community=0), node("c", "Gamma", community=1),
              node("d", "Delta", community=1), node("e", XSS, file_type="document"), node("iso", "Isolated")],
    "links": [edge("a", "b"), edge("b", "c", "imports"), edge("c", "d"), edge("a", "e", "references"), edge("a", "ghost")],
}


def write_graph(repo, data=None, key="links"):
    data = dict(data if data is not None else GRAPH)
    if key != "links" and "links" in data:
        data[key] = data.pop("links")
    out = Path(repo) / "graphify-out"
    out.mkdir(parents=True, exist_ok=True)
    (out / "graph.json").write_text(json.dumps(data))
    return out / "graph.json"


def run_cli(state, *args, cwd=None):
    env = {**os.environ, "PYTHONPATH": str(ROOT / "python"), "GENTLE_LITE_STATE_DIR": str(state)}
    return subprocess.run([sys.executable, "-P", "-m", "gentle_lite.graph", *args], capture_output=True, text=True, env=env, cwd=cwd, timeout=60)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.state = self.root / "state"
        self.conn = mstore.connect(self.state / "memory.db")
        self.addCleanup(self.conn.close)
        self.key = str(self.repo.resolve())

    def rows(self, sql, *args):
        return [dict(r) for r in self.conn.execute(sql, args)]


class SyncTest(Base):
    def test_schema_is_version_4_with_graph_tables(self):
        self.assertEqual(mstore.SCHEMA_VERSION, 4)
        names = {r["name"] for r in self.rows("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({"graph_nodes", "graph_edges", "graph_sync"} <= names)

    def test_sync_mirrors_nodes_and_edges_and_skips_dangling_edges(self):
        path = write_graph(self.repo)
        result = sync.sync_repo(self.conn, self.repo)
        self.assertEqual((result["nodes"], result["edges"]), (6, 4))  # the edge to "ghost" is dropped
        a = self.rows("SELECT * FROM graph_nodes WHERE repo = ? AND id = 'a'", self.key)[0]
        self.assertEqual((a["label"], a["kind"], a["file"]), ("Alpha", "code", "src/a.py"))
        self.assertEqual(json.loads(a["attrs_json"]), {"community": 0, "community_name": "Core"})
        e = self.rows("SELECT * FROM graph_edges WHERE repo = ? AND src = 'b'", self.key)[0]
        self.assertEqual((e["dst"], e["relation"]), ("c", "imports"))
        self.assertEqual(json.loads(e["attrs_json"])["confidence"], "EXTRACTED")
        meta = self.rows("SELECT * FROM graph_sync WHERE repo = ?", self.key)[0]
        self.assertEqual((meta["nodes"], meta["edges"], meta["graph_mtime"]), (6, 4, path.stat().st_mtime))
        self.assertTrue(meta["synced_at"])

    def test_sync_is_idempotent(self):
        write_graph(self.repo)
        sync.sync_repo(self.conn, self.repo)
        before = self.rows("SELECT * FROM graph_nodes ORDER BY id"), self.rows("SELECT * FROM graph_edges ORDER BY src, dst")
        sync.sync_repo(self.conn, self.repo)
        self.assertEqual((self.rows("SELECT * FROM graph_nodes ORDER BY id"), self.rows("SELECT * FROM graph_edges ORDER BY src, dst")), before)

    def test_accepts_edges_key_and_replaces_previous_rows_of_that_repo_only(self):
        other = self.root / "other"
        other.mkdir()
        write_graph(other)
        sync.sync_repo(self.conn, other)
        write_graph(self.repo)
        sync.sync_repo(self.conn, self.repo)
        smaller = {"nodes": [node("a"), node("b")], "edges": [edge("a", "b")]}
        write_graph(self.repo, smaller, key="edges")
        sync.sync_repo(self.conn, self.repo)
        self.assertEqual(self.rows("SELECT count(*) n FROM graph_nodes WHERE repo = ?", self.key)[0]["n"], 2)
        self.assertEqual(self.rows("SELECT count(*) n FROM graph_edges WHERE repo = ?", self.key)[0]["n"], 1)
        self.assertEqual(self.rows("SELECT count(*) n FROM graph_nodes WHERE repo = ?", str(other.resolve()))[0]["n"], 6)

    def test_failure_leaves_previous_mirror_intact(self):
        write_graph(self.repo)
        sync.sync_repo(self.conn, self.repo)
        write_graph(self.repo, {"nodes": [node("z")], "links": []})
        with mock.patch.object(sync, "_insert_edges", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                sync.sync_repo(self.conn, self.repo)
        self.assertEqual(self.rows("SELECT count(*) n FROM graph_nodes WHERE repo = ?", self.key)[0]["n"], 6)

    def test_bad_inputs_raise_graph_error_without_touching_rows(self):
        write_graph(self.repo)
        sync.sync_repo(self.conn, self.repo)
        gj = self.repo / "graphify-out" / "graph.json"
        for text in ("{not json", "[]", '{"nodes": 5}', '{"nodes": [], "links": {}}'):
            gj.write_text(text)
            with self.assertRaises(sync.GraphError, msg=text):
                sync.sync_repo(self.conn, self.repo)
        gj.unlink()
        with self.assertRaises(sync.GraphError):
            sync.sync_repo(self.conn, self.repo)
        with mock.patch.object(sync, "MAX_BYTES", 5):
            gj.write_text(json.dumps(GRAPH))
            with self.assertRaises(sync.GraphError):
                sync.sync_repo(self.conn, self.repo)
        self.assertEqual(self.rows("SELECT count(*) n FROM graph_nodes WHERE repo = ?", self.key)[0]["n"], 6)

    def test_malformed_members_are_skipped_and_attrs_are_bounded(self):
        data = {"nodes": [node("a"), "junk", {"label": "no id"}, {"id": 7, "label": "numeric id"}, node("big", blob="x" * 100_000)],
                "links": [edge("a", 7), {"source": "a"}, "junk"]}
        write_graph(self.repo, data)
        r = sync.sync_repo(self.conn, self.repo)
        self.assertEqual((r["nodes"], r["edges"]), (3, 1))
        big = self.rows("SELECT attrs_json FROM graph_nodes WHERE id = 'big'")[0]["attrs_json"]
        self.assertLessEqual(len(big), sync.MAX_ATTRS)


class QueryTest(Base):
    def setUp(self):
        super().setUp()
        write_graph(self.repo)
        sync.sync_repo(self.conn, self.repo)

    def test_neighbors_depth_one_default(self):
        r = query.neighbors(self.conn, self.key, "a")
        self.assertEqual({n["id"]: n["depth"] for n in r["nodes"]}, {"a": 0, "b": 1, "e": 1})
        self.assertEqual({(e["src"], e["dst"], e["relation"]) for e in r["edges"]}, {("a", "b", "calls"), ("a", "e", "references")})

    def test_neighbors_depth_two_and_label_lookup_and_undirected(self):
        r = query.neighbors(self.conn, self.key, "gamma", depth=2)  # by label, case-insensitive; walks edges both ways
        self.assertEqual({n["id"]: n["depth"] for n in r["nodes"]}, {"c": 0, "b": 1, "d": 1, "a": 2})

    def test_depth_is_capped(self):
        r = query.neighbors(self.conn, self.key, "a", depth=999)
        self.assertEqual(r["depth"], query.MAX_DEPTH)
        with self.assertRaises(query.QueryError):
            query.neighbors(self.conn, self.key, "a", depth=0)

    def test_unknown_node_and_repo(self):
        with self.assertRaises(query.QueryError):
            query.neighbors(self.conn, self.key, "nope")
        with self.assertRaises(query.QueryError):
            query.neighbors(self.conn, "/not/synced", "a")

    def test_path_finds_shortest_with_relations(self):
        r = query.path(self.conn, self.key, "a", "d")
        self.assertTrue(r["found"])
        self.assertEqual([n["id"] for n in r["nodes"]], ["a", "b", "c", "d"])
        self.assertEqual([e["relation"] for e in r["edges"]], ["calls", "imports", "calls"])
        self.assertEqual([n["id"] for n in query.path(self.conn, self.key, "Delta", "alpha")["nodes"]], ["d", "c", "b", "a"])

    def test_path_none_and_depth_cap(self):
        self.assertFalse(query.path(self.conn, self.key, "a", "iso")["found"])
        self.assertFalse(query.path(self.conn, self.key, "a", "d", max_depth=2)["found"])
        self.assertEqual(query.path(self.conn, self.key, "a", "a")["nodes"][0]["id"], "a")

    def test_cycles_terminate(self):
        data = {"nodes": [node("p"), node("q"), node("r")], "links": [edge("p", "q"), edge("q", "r"), edge("r", "p")]}
        write_graph(self.repo, data)
        sync.sync_repo(self.conn, self.repo)
        self.assertEqual(len(query.neighbors(self.conn, self.key, "p", depth=5)["nodes"]), 3)

    def test_search_nodes_escapes_like_wildcards(self):
        self.assertEqual([n["id"] for n in query.search_nodes(self.conn, self.key, "alp")], ["a"])
        self.assertEqual(query.search_nodes(self.conn, self.key, "%"), [])
        self.assertEqual(len(query.search_nodes(self.conn, self.key, "")), 6)


class CliTest(Base):
    def test_sync_and_queries_over_the_cli(self):
        write_graph(self.repo)
        r = run_cli(self.state, "sync", "--repo", str(self.repo))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual((json.loads(r.stdout)["nodes"], json.loads(r.stdout)["edges"]), (6, 4))
        n = json.loads(run_cli(self.state, "query", "neighbors", "a", "--repo", str(self.repo), "--depth", "2").stdout)
        self.assertEqual({x["id"] for x in n["nodes"]}, {"a", "b", "e", "c"})
        p = json.loads(run_cli(self.state, "query", "path", "a", "d", "--repo", str(self.repo)).stdout)
        self.assertEqual([x["id"] for x in p["nodes"]], ["a", "b", "c", "d"])

    def test_errors_exit_non_zero_with_a_message(self):
        r = run_cli(self.state, "sync", "--repo", str(self.repo))
        self.assertEqual(r.returncode, 2)
        self.assertIn("graph.json", r.stderr)
        r = run_cli(self.state, "query", "neighbors", "a", "--repo", str(self.repo))
        self.assertEqual(r.returncode, 2)

    def test_does_not_import_code_from_cwd(self):
        evil = self.root / "evil"
        (evil / "gentle_lite").mkdir(parents=True)
        marker = self.root / "pwned"
        (evil / "gentle_lite" / "__init__.py").write_text(f"open({str(marker)!r}, 'w').write('x')\n")
        write_graph(self.repo)
        r = run_cli(self.state, "sync", "--repo", str(self.repo), cwd=evil)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
