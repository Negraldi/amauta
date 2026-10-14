import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from python.gentle_lite.memory import server as mserver
from python.gentle_lite.memory import store as mstore

ROOT = Path(__file__).resolve().parents[2]
EXPECTED_TOOLS = {
    "mem_save", "mem_update", "mem_search", "mem_context", "mem_get_observation",
    "mem_session_start", "mem_session_end", "mem_session_summary", "mem_save_prompt", "mem_current_project", "graph_query",
}


def rpc(i, method, params=None):
    return {"jsonrpc": "2.0", "id": i, "method": method, **({"params": params} if params else {})}


def call(i, name, args):
    return rpc(i, "tools/call", {"name": name, "arguments": args})


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = mstore.Store(Path(self.tmp.name) / "memory.db")
        self.addCleanup(self.store.close)

    def text(self, resp):
        return resp["result"]["content"][0]["text"]

    def test_initialize_and_tools_list(self):
        init = mserver.handle(self.store, rpc(1, "initialize", {"protocolVersion": "2025-06-18"}))
        self.assertEqual(init["result"]["serverInfo"]["name"], "gentle-lite-memory")
        self.assertEqual(init["result"]["protocolVersion"], "2025-06-18")
        self.assertIn("tools", init["result"]["capabilities"])
        self.assertIsNone(mserver.handle(self.store, {"jsonrpc": "2.0", "method": "notifications/initialized"}))
        self.assertEqual(mserver.handle(self.store, rpc(2, "ping"))["result"], {})
        tools = mserver.handle(self.store, rpc(3, "tools/list"))["result"]["tools"]
        self.assertEqual({t["name"] for t in tools}, EXPECTED_TOOLS)
        for t in tools:
            self.assertEqual(t["inputSchema"]["type"], "object")

    def test_graph_query_tool_reads_the_mirrored_graph(self):
        from python.gentle_lite.graph import sync
        from python.tests.test_graph import GRAPH, write_graph
        repo = Path(self.tmp.name) / "repo"
        repo.mkdir()
        write_graph(repo, GRAPH)
        key = str(repo.resolve())

        def ask(**args):
            return mserver.handle(self.store, call(1, "graph_query", {"repo": key, **args}))["result"]

        self.assertTrue(ask(action="neighbors", node="a")["isError"])  # not synced yet
        sync.sync_repo(self.store.conn, repo)
        near = json.loads(ask(action="neighbors", node="a", depth=2)["content"][0]["text"])
        self.assertEqual({n["id"] for n in near["nodes"]}, {"a", "b", "e", "c"})
        route = json.loads(ask(action="path", node="a", target="d")["content"][0]["text"])
        self.assertEqual([n["id"] for n in route["nodes"]], ["a", "b", "c", "d"])
        found = json.loads(ask(action="search", node="alp")["content"][0]["text"])
        self.assertEqual([n["id"] for n in found], ["a"])
        link = Path(self.tmp.name) / "link"
        link.symlink_to(repo)
        for spelled in (str(repo) + "/", str(link), os.path.relpath(repo, os.getcwd())):  # same repo, different spellings
            got = mserver.handle(self.store, call(2, "graph_query", {"repo": spelled, "action": "search", "node": "alp"}))["result"]
            self.assertNotIn("isError", got, spelled)
            self.assertEqual([n["id"] for n in json.loads(got["content"][0]["text"])], ["a"])
        for bad in ({"action": "nope", "node": "a"}, {"action": "path", "node": "a"}, {"action": "neighbors"}, {"action": "neighbors", "node": "zzz"}):
            self.assertTrue(ask(**bad)["isError"], bad)

    def test_save_search_get_update_flow(self):
        saved = mserver.handle(self.store, call(1, "mem_save", {"title": "Use WAL", "content": "journal_mode=WAL for readers", "type": "decision", "project": "demo", "topic_key": "decision/wal"}))
        self.assertNotIn("isError", saved["result"])
        self.assertRegex(self.text(saved), r"#1")
        again = mserver.handle(self.store, call(2, "mem_save", {"title": "Use WAL", "content": "v2 journal mode", "project": "demo", "topic_key": "decision/wal"}))
        self.assertRegex(self.text(again), r"updated.*revision 2")
        hit = mserver.handle(self.store, call(3, "mem_search", {"query": "journal", "project": "demo"}))
        self.assertIn("Use WAL", self.text(hit))
        got = mserver.handle(self.store, call(4, "mem_get_observation", {"id": 1}))
        self.assertIn("v2 journal mode", self.text(got))
        upd = mserver.handle(self.store, call(5, "mem_update", {"id": 1, "content": "final"}))
        self.assertRegex(self.text(upd), r"revision 3")
        none = mserver.handle(self.store, call(6, "mem_search", {"query": "zzzznothing"}))
        self.assertIn("No results", self.text(none))

    def test_errors(self):
        self.assertEqual(mserver.handle(self.store, rpc(1, "nope"))["error"]["code"], -32601)
        self.assertEqual(mserver.handle(self.store, call(2, "nope", {}))["error"]["code"], -32602)
        missing = mserver.handle(self.store, call(3, "mem_save", {"title": "no content"}))
        self.assertTrue(missing["result"]["isError"])
        self.assertIn("content", self.text(missing))
        bad = mserver.handle(self.store, call(4, "mem_get_observation", {"id": 99}))
        self.assertTrue(bad["result"]["isError"])
        wrong_type = mserver.handle(self.store, call(5, "mem_save", {"title": 1, "content": "x"}))
        self.assertTrue(wrong_type["result"]["isError"])

    def test_session_tools_and_current_project(self):
        for i, (name, args) in enumerate([
            ("mem_session_start", {"id": "s1", "project": "demo", "directory": "/d"}),
            ("mem_save_prompt", {"content": "hello", "project": "demo", "session_id": "s1"}),
            ("mem_session_summary", {"content": "summary text", "project": "demo", "session_id": "s1"}),
            ("mem_session_end", {"id": "s1", "summary": "bye"}),
        ]):
            r = mserver.handle(self.store, call(i, name, args))
            self.assertNotIn("isError", r["result"], name)
        ctx = mserver.handle(self.store, call(9, "mem_context", {"project": "demo"}))
        self.assertIn("summary text", self.text(ctx))
        with tempfile.TemporaryDirectory() as d:
            cur = mserver.handle(self.store, call(10, "mem_current_project", {"cwd": d}))
            self.assertIn(Path(d).name, self.text(cur))


class StdioTest(unittest.TestCase):
    def test_python_dash_m_serve_over_stdio(self):
        with tempfile.TemporaryDirectory() as state:
            env = {**os.environ, "PYTHONPATH": str(ROOT / "python"), "GENTLE_LITE_STATE_DIR": state}
            lines = [
                rpc(1, "initialize", {"protocolVersion": "2025-06-18"}),
                {"jsonrpc": "2.0", "method": "notifications/initialized"},
                rpc(2, "tools/list"),
                call(3, "mem_save", {"title": "Smoke", "content": "stdio roundtrip works", "project": "demo"}),
                "{broken",
                call(4, "mem_search", {"query": "roundtrip", "project": "demo"}),
            ]
            payload = "".join((l if isinstance(l, str) else json.dumps(l)) + "\n" for l in lines)
            r = subprocess.run([sys.executable, "-m", "gentle_lite.memory", "serve"], input=payload, capture_output=True, text=True, env=env, timeout=30)
            self.assertEqual(r.returncode, 0, r.stderr)
            out = [json.loads(l) for l in r.stdout.splitlines() if l.strip()]
            self.assertEqual([o.get("id") for o in out], [1, 2, 3, None, 4])
            self.assertEqual(out[3]["error"]["code"], -32700)
            self.assertIn("Smoke", out[4]["result"]["content"][0]["text"])
            self.assertTrue((Path(state) / "memory.db").exists())


if __name__ == "__main__":
    unittest.main()
