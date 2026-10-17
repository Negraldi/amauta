import json
import os
import sys
import time
from pathlib import Path
from unittest import mock

from python.amauta.portal import wikiprobe
from python.tests.test_portal_server import ServerBase
from python.tests.test_portal_wiki import WikiBase

FAKE = r'''
import json, os, signal, sys, time
mode = sys.argv[1]
proof = os.environ.get("FAKE_PROOF")
if proof:
    with open(proof, "a") as fh:
        fh.write(os.environ.get("FAKE_SECRET", "") + "|" + str(os.getpid()) + "\n")
def send(o):
    sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
if mode == "garbage":
    print("this is not json"); sys.stdout.flush(); time.sleep(30)
if mode == "silent":
    time.sleep(60)
if mode == "stubborn":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        send({"jsonrpc": "2.0", "method": "notifications/message", "params": {"data": "noise"}})
        send({"jsonrpc": "2.0", "id": msg["id"], "result": {"protocolVersion": "2025-03-26", "capabilities": {"tools": {}}, "serverInfo": {"name": "fake", "version": "1"}}})
    elif method == "tools/list":
        if mode == "error":
            send({"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "SECRET-LEAK"}}); continue
        cursor = (msg.get("params") or {}).get("cursor")
        n = int(cursor or 0)
        if mode == "big":
            props = {"p%02d" % j: {"type": "string", "description": "y" * 400} for j in range(20)}
            send({"jsonrpc": "2.0", "id": msg["id"], "result": {"tools": [{"name": "tool%03d" % i, "description": "z" * 900, "inputSchema": {"type": "object", "properties": props}} for i in range(250)]}}); continue
        if mode == "forever":
            send({"jsonrpc": "2.0", "id": msg["id"], "result": {"tools": [{"name": "t%d" % n, "description": "d"}], "nextCursor": str(n + 1)}}); continue
        if cursor is None:
            send({"jsonrpc": "2.0", "id": msg["id"], "result": {"tools": [
                {"name": "alpha", "description": "First tool", "inputSchema": {"type": "object", "properties": {"path": {}, "mode": {}}}},
                {"name": "beta", "description": "Second tool"}], "nextCursor": "1"}})
        else:
            send({"jsonrpc": "2.0", "id": msg["id"], "result": {"tools": [{"name": "gamma", "description": "x" * 5000, "inputSchema": {"properties": {"q": {}}}}]}})
            if mode == "stubborn":
                while True:
                    time.sleep(1)
'''
SECRET = "ENV-SECRET-VALUE-123"


class ProbeBase(WikiBase):
    def setUp(self):
        super().setUp()
        self.script = self.root / "fake_mcp.py"
        self.script.write_text(FAKE)
        self.proof = self.root / "proof.txt"
        self.servers = {}
        self.add("fake", "ok")

    def add(self, name, mode, **extra):
        self.servers[name] = {"type": "stdio", "command": sys.executable, "args": [str(self.script), mode], "env": {"FAKE_SECRET": SECRET, "FAKE_PROOF": str(self.proof)}, **extra}
        self.write_config()

    def write_config(self):
        self.f["claude_json"].write_text(json.dumps({"mcpServers": self.servers}))
        self.portal._harness_cache = None

    def cache(self):
        p = self.f["state"] / "wiki" / "mcp-tools.json"
        return json.loads(p.read_text()) if p.exists() else None

    def pids(self):
        return [int(line.split("|")[1]) for line in self.proof.read_text().splitlines()] if self.proof.exists() else []

    def assertDead(self, pid):
        deadline = time.time() + 3
        while time.time() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            except PermissionError:
                break
            try:
                os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                pass
            time.sleep(0.05)
        self.fail(f"process {pid} is still running")

    def run_refresh(self, body=None):
        return wikiprobe.refresh(self.portal, {} if body is None else body)


class RefreshTest(ProbeBase):
    def test_lists_tools_follows_pagination_and_stores_the_cache(self):
        out = self.run_refresh()
        self.assertEqual(out["results"], [{"server": "fake", "ok": True, "tools": 3}])
        data = self.cache()
        entry = data["fake"]
        self.assertEqual([t["name"] for t in entry["tools"]], ["alpha", "beta", "gamma"])
        self.assertEqual(entry["tools"][0], {"name": "alpha", "description": "First tool", "params": ["mode", "path"]})
        self.assertEqual(entry["tools"][1]["params"], [])
        self.assertRegex(entry["fetched_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertLessEqual(len(entry["tools"][2]["description"]), wikiprobe.MAX_DESCRIPTION)
        self.assertNotIn("error", entry)
        self.assertEqual([p.name for p in (self.f["state"] / "wiki").iterdir()], ["mcp-tools.json"], "no temp file is left")

    def test_env_reaches_the_process_but_never_the_result_or_the_cache(self):
        out = self.run_refresh()
        self.assertIn(SECRET, self.proof.read_text())
        self.assertNotIn(SECRET, json.dumps(out))
        self.assertNotIn(SECRET, (self.f["state"] / "wiki" / "mcp-tools.json").read_text())

    def test_the_process_is_gone_afterwards(self):
        self.run_refresh()
        for pid in self.pids():
            self.assertDead(pid)

    def test_the_new_tools_show_up_on_the_wiki(self):
        self.run_refresh()
        pg = self.get("/api/wiki/page", kind="mcptool", id="fake/alpha")
        self.assertEqual(pg["summary"]["description"], "First tool")
        self.assertEqual(self.meta(pg)["Parameters"], "mode, path")
        self.assertEqual(self.meta(self.get("/api/wiki/page", kind="mcp", id="fake"))["Tools refreshed"].endswith("Z"), True)

    def test_timeout_is_reported_and_the_process_is_killed(self):
        self.add("fake", "silent")
        with mock.patch.object(wikiprobe, "TIMEOUT", 1.0):
            started = time.time()
            out = self.run_refresh()
        self.assertLess(time.time() - started, 6)
        self.assertEqual((out["results"][0]["ok"], out["results"][0]["error"]), (False, "timeout"))
        self.assertEqual(self.cache()["fake"]["error"], "timeout")
        for pid in self.pids():
            self.assertDead(pid)

    def test_malformed_output_and_server_errors_use_fixed_messages(self):
        self.add("fake", "garbage")
        with mock.patch.object(wikiprobe, "TIMEOUT", 1.5):
            out = self.run_refresh()
        self.assertEqual(out["results"][0]["error"], "malformed response")
        self.add("fake", "error")
        out = self.run_refresh()
        self.assertEqual(out["results"][0]["error"], "the server returned an error")
        self.assertNotIn("SECRET-LEAK", json.dumps(out) + json.dumps(self.cache()))

    def test_a_process_that_ignores_sigterm_is_killed(self):
        self.add("fake", "stubborn")
        with mock.patch.object(wikiprobe, "GRACE", 0.3):
            out = self.run_refresh()
        self.assertTrue(out["results"][0]["ok"])
        for pid in self.pids():
            self.assertDead(pid)

    def test_a_server_with_hundreds_of_large_tools_refreshes_and_the_cache_stays_small(self):
        self.add("fake", "big")
        out = self.run_refresh()
        self.assertEqual(out["results"], [{"server": "fake", "ok": True, "tools": 250}])
        path = self.f["state"] / "wiki" / "mcp-tools.json"
        self.assertLess(path.stat().st_size, 400_000)
        tools = self.cache()["fake"]["tools"]
        self.assertEqual(len(tools), 250)
        self.assertLessEqual(len(tools[0]["description"]), wikiprobe.MAX_DESCRIPTION)
        self.assertEqual(tools[0]["params"][:2], ["p00", "p01"])
        self.assertNotIn("inputSchema", tools[0])

    def test_a_response_over_the_line_limit_still_fails_cleanly(self):
        self.add("fake", "big")
        with mock.patch.object(wikiprobe, "MAX_LINE", 500_000):
            out = self.run_refresh()
        self.assertEqual(out["results"], [{"server": "fake", "ok": False, "error": "response too large"}])
        for pid in self.pids():
            self.assertDead(pid)

    def test_the_limits_are_documented_bounds(self):
        self.assertEqual((wikiprobe.MAX_LINE, wikiprobe.MAX_OUTPUT, wikiprobe.MAX_TOOLS), (16_000_000, 32_000_000, 500))

    def test_pagination_is_capped(self):
        self.add("fake", "forever")
        out = self.run_refresh()
        self.assertTrue(out["results"][0]["ok"])
        self.assertEqual(out["results"][0]["tools"], wikiprobe.MAX_PAGES)

    def test_missing_commands_fail_cleanly_and_nothing_goes_through_a_shell(self):
        pwned = self.root / "PWNED"
        self.servers = {"nope": {"command": "definitely-not-a-program-xyz"}, "shell": {"command": f"echo hi; touch {pwned}"}, "inject": {"command": sys.executable, "args": ["-c", "pass", f"; touch {pwned}"]}}
        self.write_config()
        out = self.run_refresh()
        self.assertEqual([r["ok"] for r in out["results"]], [False, False, False])
        self.assertIn("could not start", out["results"][0]["error"])
        self.assertFalse(pwned.exists())

    def test_remote_servers_and_connectors_are_skipped_without_contact(self):
        self.servers["remote"] = {"type": "http", "url": "https://x.example/mcp", "headers": {"Authorization": "Bearer T"}}
        self.servers["sse"] = {"type": "sse", "url": "https://y.example/sse"}
        self.write_config()
        with mock.patch("socket.socket", side_effect=AssertionError("network contact")), mock.patch("urllib.request.urlopen", side_effect=AssertionError("network contact")):
            out = self.run_refresh()
        by = {r["server"]: r for r in out["results"]}
        self.assertTrue(by["fake"]["ok"])
        self.assertEqual((by["remote"]["ok"], by["remote"]["skipped"]), (False, True))
        self.assertTrue(by["sse"]["skipped"])
        self.assertNotIn("remote", self.cache())

    def test_a_single_named_server_leaves_the_others_alone(self):
        self.add("second", "ok")
        out = self.run_refresh({"server": "second"})
        self.assertEqual([r["server"] for r in out["results"]], ["second"])
        self.assertEqual(list(self.cache()), ["second"])
        self.run_refresh({"server": "fake"})
        self.assertEqual(sorted(self.cache()), ["fake", "second"])

    def test_unknown_server_and_bad_bodies_are_refused(self):
        for body, status in (({"server": "nope"}, 404), ({"server": 5}, 400), ({"server": ""}, 400), ({"other": 1}, 400), ({"server": "fake", "x": 1}, 400), ("text", 400), ([], 400)):
            with self.assertRaises(wikiprobe.ProbeError) as ctx:
                wikiprobe.refresh(self.portal, body)
            self.assertEqual(ctx.exception.status, status, body)
        self.assertIsNone(self.cache())

    def test_a_failed_refresh_keeps_the_previous_tools_and_records_the_error(self):
        self.run_refresh()
        self.add("fake", "error")
        self.run_refresh()
        entry = self.cache()["fake"]
        self.assertEqual(len(entry["tools"]), 3)
        self.assertEqual(entry["error"], "the server returned an error")

    def test_only_one_refresh_runs_at_a_time(self):
        with wikiprobe.LOCK:
            with self.assertRaises(wikiprobe.ProbeError) as ctx:
                self.run_refresh()
        self.assertEqual(ctx.exception.status, 409)

    def test_the_cache_directory_must_be_a_plain_directory(self):
        target = self.root / "elsewhere"
        target.mkdir()
        (self.f["state"] / "wiki").symlink_to(target, target_is_directory=True)
        with self.assertRaises(wikiprobe.ProbeError):
            self.run_refresh()
        self.assertEqual(list(target.iterdir()), [])


class RefreshHttpTest(ServerBase):
    def setUp(self):
        super().setUp()
        script = Path(self.tmp.name) / "fake_mcp.py"
        script.write_text(FAKE)
        self.f["claude_json"].write_text(json.dumps({"mcpServers": {"fake": {"command": sys.executable, "args": [str(script), "ok"], "env": {"FAKE_SECRET": SECRET}}}}))

    def post(self, data, token=True, origin=None, ctype="application/json", raw=None, extra=None):
        h = {"Content-Type": ctype, **(extra or {})}
        if token:
            h["X-Portal-Token"] = self.token()
        if origin:
            h["Origin"] = origin
        return self.request("POST", "/api/harness/refresh", headers=h, body=raw if raw is not None else json.dumps(data).encode())

    def cache_exists(self):
        return (self.cfg.state_dir / "wiki" / "mcp-tools.json").exists()

    def test_a_guarded_refresh_answers_per_server_and_never_returns_env(self):
        status, _, data = self.post({})
        self.assertEqual(status, 200, data)
        out = json.loads(data)
        self.assertEqual(out["results"], [{"server": "fake", "ok": True, "tools": 3}])
        self.assertNotIn(SECRET, data.decode())
        self.assertTrue(self.cache_exists())

    def test_the_guards_refuse_before_anything_is_spawned(self):
        for kw, status in (({"token": False}, 403), ({"origin": "http://evil.example"}, 403), ({"extra": {"Sec-Fetch-Site": "cross-site"}}, 403), ({"ctype": "text/plain"}, 415), ({"raw": b"not json"}, 400), ({"raw": b"[1]"}, 400)):
            self.assertEqual(self.post({}, **kw)[0], status, kw)
        self.assertEqual(self.post({"server": "fake", "pad": "x" * 5000})[0], 413)
        self.assertEqual(self.post({"server": "nope"})[0], 404)
        self.assertEqual(self.post({"bogus": 1})[0], 400)
        self.assertEqual(self.request("POST", "/api/harness/refresh", headers={"Host": "evil.example", "Content-Type": "application/json"}, body=b"{}")[0], 403)
        self.assertFalse(self.cache_exists())

    def test_other_verbs_are_not_a_refresh(self):
        self.assertEqual(self.request("GET", "/api/harness/refresh")[0], 404)
        self.assertEqual(self.request("PUT", "/api/harness/refresh")[0], 405)
