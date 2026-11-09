"""Pipelines as a DAG (ADR 0011, odd/tasks/pipelines-dag.md D1-D3): step ids and needs, blocks, sub-pipeline steps,
modes and schedules per mode; then the runner runs ready steps in parallel and a failure skips only its dependents."""

import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from python.amauta.extras.pipelines import config, graph, runner

PY = sys.executable
CMD = lambda code: {"type": "command", "argv": [PY, "-c", code]}  # noqa: E731


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name).resolve() / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)

    def define(self, *pipelines, blocks=None):
        (self.repo / ".amauta").mkdir(exist_ok=True)
        data = {"pipelines": list(pipelines), **({"blocks": blocks} if blocks else {})}
        (self.repo / ".amauta" / "pipelines.json").write_text(json.dumps(data))

    def load(self, pid):
        return next(p for p in config.load(self.repo) if p["id"] == pid)

    def refused(self, *pipelines, blocks=None, msg=""):
        self.define(*pipelines, blocks=blocks)
        with self.assertRaises(config.ConfigError, msg=msg):
            config.load(self.repo)


class GraphConfigTest(Base):
    def test_without_needs_a_pipeline_stays_linear(self):
        self.define({"id": "p", "steps": [{"name": "A", **CMD("1")}, {"name": "B", **CMD("2")}]})
        p = self.load("p")
        self.assertEqual([(s["id"], s["needs"]) for s in p["steps"]], [("s1", []), ("s2", ["s1"])])
        self.assertEqual((p["max_parallel"], p["modes"], p["default_mode"], p["schedules"]), (4, [], None, []))

    def test_needs_make_a_dag_and_bad_references_are_refused(self):
        steps = [{"id": "a", **CMD("1")}, {"id": "b", "needs": ["a"], **CMD("1")}, {"id": "c", "needs": ["a"], **CMD("1")},
                 {"id": "d", "needs": ["b", "c"], **CMD("1")}, {"id": "e", "needs": [], **CMD("1")}]
        self.define({"id": "p", "max_parallel": 2, "steps": steps})
        self.assertEqual(graph.levels(self.load("p")["steps"]), [["a", "e"], ["b", "c"], ["d"]])
        self.refused({"id": "p", "steps": [{"id": "a", "needs": ["zz"], **CMD("1")}]}, msg="unknown need")
        self.refused({"id": "p", "steps": [{"id": "a", "needs": ["b"], **CMD("1")}, {"id": "b", "needs": ["a"], **CMD("1")}]}, msg="cycle")
        self.refused({"id": "p", "steps": [{"id": "a", **CMD("1")}, {"id": "a", **CMD("1")}]}, msg="duplicate")
        self.refused({"id": "p", "max_parallel": 0, "steps": [CMD("1")]}, msg="max_parallel")
        self.refused({"id": "p", "steps": [{"id": "A b", **CMD("1")}]}, msg="step id")

    def test_blocks_are_step_templates(self):
        blocks = {"clean": {"type": "python", "script": "etl/clean.py", "timeout": 60}}
        self.define({"id": "p", "steps": [{"id": "c1", "use": "clean", "args": ["sales"]},
                                          {"id": "c2", "use": "clean", "args": ["clients"], "timeout": 90}]}, blocks=blocks)
        s = self.load("p")["steps"]
        self.assertEqual([(x["script"], x["args"], x["timeout"]) for x in s], [("etl/clean.py", ["sales"], 60), ("etl/clean.py", ["clients"], 90)])
        self.refused({"id": "p", "steps": [{"use": "nope"}]}, blocks=blocks, msg="unknown block")
        self.refused({"id": "p", "steps": [{"use": "clean"}]}, blocks={"clean": {"use": "x"}}, msg="a block does not use another")

    def test_a_sub_pipeline_step_expands_in_place(self):
        clean = {"id": "clean", "steps": [{"id": "load", **CMD("1")}, {"id": "dedupe", **CMD("1")}, {"id": "nulls", "needs": ["load"], **CMD("1")}]}
        sales = {"id": "sales", "steps": [{"id": "fetch", **CMD("1")}, {"id": "c", "name": "Clean", "type": "pipeline", "pipeline": "clean"},
                                          {"id": "train", "needs": ["c"], **CMD("1")}]}
        self.define(clean, sales)
        s = self.load("sales")["steps"]
        self.assertEqual([(x["id"], x["needs"]) for x in s],
                         [("fetch", []), ("c.load", ["fetch"]), ("c.dedupe", ["c.load"]), ("c.nulls", ["c.load"]), ("train", ["c.dedupe", "c.nulls"])])
        self.assertEqual(s[1]["name"], "Clean › load")
        self.refused({"id": "a", "steps": [{"type": "pipeline", "pipeline": "b"}]}, {"id": "b", "steps": [{"type": "pipeline", "pipeline": "a"}]}, msg="loop")
        self.refused({"id": "a", "steps": [{"type": "pipeline", "pipeline": "zz"}]}, msg="unknown pipeline")

    def test_modes_and_schedules_per_mode(self):
        model = {"id": "m", "modes": ["train", "train-predict", "predict"], "default_mode": "predict",
                 "schedule": [{"at": "06:00", "days": ["mon"], "mode": "train"}, {"at": "07:00", "mode": "predict"}],
                 "steps": [{"id": "features", **CMD("1")}, {"id": "train", "modes": ["train", "train-predict"], "needs": ["features"], **CMD("1")},
                           {"id": "predict", "modes": ["train-predict", "predict"], "needs": ["features", "train"], **CMD("1")}]}
        self.define(model)
        p = self.load("m")
        self.assertEqual((p["default_mode"], [s["modes"] for s in p["steps"]]), ("predict", [None, ["train", "train-predict"], ["train-predict", "predict"]]))
        self.assertEqual([x.get("mode") for x in p["schedules"]], ["train", "predict"])
        self.define({"id": "x", "schedule": {"at": "07:00"}, "steps": [CMD("1")]})
        self.assertEqual(self.load("x")["schedules"], [{"at": "07:00"}], "one schedule object still works")
        self.refused({**model, "default_mode": "nope"}, msg="default_mode")
        self.refused({**model, "steps": [{"modes": ["nope"], **CMD("1")}]}, msg="step mode")
        self.refused({"id": "x", "steps": [{"modes": ["train"], **CMD("1")}]}, msg="modes without pipeline modes")
        self.refused({**model, "schedule": [{"at": "06:00", "mode": "nope"}]}, msg="schedule mode")
        self.refused({"id": "x", "schedule": {"at": "06:00", "mode": "train"}, "steps": [CMD("1")]}, msg="mode without modes")


class Run(Base):
    def run_events(self, pid, **kw):
        events = Path(self.tmp.name) / f"{pid}-{time.time_ns()}.jsonl"
        code = runner.run(self.repo, pid, events, python=PY, **kw)
        return code, [json.loads(x) for x in events.read_text().split("\n") if x]

    def ends(self, ev):
        return {e["id"]: e["status"] for e in ev if e["kind"] == "step-end"}


class DagRunTest(Run):
    def test_independent_steps_run_in_parallel(self):
        sleep = CMD("import time; time.sleep(1)")
        self.define({"id": "p", "max_parallel": 2, "steps": [{"id": "a", "needs": [], **sleep}, {"id": "b", "needs": [], **sleep},
                                                             {"id": "c", "needs": ["a", "b"], **CMD("print('c')")}]})
        t0 = time.time()
        code, ev = self.run_events("p")
        self.assertEqual(code, 0)
        self.assertLess(time.time() - t0, 1.9, "a and b side by side")
        self.assertEqual(self.ends(ev), {"a": "ok", "b": "ok", "c": "ok"})
        self.assertEqual(ev[0]["needs"], {"a": [], "b": [], "c": ["a", "b"]}, "run-start carries the graph for the page")

    def test_a_failure_skips_only_its_dependents(self):
        self.define({"id": "p", "steps": [{"id": "a", **CMD("import sys; sys.exit(2)")}, {"id": "b", "needs": ["a"], **CMD("1")},
                                          {"id": "x", "needs": [], **CMD("print('x')")}, {"id": "y", "needs": ["x"], **CMD("1")}]})
        code, ev = self.run_events("p")
        self.assertEqual(code, 1)
        self.assertEqual(self.ends(ev), {"a": "failed", "b": "skipped", "x": "ok", "y": "ok"})
        self.assertEqual(next(e for e in ev if e.get("id") == "b" and e["kind"] == "step-end")["reason"], "needs")

    def test_modes_switch_steps_and_a_skipped_mode_step_still_satisfies(self):
        self.define({"id": "m", "modes": ["train", "predict"], "default_mode": "predict", "steps": [
            {"id": "features", **CMD("print('f')")}, {"id": "train", "modes": ["train"], **CMD("print('t')")},
            {"id": "predict", "modes": ["predict"], "needs": ["features", "train"], **CMD("print('p')")}]})
        code, ev = self.run_events("m")
        self.assertEqual((code, ev[0]["mode"]), (0, "predict"))
        self.assertEqual(self.ends(ev), {"features": "ok", "train": "skipped", "predict": "ok"})
        code, ev = self.run_events("m", mode="train")
        self.assertEqual(self.ends(ev), {"features": "ok", "train": "ok", "predict": "skipped"})
        with self.assertRaises(config.ConfigError):
            self.run_events("m", mode="nope")


class RobustRunTest(Run):
    """Review R3-R8."""

    def test_a_background_child_does_not_hold_the_step(self):
        bg = "import subprocess, sys; subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(8)']); print('bg')"
        self.define({"id": "p", "steps": [{"id": "a", "timeout": 2, **CMD(bg)}]})
        t0 = time.time()
        code, ev = self.run_events("p")
        self.assertLess(time.time() - t0, 4)
        self.assertEqual(self.ends(ev), {"a": "ok"})
        hold = "import subprocess, sys, time; subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(8)']); time.sleep(8)"
        self.define({"id": "p", "steps": [{"id": "a", "timeout": 1, **CMD(hold)}]})
        t0 = time.time()
        code, ev = self.run_events("p")
        self.assertLess(time.time() - t0, 4)
        self.assertEqual(self.ends(ev), {"a": "timeout"})

    @unittest.skipIf(sys.platform == "win32", "signals")
    def test_a_runner_that_is_stopped_still_ends_its_run(self):
        import os
        import signal
        self.define({"id": "p", "steps": [{"id": "a", **CMD("import time; print('go', flush=True); time.sleep(30)")}]})
        from python.amauta.extras.pipelines import store
        events = store.new_run(self.tmp.name, self.repo, "p")  # --events must sit in the runs folder (its lock is there)
        env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
        proc = subprocess.Popen([PY, "-m", "amauta.extras.pipelines", "run", "p", "--cwd", str(self.repo), "--events", str(events),
                                 "--state-dir", self.tmp.name], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + 10
        while time.time() < deadline and "go" not in (events.read_text() if events.exists() else ""):
            time.sleep(0.1)
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=10)
        ev = [json.loads(x) for x in events.read_text().split("\n") if x]
        self.assertEqual((ev[-1]["kind"], ev[-1]["status"]), ("run-end", "cancelled"))
        self.assertFalse((events.parent / "p.lock").exists())

    def test_the_users_pythonpath_and_paths_from_the_project_root(self):
        import os
        (self.repo / "etl").mkdir()
        (self.repo / "etl" / "show.py").write_text("import os; print('pp=' + os.environ.get('PYTHONPATH', ''))\n")
        self.define({"id": "p", "steps": [{"id": "a", "type": "python", "script": "etl/show.py", "cwd": "etl"}]})
        amauta_dir = str(Path(runner.__file__).resolve().parents[3])
        old = os.environ.get("PYTHONPATH")
        os.environ["PYTHONPATH"] = os.pathsep.join(["/user/src", amauta_dir])
        try:
            code, ev = self.run_events("p")
        finally:
            os.environ.pop("PYTHONPATH") if old is None else os.environ.__setitem__("PYTHONPATH", old)
        self.assertEqual(code, 0, ev)
        self.assertIn("pp=/user/src", [e.get("text") for e in ev])

    @unittest.skipIf(sys.platform == "win32", "symlinks need privileges on Windows")
    def test_a_symlink_out_of_the_project_is_refused_and_a_missing_cwd_is_named(self):
        from python.amauta.extras.pipelines import check
        outside = Path(self.tmp.name) / "outside.py"
        outside.write_text("print('escaped')\n")
        (self.repo / "link.py").symlink_to(outside)
        self.define({"id": "p", "steps": [{"id": "a", "type": "python", "script": "link.py"}]},
                    {"id": "q", "steps": [{"id": "a", "cwd": "nowhere", **CMD("1")}]})
        code, ev = self.run_events("p")
        self.assertEqual(code, 1)
        self.assertTrue(any("outside the project" in e.get("text", "") for e in ev))
        self.assertTrue(any("outside the project" in f["message"] for f in check.check(self.repo, "p", python=PY)))
        code, ev = self.run_events("q")
        self.assertTrue(any("cwd nowhere is not a folder" in e.get("text", "") for e in ev))

    def test_outputs_must_change_whatever_the_clock_says(self):
        (self.repo / "src.csv").write_text("a,b,c\n")
        (self.repo / "out.csv").write_text("a\n")
        import os
        old = time.time() - 3600
        os.utime(self.repo / "src.csv", (old, old))
        os.utime(self.repo / "out.csv", (old, old))
        copy = "import shutil; shutil.copy2('src.csv', 'out.csv')"  # keeps the source's old mtime
        self.define({"id": "p", "steps": [{"id": "a", "outputs": ["out.csv"], **CMD(copy)}]})
        code, ev = self.run_events("p")
        self.assertEqual(code, 0, [e.get("text") for e in ev])

    def test_a_private_key_block_is_redacted_line_by_line(self):
        dash = "-" * 5
        (self.repo / "pem.py").write_text(f"print('{dash}BEGIN RSA PRIVATE KEY{dash}')\nprint('MIIEowIBAAKCAQEAx' + 'Q' * 40)\n"
                                          f"print('{dash}END RSA PRIVATE KEY{dash}')\nprint('after')\n")
        self.define({"id": "p", "steps": [{"id": "a", "type": "python", "script": "pem.py"}]})
        code, ev = self.run_events("p")
        texts = [e["text"] for e in ev if e["kind"] == "line"]
        self.assertNotIn("Q" * 40, json.dumps(ev))
        self.assertEqual(texts[-1], "after")


class LoopTest(Base):
    """Loops between pipelines (the user's worry: A runs B and B runs A) never run forever."""

    def test_loops_in_the_definition_are_refused_when_the_file_is_read(self):
        use = lambda p: {"type": "pipeline", "pipeline": p}  # noqa: E731
        self.refused({"id": "a", "steps": [use("a")]}, msg="A uses A")
        self.refused({"id": "a", "steps": [use("b")]}, {"id": "b", "steps": [CMD("1"), use("c")]}, {"id": "c", "steps": [use("a")]},
                     msg="A > B > C > A")
        self.define({"id": "a", "steps": [use("b")]}, {"id": "b", "steps": [use("a")]})
        with self.assertRaisesRegex(config.ConfigError, "loop: a > b > a"):
            config.load(self.repo)

    def test_a_loop_closed_at_run_time_stops_at_the_lock(self):
        import shutil
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        cli = [node, str(Path(__file__).resolve().parents[2] / "bin" / "amauta.js"), "pipeline", "run"]
        tail = ["--cwd", str(self.repo), "--state-dir", self.tmp.name]
        self.define({"id": "a", "steps": [{"type": "command", "argv": cli + ["b"] + tail}]},
                    {"id": "b", "steps": [{"type": "command", "argv": cli + ["a"] + tail}]})
        t0 = time.time()
        r = subprocess.run(cli + ["a"] + tail, capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 1)
        self.assertIn("a is already running", r.stdout + r.stderr)
        self.assertLess(time.time() - t0, 30)


class SecondReviewRunTest(Run):
    """Second review, V1."""

    def test_a_failure_blocks_the_whole_chain_below_it(self):
        self.define({"id": "p", "steps": [{"id": "a", **CMD("import sys; sys.exit(1)")}, {"id": "b", **CMD("print('B ran')")},
                                          {"id": "c", **CMD("print('C ran')")}]})
        code, ev = self.run_events("p")
        self.assertEqual(self.ends(ev), {"a": "failed", "b": "skipped", "c": "skipped"})
        self.assertNotIn("C ran", json.dumps(ev))
        self.assertEqual({e["id"]: e.get("reason") for e in ev if e["kind"] == "step-end" and e["id"] != "a"}, {"b": "needs", "c": "needs"})

    def test_an_error_inside_a_step_fails_that_step_only(self):
        from unittest import mock
        from python.amauta.extras.pipelines import proc
        self.define({"id": "p", "steps": [{"id": "bad", "needs": [], **CMD("1")}, {"id": "good", "needs": [], **CMD("print('ok')")}]})
        real = proc.run

        def boom(step, *a, **k):
            if step["id"] == "bad":
                raise ValueError("embedded null byte")
            return real(step, *a, **k)
        with mock.patch.object(proc, "run", boom):
            code, ev = self.run_events("p")
        self.assertEqual((code, self.ends(ev)), (1, {"bad": "failed", "good": "ok"}))
        self.assertTrue(any("embedded null byte" in e.get("text", "") for e in ev))

    @unittest.skipIf(sys.platform == "win32", "process groups")
    def test_a_background_child_without_the_pipe_is_stopped_when_the_step_ends(self):
        import os
        pidfile = Path(self.tmp.name) / "child.pid"
        code = ("import subprocess, sys; p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(20)'], "
                f"stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); open({str(pidfile)!r}, 'w').write(str(p.pid))")
        self.define({"id": "p", "steps": [{"id": "a", **CMD(code)}]})
        self.run_events("p")
        pid = int(pidfile.read_text())
        time.sleep(0.5)
        try:
            os.kill(pid, 0)
            alive = not Path(f"/proc/{pid}/status").exists() or "zombie" not in Path(f"/proc/{pid}/status").read_text()
        except ProcessLookupError:
            alive = False
        self.assertFalse(alive, "the step's leftover child must be stopped")


class SecondReviewConfigTest(Base):
    """Second review, V3: types that slipped through, input mutation, BOM, pipeline steps."""

    def test_wrong_types_and_nul_characters_are_refused(self):
        for bad in ({"argv": ["echo\u0000x"]}, {"argv": ["x"], "cwd": "a\u0000"}, {"argv": ["x"], "timeout": True},
                    {"argv": ["x"], "enabled": "false"}, {"argv": ["x"], "interpreter": "py\u0000"}):
            self.refused({"id": "p", "steps": [{"type": "command", **bad}]}, msg=str(bad))
        self.refused({"id": "p", "steps": [{"type": "python", "script": "a.py", "args": "--week"}]}, msg="args as a string")
        self.refused({"id": "p", "modes": ["a", "a"], "steps": [CMD("1")]}, msg="duplicate modes")
        self.refused({"id": "p", "modes": ["a"], "steps": [{"modes": [["a"]], **CMD("1")}]}, msg="unhashable step mode")
        self.refused({"id": "p", "default_mode": "x", "steps": [CMD("1")]}, msg="default_mode without modes")

    def test_a_pipeline_step_takes_only_its_own_fields_and_can_be_off(self):
        inner = {"id": "x", "steps": [{"id": "s1", **CMD("1")}, {"id": "s2", **CMD("1")}]}
        self.refused(inner, {"id": "p", "steps": [{"type": "pipeline", "pipeline": "x", "timeout": "junk"}]}, msg="extra field")
        self.define(inner, {"id": "p", "steps": [{"id": "x", "type": "pipeline", "pipeline": "x", "enabled": False}]})
        self.assertEqual([s["enabled"] for s in self.load("p")["steps"]], [False, False])

    def test_parsing_does_not_change_its_input_and_a_bom_is_fine(self):
        data = {"pipelines": [{"id": "m", "modes": ["train"], "schedule": [{"at": "07:00", "mode": "train"}], "steps": [CMD("1")]}]}
        first, second = config.parse(data), config.parse(data)
        self.assertEqual(first[0]["schedules"], second[0]["schedules"])
        (self.repo / ".amauta").mkdir(exist_ok=True)
        (self.repo / ".amauta" / "pipelines.json").write_bytes(b"\xef\xbb\xbf" + json.dumps({"pipelines": [{"id": "p", "steps": [CMD("1")]}]}).encode())
        self.assertEqual(config.load(self.repo)[0]["id"], "p")


class SecondReviewStoreTest(Run):
    """Second review, V4."""

    def test_a_summary_keeps_steps_in_pipeline_order_with_their_id(self):
        from python.amauta.extras.pipelines import store
        self.define({"id": "p", "steps": [{"id": "slow", "needs": [], **CMD("import time; time.sleep(0.6)")},
                                          {"id": "fast", "needs": [], **CMD("import sys; sys.exit(1)")}]})
        state = Path(self.tmp.name) / "state"
        runner.run(self.repo, "p", store.new_run(state, self.repo, "p"), python=PY)
        steps = store.history(state, self.repo)["p"]["runs"][0]["steps"]
        self.assertEqual([(s["id"], s["status"]) for s in steps], [("slow", "ok"), ("fast", "failed")])

    def test_run_names_are_unique_within_a_second(self):
        from python.amauta.extras.pipelines import store
        names = {store.new_run(self.tmp.name, self.repo, "p").name for _ in range(50)}
        self.assertEqual(len(names), 50)

    def test_the_runner_refuses_a_definition_that_changed_after_the_check(self):
        import hashlib
        self.define({"id": "p", "steps": [CMD("1")]})
        sha = hashlib.sha256((self.repo / ".amauta" / "pipelines.json").read_bytes()).hexdigest()
        self.assertEqual(config.load(self.repo, expect_sha256=sha)[0]["id"], "p")
        self.define({"id": "p", "steps": [CMD("2")]})
        with self.assertRaisesRegex(config.ConfigError, "changed"):
            runner.run(self.repo, "p", Path(self.tmp.name) / "x.jsonl", python=PY, expect_sha256=sha)

    def test_amautas_folder_never_reaches_a_step(self):
        import os
        from python.amauta.extras.pipelines import proc
        old = {k: os.environ.get(k) for k in ("PYTHONPATH", "AMAUTA_USER_PYTHONPATH")}
        os.environ["AMAUTA_USER_PYTHONPATH"] = os.pathsep.join([proc.AMAUTA_PYTHON, "/my/own"])
        try:
            self.assertEqual(proc.step_env({})["PYTHONPATH"], "/my/own")
        finally:
            for k, v in old.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)


class ThirdReviewProcTest(Run):
    """Third review, F1."""

    @unittest.skipIf(sys.platform == "win32", "zombies are POSIX")
    def test_a_zombie_holder_is_dead(self):
        from python.amauta.extras.pipelines import lock, pidinfo
        f = Path(self.tmp.name) / "p.lock"
        code = f"import sys; sys.path.insert(0, {str(Path(lock.__file__).resolve().parents[3])!r}); from amauta.extras.pipelines import lock; lock.take({str(f)!r}, 'r')"
        child = subprocess.Popen([PY, "-c", code])
        deadline = time.time() + 10
        while child.poll() is None and time.time() < deadline:  # poll reaps; wait for the exit without reaping instead
            time.sleep(0.05)
            if f.exists():
                break
        time.sleep(0.5)  # it has exited by now and stays a zombie: nobody waited for it
        self.assertFalse(pidinfo.alive(child.pid), "a zombie is not alive")
        self.assertTrue(lock.take(f, "next"))
        child.wait()

    def test_a_trivial_step_costs_no_tenth_of_a_second(self):
        self.define({"id": "p", "steps": [CMD("pass") for _ in range(40)]})
        t0 = time.time()
        code, _ = self.run_events("p")
        self.assertEqual(code, 0)
        self.assertLess(time.time() - t0, 3.5, "40 steps")

    @unittest.skipIf(sys.platform == "win32", "a new session is POSIX; Windows uses a job")
    def test_a_detached_child_holding_the_output_does_not_hold_the_step(self):
        leave = "import subprocess, sys; subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(15)'], start_new_session=True); print('started')"
        self.define({"id": "p", "steps": [{"id": "a", "timeout": 30, **CMD(leave)}]})
        t0 = time.time()
        code, ev = self.run_events("p")
        self.assertLess(time.time() - t0, 7)
        self.assertEqual(self.ends(ev), {"a": "ok"})
        self.assertTrue(any("still holds its output" in e.get("text", "") for e in ev))
        hold = leave + "; import time; time.sleep(30)"
        self.define({"id": "p", "steps": [{"id": "a", "timeout": 1, **CMD(hold)}]})
        t0 = time.time()
        code, ev = self.run_events("p")
        self.assertLess(time.time() - t0, 7)
        self.assertEqual(self.ends(ev), {"a": "timeout"})

    def test_skipped_steps_do_not_wait_for_a_slot(self):
        off = {"enabled": False, **CMD("1")}
        self.define({"id": "p", "max_parallel": 1, "steps": [{"id": "slow", "needs": [], **CMD("import time; time.sleep(1.5)")},
                                                             {"id": "o1", "needs": [], **off}, {"id": "o2", "needs": [], **off}]})
        code, ev = self.run_events("p")
        order = [e["id"] for e in ev if e["kind"] == "step-end"]
        self.assertEqual(order[-1], "slow", f"off steps end at once: {order}")

    def test_a_setup_error_still_releases_the_lock(self):
        from unittest import mock
        self.define({"id": "p", "steps": [CMD("1")]})
        events = Path(self.tmp.name) / "s.jsonl"
        with mock.patch.object(runner, "_Events", side_effect=OSError("disk full")), self.assertRaises(OSError):
            runner.run(self.repo, "p", events, python=PY)
        self.assertFalse((Path(self.tmp.name) / "p.lock").exists())
