"""Pipelines (plan S1a, ADR 0010): steps from `.amauta/pipelines.json` run in order without a shell; every output line
becomes an event (secrets redacted); a failed step stops the run; timeouts and cancellation stop the whole process tree.
"""

import io
import json
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from python.amauta.extras.pipelines import config, runner
from python.amauta.extras.pipelines.__main__ import main

PY = sys.executable
SECRET = "AKIA" + "Q" * 16


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.repo = self.root / "repo"
        (self.repo / "etl").mkdir(parents=True)
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        self.state = self.root / "state"
        (self.repo / "etl" / "extract.py").write_text("import sys\nprint('rows read: 3')\nprint('arg', sys.argv[1])\n")
        (self.repo / "etl" / "leak.py").write_text(f"print('token is {SECRET}')\n")
        (self.repo / "etl" / "fail.py").write_text("import sys\nprint('about to fail')\nsys.exit(3)\n")
        (self.repo / "etl" / "slow.py").write_text("import time\nprint('started', flush=True)\ntime.sleep(30)\n")

    def define(self, *pipelines):
        (self.repo / ".amauta").mkdir(exist_ok=True)
        (self.repo / ".amauta" / "pipelines.json").write_text(json.dumps({"pipelines": list(pipelines)}))

    def events(self, path):
        return [json.loads(line) for line in Path(path).read_text().splitlines()]


class ConfigTest(Base):
    def test_valid_definition_and_every_rule(self):
        self.define({"id": "weekly", "name": "Weekly", "steps": [{"name": "Extract", "type": "python", "script": "etl/extract.py", "args": ["x"]}]})
        ps = config.load(self.repo)
        self.assertEqual(ps[0]["id"], "weekly")
        self.assertEqual(ps[0]["steps"][0]["timeout"], 3600)
        bad = [
            {"id": "../x", "steps": [{"type": "command", "argv": ["a"]}]},
            {"id": "a", "steps": [{"type": "shell", "argv": ["a"]}]},
            {"id": "a", "steps": [{"type": "command", "argv": "echo hi"}]},
            {"id": "a", "steps": [{"type": "python", "script": "/etc/x.py"}]},
            {"id": "a", "steps": [{"type": "python", "script": "../out.py"}]},
            {"id": "a", "steps": [{"type": "command", "argv": ["curl", f"-H", f"Authorization: Bearer {'x' * 30}"]}]},
            {"id": "a", "steps": []},
        ]
        for p in bad:
            self.define(p)
            with self.assertRaises(config.ConfigError, msg=json.dumps(p)[:80]):
                config.load(self.repo)
        self.define({"id": "a", "steps": [{"type": "command", "argv": ["x"]}]}, {"id": "a", "steps": [{"type": "command", "argv": ["y"]}]})
        with self.assertRaises(config.ConfigError):
            config.load(self.repo)

    def test_no_file_means_no_pipelines(self):
        self.assertEqual(config.load(self.repo), [])


class RunTest(Base):
    def run_pipeline(self, pid, **kw):
        events = self.root / f"{pid}.jsonl"
        code = runner.run(self.repo, pid, events, python=PY, **kw)
        return code, self.events(events)

    def test_lines_stream_in_order_and_a_failure_stops_the_run(self):
        self.define({"id": "p", "name": "P", "steps": [
            {"name": "Extract", "type": "python", "script": "etl/extract.py", "args": ["$(id)"]},
            {"name": "Leak", "type": "python", "script": "etl/leak.py"},
            {"name": "Fail", "type": "python", "script": "etl/fail.py"},
            {"name": "Never", "type": "command", "argv": [PY, "-c", "print('never')"]},
            {"name": "Off", "type": "command", "argv": [PY, "-c", "print('off')"], "enabled": False}]})
        code, ev = self.run_pipeline("p")
        self.assertEqual(code, 1)
        lines = [e["text"] for e in ev if e["kind"] == "line"]
        self.assertEqual(lines[:2], ["rows read: 3", "arg $(id)"], "argv, no shell: $(id) stays literal")
        self.assertIn("token is [REDACTED_SECRET]", lines)
        self.assertNotIn(SECRET, json.dumps(ev))
        ends = [(e["name"], e["status"]) for e in ev if e["kind"] == "step-end"]
        self.assertEqual(ends, [("Extract", "ok"), ("Leak", "ok"), ("Fail", "failed"), ("Never", "skipped"), ("Off", "skipped")])
        self.assertEqual(ev[-1]["kind"], "run-end")
        self.assertEqual(ev[-1]["status"], "failed")
        self.assertEqual(ev[0]["kind"], "run-start")

    def test_timeout_and_cancel_stop_the_step(self):
        self.define({"id": "slow", "steps": [{"name": "Slow", "type": "python", "script": "etl/slow.py", "timeout": 1}]})
        t0 = time.time()
        code, ev = self.run_pipeline("slow")
        self.assertLess(time.time() - t0, 15)
        self.assertEqual(code, 1)
        self.assertIn(("Slow", "timeout"), [(e["name"], e["status"]) for e in ev if e["kind"] == "step-end"])
        self.define({"id": "slow", "steps": [{"name": "Slow", "type": "python", "script": "etl/slow.py"}]})
        events = self.root / "c.jsonl"
        threading.Timer(1.5, lambda: runner.cancel_path(events).write_text("")).start()
        code = runner.run(self.repo, "slow", events, python=PY)
        self.assertEqual(code, 130)
        self.assertEqual(self.events(events)[-1]["status"], "cancelled")

    def test_an_unknown_pipeline_or_a_missing_command_is_reported(self):
        self.define({"id": "p", "steps": [{"name": "Ghost", "type": "command", "argv": ["no-such-command-amauta"]}]})
        code, ev = self.run_pipeline("p")
        self.assertEqual(code, 1)
        self.assertTrue(any(e["kind"] == "line" and "cannot start" in e["text"] for e in ev))
        with self.assertRaises(config.ConfigError):
            runner.run(self.repo, "missing", self.root / "m.jsonl", python=PY)


class CliTest(Base):
    def cli(self, *args):
        out = io.StringIO()
        with redirect_stdout(out):
            code = main([*args, "--state-dir", str(self.state)])
        return code, out.getvalue()

    def test_list_run_and_status(self):
        self.define({"id": "weekly", "name": "Weekly", "steps": [{"name": "Extract", "type": "python", "script": "etl/extract.py", "args": ["a"]}]})
        code, out = self.cli("list", "--cwd", str(self.repo))
        self.assertEqual(code, 0)
        self.assertIn("weekly", out)
        code, out = self.cli("run", "weekly", "--cwd", str(self.repo), "--python", PY)
        self.assertEqual(code, 0, out)
        self.assertIn("[Extract] rows read: 3", out)
        code, out = self.cli("status", "--cwd", str(self.repo), "--json")
        last = json.loads(out)["weekly"]
        self.assertEqual(last["status"], "ok")
        self.assertTrue(Path(last["events"]).is_file())


if __name__ == "__main__":
    unittest.main()


class ScheduleHintTest(Base):
    """Plan S1c, ADR 0010: amauta prints the operating system's own scheduler entry; it registers nothing."""

    def test_entries_for_each_system_run_the_pipeline_without_a_shell_string_from_amauta(self):
        from python.amauta.extras.pipelines import schedule
        self.define({"id": "weekly", "steps": [{"type": "command", "argv": ["x"]}]})
        node, bin_ = "/usr/bin/node", "/opt/amauta/bin/amauta.js"
        win = schedule.hint("windows", self.repo, "weekly", "07:30", "mon", node=r"C:\\Program Files\\nodejs\\node.exe", bin_=r"C:\\amauta\\bin\\amauta.js")
        self.assertIn('schtasks /Create /TN "amauta weekly"', win)
        self.assertIn("/SC WEEKLY /D MON /ST 07:30", win)
        self.assertIn("pipeline run weekly --trigger schedule --cwd", win)
        cron = schedule.hint("linux", self.repo, "weekly", "07:30", None, node=node, bin_=bin_)
        self.assertTrue(cron.splitlines()[-1].startswith("30 7 * * * "), cron)
        self.assertIn(f"'{node}' '{bin_}' pipeline run weekly --trigger schedule --cwd '{self.repo}'", cron)
        mac = schedule.hint("darwin", self.repo, "weekly", "07:30", "fri", node=node, bin_=bin_)
        self.assertIn("<key>Weekday</key><integer>5</integer>", mac)
        self.assertIn("<string>pipeline</string>", mac)
        self.assertIn("launchctl load", mac)

    def test_bad_times_days_and_unknown_pipelines_are_refused(self):
        from python.amauta.extras.pipelines import schedule
        self.define({"id": "weekly", "steps": [{"type": "command", "argv": ["x"]}]})
        for at, day in (("25:00", None), ("7", None), ("07:30", "someday")):
            with self.assertRaises(ValueError):
                schedule.hint("linux", self.repo, "weekly", at, day, node="n", bin_="b")
        with self.assertRaises(config.ConfigError):
            schedule.hint("linux", self.repo, "nope", "07:00", None, node="n", bin_="b")

    def test_the_cli_prints_the_hint_for_this_system(self):
        self.define({"id": "weekly", "steps": [{"type": "command", "argv": ["x"]}]})
        out = io.StringIO()
        with redirect_stdout(out):
            code = main(["schedule-hint", "weekly", "--at", "06:15", "--cwd", str(self.repo), "--state-dir", str(self.state), "--os", "linux"])
        self.assertEqual(code, 0)
        self.assertIn("15 6 * * *", out.getvalue())


class DesignTest(Base):
    """The orchestrator's interface as reference (plan S1b'): categories, run one step, trigger and duration."""

    def test_category_one_step_and_the_run_summary(self):
        self.define({"id": "p", "name": "P", "category": "Sales", "steps": [
            {"name": "A", "type": "command", "argv": [PY, "-c", "print('a')"]},
            {"name": "B", "type": "command", "argv": [PY, "-c", "print('b')"]}]})
        self.assertEqual(config.load(self.repo)[0]["category"], "Sales")
        events = self.root / "one.jsonl"
        self.assertEqual(runner.run(self.repo, "p", events, python=PY, only=1, trigger="portal"), 0)
        ev = self.events(events)
        self.assertEqual(ev[0]["trigger"], "portal")
        self.assertEqual([(e["name"], e["status"]) for e in ev if e["kind"] == "step-end"], [("A", "skipped"), ("B", "ok")])
        self.assertEqual([e["text"] for e in ev if e["kind"] == "line"], ["b"])
        with self.assertRaises(config.ConfigError):
            runner.run(self.repo, "p", self.root / "bad.jsonl", python=PY, only=5)
        from python.amauta.extras.pipelines import store
        f = store.new_run(self.state, self.repo, "p")
        runner.run(self.repo, "p", f, python=PY, trigger="schedule")
        last = store.last_runs(self.state, self.repo)["p"]
        self.assertEqual((last["status"], last["trigger"]), ("ok", "schedule"))
        self.assertIsInstance(last["seconds"], float)

    def test_a_step_knows_its_pipeline_trigger_and_number(self):
        """So a project script can, for example, send mail only on a scheduled run (the trigger is not a secret)."""
        show = "import os; print(os.environ['AMAUTA_PIPELINE'], os.environ['AMAUTA_PIPELINE_TRIGGER'], os.environ['AMAUTA_PIPELINE_STEP'])"
        self.define({"id": "p", "steps": [{"name": "A", "type": "command", "argv": [PY, "-c", "print(1)"]},
                                          {"name": "B", "type": "command", "argv": [PY, "-c", show]}]})
        events = self.root / "env.jsonl"
        self.assertEqual(runner.run(self.repo, "p", events, python=PY, trigger="schedule"), 0)
        self.assertIn("p schedule 2", [e["text"] for e in self.events(events) if e["kind"] == "line"])

