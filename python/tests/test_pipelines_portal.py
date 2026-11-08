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
        import hashlib
        digest = hashlib.sha256((self.repo / ".amauta" / "pipelines.json").read_bytes()).hexdigest()
        (self.state / "checks").mkdir(exist_ok=True)
        (self.state / "checks" / "trust.json").write_text(json.dumps({"projects": [
            {"path": str(self.repo), "trusted_at": "x", "pipelines_sha256": digest}]}))

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
        first = pp.events(self.portal, {"project": str(self.repo), "run": body["run"], "after": "0"})
        later = pp.events(self.portal, {"project": str(self.repo), "run": body["run"], "after": str(first["next"])})
        self.assertEqual((later["events"], later["next"]), ([], first["next"]), "after is a byte offset: nothing new")
        self.assertTrue(first["done"])
        status, slow = pp.run(self.portal, {"project": str(self.repo), "id": "slow"})
        self.assertEqual(status, 202)
        time.sleep(1.0)
        self.assertEqual(pp.run(self.portal, {"project": str(self.repo), "id": "slow"})[0], 409, "one run at a time")
        self.assertEqual(pp.cancel(self.portal, {"project": str(self.repo), "run": slow["run"]})[0], 200)
        self.assertEqual(self.wait_end(slow["run"])[-1]["status"], "cancelled")

    def test_one_step_from_the_portal_and_the_card_summary(self):
        self.trust()
        self.assertEqual(pp.run(self.portal, {"project": str(self.repo), "id": "hello", "step": 0})[0], 400)
        self.assertEqual(pp.run(self.portal, {"project": str(self.repo), "id": "hello", "step": "1"})[0], 400)
        self.assertEqual(pp.run(self.portal, {"project": str(self.repo), "id": "hello", "step": 2})[0], 400, "hello has one step")
        status, body = pp.run(self.portal, {"project": str(self.repo), "id": "hello", "step": 1})
        self.assertEqual(status, 202, body)
        events = self.wait_end(body["run"])
        self.assertEqual((events[0]["trigger"], events[0]["only"]), ("portal", 0))
        card = next(p for p in pp.list_pipelines(self.portal)["projects"] if p["path"] == str(self.repo))["pipelines"][0]
        self.assertEqual(card["category"], "")
        self.assertEqual((card["last"]["status"], card["last"]["trigger"]), ("ok", "portal"))
        self.assertIsInstance(card["last"]["seconds"], float)

    def test_cards_carry_schedule_history_and_typical(self):
        pipelines = json.loads((self.repo / ".amauta" / "pipelines.json").read_text())
        pipelines["pipelines"][0]["schedule"] = {"every_minutes": 30}
        (self.repo / ".amauta" / "pipelines.json").write_text(json.dumps(pipelines))
        card = lambda: next(p for p in pp.list_pipelines(self.portal)["projects"] if p["path"] == str(self.repo))["pipelines"][0]  # noqa: E731
        self.assertEqual((card()["schedules"], card()["history"], card()["typical"]), ([{"every_minutes": 30, "state": "never"}], [], None))
        from python.amauta.extras.pipelines import runner, store
        runner.run(self.repo, "hello", store.new_run(self.state, self.repo, "hello"), trigger="schedule")
        c = card()
        self.assertEqual(c["schedules"][0]["state"], "ok")
        self.assertEqual([(r["status"], r["trigger"]) for r in c["history"]], [("ok", "schedule")])
        self.assertTrue(c["history"][0]["run"].endswith(".jsonl"))
        self.assertIsInstance(c["typical"], float)

    def test_check_reports_without_running_and_only_for_known_projects(self):
        r = pp.check(self.portal, {"project": str(self.repo), "id": "hello"})
        self.assertEqual(r, {"findings": []})
        (self.repo / "etl" / "hello.py").unlink()
        r = pp.check(self.portal, {"project": str(self.repo), "id": "hello"})
        self.assertEqual([(f["step"], f["level"]) for f in r["findings"]], [("Step", "error")])
        self.assertEqual(pp.check(self.portal, {"project": str(self.root), "id": "hello"}), {"error": "not a project the portal knows"})
        self.assertEqual(pp.check(self.portal, {"project": str(self.repo), "id": "nope"})["error"], "no such pipeline")

    def test_concurrent_requests_start_one_run(self):
        import threading
        self.trust()
        codes, go = [], threading.Barrier(3)

        def post():
            go.wait()
            codes.append(pp.run(self.portal, {"project": str(self.repo), "id": "slow"}))
        threads = [threading.Thread(target=post) for _ in range(3)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(sorted(c for c, _ in codes), [202, 409, 409])
        run = next(b["run"] for c, b in codes if c == 202)
        time.sleep(1.0)
        pp.cancel(self.portal, {"project": str(self.repo), "run": run})
        self.wait_end(run)

    def test_trust_covers_the_definition_and_cancel_needs_a_running_run(self):
        self.trust()
        status, body = pp.run(self.portal, {"project": str(self.repo), "id": "hello"})
        self.assertEqual(status, 202)
        self.wait_end(body["run"])
        self.assertEqual(pp.cancel(self.portal, {"project": str(self.repo), "run": body["run"]})[0], 409, "it already ended")
        f = self.repo / ".amauta" / "pipelines.json"
        f.write_text(f.read_text().replace('"Hello"', '"Hello again"'))
        status, body = pp.run(self.portal, {"project": str(self.repo), "id": "hello"})
        self.assertEqual(status, 403)
        self.assertIn("changed since", body["error"])
        self.assertFalse(pp.list_pipelines(self.portal)["projects"][0]["trusted"])

    def test_a_run_that_cannot_start_says_why(self):
        self.trust()
        old = pp.PYTHON_DIR
        pp.PYTHON_DIR = self.root / "no-such-dir"  # the runner's module cannot be imported
        try:
            status, body = pp.run(self.portal, {"project": str(self.repo), "id": "hello"})
        finally:
            pp.PYTHON_DIR = old
        self.assertEqual(status, 202)
        deadline = time.time() + 20
        while time.time() < deadline:
            r = pp.events(self.portal, {"project": str(self.repo), "run": body["run"], "after": "0"})
            if r["done"]:
                break
            time.sleep(0.2)
        self.assertTrue(r["done"])
        self.assertIn("did not start", r["error"])
        self.assertIn("amauta", r["error"], "the runner's own error is shown")

    def test_modes_and_the_graph_reach_the_card_and_the_run(self):
        f = self.repo / ".amauta" / "pipelines.json"
        data = json.loads(f.read_text())
        data["pipelines"].append({"id": "m", "modes": ["train", "predict"], "schedule": [{"every_minutes": 30, "mode": "predict"}],
                                  "steps": [{"id": "a", "type": "command", "argv": [sys.executable, "-c", "print('a')"]},
                                            {"id": "b", "needs": [], "modes": ["train"], "type": "command", "argv": [sys.executable, "-c", "1"]}]})
        f.write_text(json.dumps(data))
        self.trust()
        card = next(p for p in pp.list_pipelines(self.portal)["projects"][0]["pipelines"] if p["id"] == "m")
        self.assertEqual((card["modes"], card["default_mode"], card["levels"]), (["train", "predict"], "train", [["a", "b"]]))
        self.assertEqual([(s["mode"], s["state"]) for s in card["schedules"]], [("predict", "never")])
        self.assertEqual(card["step_modes"], [None, ["train"]])
        self.assertEqual(pp.run(self.portal, {"project": str(self.repo), "id": "m", "mode": "nope"})[0], 400)
        status, body = pp.run(self.portal, {"project": str(self.repo), "id": "m", "mode": "predict"})
        self.assertEqual(status, 202, body)
        events = self.wait_end(body["run"])
        self.assertEqual(events[0]["mode"], "predict")
        card = next(p for p in pp.list_pipelines(self.portal)["projects"][0]["pipelines"] if p["id"] == "m")
        self.assertEqual(card["history"][0]["mode"], "predict")

    def test_one_broken_project_does_not_empty_the_tab(self):
        from unittest import mock
        real = pp.config.load

        def load(repo, *a, **k):
            if Path(repo) == self.repo:
                raise TypeError("unhashable type: 'list'")
            return real(repo, *a, **k)
        with mock.patch.object(pp.config, "load", load):
            r = pp.list_pipelines(self.portal)
        proj = next(p for p in r["projects"] if p["path"] == str(self.repo))
        self.assertIn("unhashable", proj["error"])

    def test_a_schedule_without_mode_follows_the_default_mode(self):
        from python.amauta.extras.pipelines import runner, store
        f = self.repo / ".amauta" / "pipelines.json"
        data = json.loads(f.read_text())
        data["pipelines"].append({"id": "m", "modes": ["train", "predict"], "default_mode": "predict", "schedule": {"every_minutes": 30},
                                  "steps": [{"type": "command", "argv": [sys.executable, "-c", "1"]}]})
        f.write_text(json.dumps(data))
        runner.run(self.repo, "m", store.new_run(self.state, self.repo, "m"), trigger="schedule")
        card = next(p for p in pp.list_pipelines(self.portal)["projects"][0]["pipelines"] if p["id"] == "m")
        self.assertEqual(card["schedules"][0]["state"], "ok")

    def test_following_an_abandoned_or_never_started_run_ends(self):
        from python.amauta.extras.pipelines import store
        lost = store.new_run(self.state, self.repo, "hello")
        lost.parent.mkdir(parents=True, exist_ok=True)
        lost.write_text(json.dumps({"t": "2026-11-08T10:00:00+00:00", "kind": "run-start", "pipeline": "hello", "steps": ["Step"]}) + "\n")
        r = pp.events(self.portal, {"project": str(self.repo), "run": lost.name, "after": "0"})
        self.assertTrue(r["done"])
        self.assertIn("abandoned", r["error"])
        empty = store.new_run(self.state, self.repo, "slow")
        empty.touch()
        Path(f"{empty}.log").write_text("ModuleNotFoundError: No module named 'amauta'\n")
        r = pp.events(self.portal, {"project": str(self.repo), "run": empty.name, "after": "0"})
        self.assertTrue(r["done"], "no runner holds its lock: after a portal restart too")
        self.assertIn("did not start", r["error"])

    def test_the_portal_hands_the_trusted_hash_and_the_users_pythonpath_to_the_runner(self):
        from unittest import mock
        import os
        self.trust()
        seen = {}

        class Fake:
            def poll(self):
                return None

        def spawn(argv, env, log, detach):
            seen["argv"], seen["env"] = argv, env
            return Fake()
        with mock.patch.object(pp, "_spawn", spawn), mock.patch.dict(os.environ, {"PYTHONPATH": f"{pp.PYTHON_DIR}{os.pathsep}/my/own"}):
            pp.os.environ.pop("AMAUTA_USER_PYTHONPATH", None)
            self.assertEqual(pp.run(self.portal, {"project": str(self.repo), "id": "hello"})[0], 202)
        self.assertIn("--expect-sha256", seen["argv"])
        self.assertEqual(seen["env"]["AMAUTA_USER_PYTHONPATH"], "/my/own")

    @unittest.skipIf(sys.platform == "win32", "SIGKILL")
    def test_a_killed_runner_does_not_block_the_next_run(self):
        import os
        import signal
        self.trust()
        status, body = pp.run(self.portal, {"project": str(self.repo), "id": "slow"})
        self.assertEqual(status, 202)
        lockfile = pp.store.runs_dir(self.state, self.repo) / "slow.lock"
        deadline = time.time() + 15
        while time.time() < deadline and not (lockfile.exists() and '"starting": false' in lockfile.read_text()):
            time.sleep(0.1)
        os.kill(json.loads(lockfile.read_text())["pid"], signal.SIGKILL)  # the runner, not its step
        time.sleep(0.5)
        status, again = pp.run(self.portal, {"project": str(self.repo), "id": "slow"})
        self.assertEqual(status, 202, again)
        pp.cancel(self.portal, {"project": str(self.repo), "run": again["run"]})
        self.wait_end(again["run"])

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
