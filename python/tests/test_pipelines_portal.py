"""The portal side of pipelines (plan S1b, ADR 0010): list per known project, start a run as a separate process only in
a trusted project, read its events as they arrive, cancel it. The browser names a project and a pipeline, never a
command."""

import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from python.amauta.extras.pipelines import portal_points as pp
from python.amauta.portal.api import Portal
from python.amauta.portal.config import Config


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.repo = self.root / "repo"
        (self.repo / "etl").mkdir(parents=True)
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        (self.repo / "etl" / "hello.py").write_text("import time\nprint('one', flush=True)\ntime.sleep(0.3)\nprint('two', flush=True)\n")
        (self.repo / "etl" / "slow.py").write_text("import time\nprint('started', flush=True)\ntime.sleep(30)\n")
        (self.repo / ".amauta").mkdir()
        steps = lambda script: [{"name": "Step", "type": "python", "script": script, "interpreter": sys.executable}]  # noqa: E731
        (self.repo / ".amauta" / "pipelines.json").write_text(json.dumps({"pipelines": [
            {"id": "hello", "name": "Hello", "steps": steps("etl/hello.py")}, {"id": "slow", "name": "Slow", "steps": steps("etl/slow.py")}]}))
        self.state = self.root / "state"
        self.state.mkdir()
        self.portal = Portal(Config(state_dir=self.state, claude_home=self.root / "home", engram_db=self.root / "none.db", repos=[self.repo]))

    def trust(self):
        (self.state / "checks").mkdir(exist_ok=True)
        (self.state / "checks" / "trust.json").write_text(json.dumps({"projects": [{"path": str(self.repo), "trusted_at": "x"}]}))

    def wait_end(self, run, timeout=20):
        deadline = time.time() + timeout
        while time.time() < deadline:
            r = pp.events(self.portal, {"project": str(self.repo), "run": run, "after": "0"})
            if r["done"]:
                return r["events"]
            time.sleep(0.2)
        self.fail("the run did not end")


class PortalPointsTest(Base):
    def test_list_shows_pipelines_trust_and_last_run(self):
        r = pp.list_pipelines(self.portal)
        proj = next(p for p in r["projects"] if p["path"] == str(self.repo))
        self.assertFalse(proj["trusted"])
        self.assertEqual([p["id"] for p in proj["pipelines"]], ["hello", "slow"])
        self.assertEqual(proj["pipelines"][0]["steps"], ["Step"])

    def test_untrusted_or_unknown_projects_and_unknown_ids_are_refused(self):
        self.assertEqual(pp.run(self.portal, {"project": str(self.repo), "id": "hello"})[0], 403)
        self.trust()
        self.assertEqual(pp.run(self.portal, {"project": str(self.root), "id": "hello"})[0], 404)
        self.assertEqual(pp.run(self.portal, {"project": str(self.repo), "id": "nope"})[0], 404)
        self.assertEqual(pp.run(self.portal, {"project": str(self.repo), "id": "hello", "argv": ["rm"]})[0], 400, "a closed schema")

    def test_a_run_streams_events_and_can_be_cancelled(self):
        self.trust()
        status, body = pp.run(self.portal, {"project": str(self.repo), "id": "hello"})
        self.assertEqual(status, 202, body)
        events = self.wait_end(body["run"])
        self.assertEqual([e["text"] for e in events if e["kind"] == "line"], ["one", "two"])
        self.assertEqual(events[-1]["status"], "ok")
        later = pp.events(self.portal, {"project": str(self.repo), "run": body["run"], "after": str(len(events) - 1)})
        self.assertEqual([e["kind"] for e in later["events"]], ["run-end"], "after skips what the page already has")
        status, slow = pp.run(self.portal, {"project": str(self.repo), "id": "slow"})
        self.assertEqual(status, 202)
        time.sleep(1.0)
        self.assertEqual(pp.run(self.portal, {"project": str(self.repo), "id": "slow"})[0], 409, "one run at a time")
        self.assertEqual(pp.cancel(self.portal, {"project": str(self.repo), "run": slow["run"]})[0], 200)
        self.assertEqual(self.wait_end(slow["run"])[-1]["status"], "cancelled")

    def test_events_refuse_a_path_instead_of_a_run_name(self):
        r = pp.events(self.portal, {"project": str(self.repo), "run": "../../etc/passwd", "after": "0"})
        self.assertEqual(r, {"events": [], "done": True, "error": "unknown run"})

    def test_the_api_routes_reach_the_extra(self):
        status, data = self.portal.get("/api/pipelines", {})
        self.assertEqual(status, 200)
        self.assertTrue(data["available"])


class HttpTest(Base):
    def test_the_guarded_write_reaches_the_extra(self):
        import threading
        from python.amauta.portal import server
        from python.tests.test_portal_settings import http_call
        srv = server.make_server(self.portal.cfg, port=0)
        self.addCleanup(srv.server_close)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.shutdown)
        port = srv.server_address[1]
        body = json.dumps({"project": str(self.repo), "id": "hello"})
        status, _, _ = http_call(port, "POST", "/api/pipelines/run", headers={"Content-Type": "application/json"}, body=body)
        self.assertEqual(status, 403, "no token")
        status, data, _ = http_call(port, "POST", "/api/pipelines/run", headers={"Content-Type": "application/json", "X-Portal-Token": srv.token}, body=body)
        self.assertEqual(status, 403)
        self.assertIn("amauta check trust", data["error"])
        self.trust()
        status, data, _ = http_call(port, "POST", "/api/pipelines/run", headers={"Content-Type": "application/json", "X-Portal-Token": srv.token}, body=body)
        self.assertEqual(status, 202)
        deadline = time.time() + 20
        while time.time() < deadline:  # the page polls through the real query string
            from urllib.parse import urlencode
            _, got, _ = http_call(port, "GET", "/api/pipelines/events?" + urlencode({"project": str(self.repo), "run": data["run"], "after": 0}))
            if got["done"]:
                break
            time.sleep(0.2)
        self.assertEqual([e["text"] for e in got["events"] if e["kind"] == "line"], ["one", "two"])


if __name__ == "__main__":
    unittest.main()
