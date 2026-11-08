"""Pipelines (plan S1a, ADR 0010): steps from `.amauta/pipelines.json` run in order without a shell; every output line
becomes an event (secrets redacted); a failed step stops the run; timeouts and cancellation stop the whole process tree.
"""

import io
import json
import os
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



class ReliabilityTest(Base):
    """A transient failure retries on its own; a step that claims success must have refreshed the files it names."""

    def setUp(self):
        super().setUp()
        flaky = "import pathlib, sys\nc = pathlib.Path('count.txt')\nn = int(c.read_text()) + 1 if c.exists() else 1\n"
        flaky += "c.write_text(str(n))\nprint('attempt', n)\nsys.exit(0 if n >= int(sys.argv[1]) else 1)\n"
        (self.repo / "etl" / "flaky.py").write_text(flaky)
        (self.repo / "etl" / "write.py").write_text("import pathlib\npathlib.Path('out').mkdir(exist_ok=True)\npathlib.Path('out/a.csv').write_text('x,y\\n1,2\\n')\n")
        (self.repo / "etl" / "noop.py").write_text("print('did nothing')\n")

    def run_events(self, pid):
        events = self.root / f"{pid}-{time.time_ns()}.jsonl"
        return runner.run(self.repo, pid, events, python=PY), self.events(events)

    def test_retries_until_ok_or_spent(self):
        step = {"name": "Flaky", "type": "python", "script": "etl/flaky.py", "args": ["3"], "retries": 2, "retry_delay": 0}
        self.define({"id": "p", "steps": [step]})
        code, ev = self.run_events("p")
        self.assertEqual(code, 0)
        self.assertEqual([e["attempt"] for e in ev if e["kind"] == "step-retry"], [2, 3])
        self.assertEqual(ev[-2]["attempts"], 3)
        (self.repo / "count.txt").unlink()
        self.define({"id": "p", "steps": [{**step, "retries": 1}]})
        code, ev = self.run_events("p")
        self.assertEqual(code, 1)
        self.assertEqual((ev[-2]["status"], ev[-2]["attempts"]), ("failed", 2))

    def test_outputs_must_be_refreshed_by_the_step(self):
        self.define({"id": "w", "steps": [{"name": "Write", "type": "python", "script": "etl/write.py", "outputs": ["out/a.csv"]}]},
                    {"id": "n", "steps": [{"name": "Noop", "type": "python", "script": "etl/noop.py", "outputs": ["out/a.csv"]}]},
                    {"id": "m", "steps": [{"name": "Noop", "type": "python", "script": "etl/noop.py", "outputs": ["out/missing.csv"]}]})
        code, ev = self.run_events("w")
        self.assertEqual(code, 0)
        self.assertEqual([(o["path"], o["bytes"]) for o in ev[-2]["outputs"]], [("out/a.csv", 8)])
        old = time.time() - 3600
        os.utime(self.repo / "out" / "a.csv", (old, old))
        code, ev = self.run_events("n")
        self.assertEqual((code, ev[-2]["status"]), (1, "failed"))
        self.assertTrue(any("out/a.csv was not updated" in e.get("text", "") for e in ev))
        code, ev = self.run_events("m")
        self.assertTrue(any("out/missing.csv was not written" in e.get("text", "") for e in ev))

    def test_bad_retry_and_output_fields_are_refused(self):
        base = {"type": "command", "argv": ["x"]}
        for extra in ({"retries": -1}, {"retries": 6}, {"retries": "2"}, {"retry_delay": 4000}, {"outputs": "out/a.csv"},
                      {"outputs": ["/etc/passwd"]}, {"outputs": ["../x"]}):
            self.define({"id": "a", "steps": [{**base, **extra}]})
            with self.assertRaises(config.ConfigError, msg=str(extra)):
                config.load(self.repo)


class DeclaredScheduleTest(Base):
    """`schedule` in pipelines.json: the hint is built from it and the portal can tell when a scheduled run is missing."""

    def test_the_four_shapes_are_validated(self):
        ok = [{"at": "07:30"}, {"at": "07:30", "days": ["mon", "thu"]}, {"at": "06:00", "day_of_month": 1}, {"every_minutes": 30}]
        for sched in ok:
            self.define({"id": "a", "schedule": sched, "steps": [{"type": "command", "argv": ["x"]}]})
            got = config.load(self.repo)[0]["schedules"][0]
            self.assertEqual(got["at"] if "at" in sched else got["every_minutes"], sched.get("at", 30))
        bad = [{"at": "7"}, {"at": "07:30", "days": ["someday"]}, {"at": "07:30", "days": []}, {"at": "07:30", "day_of_month": 31},
               {"every_minutes": 7}, {"at": "07:30", "every_minutes": 30}, {"days": ["mon"]}, "daily"]
        for sched in bad:
            self.define({"id": "a", "schedule": sched, "steps": [{"type": "command", "argv": ["x"]}]})
            with self.assertRaises(config.ConfigError, msg=str(sched)):
                config.load(self.repo)

    def test_hints_follow_the_declared_schedule(self):
        from python.amauta.extras.pipelines import schedule
        cases = {
            "w": ({"at": "07:30", "days": ["mon", "thu"]}, "/SC WEEKLY /D MON,THU /ST 07:30", "30 7 * * 1,4 ", "<key>Weekday</key><integer>4</integer>"),
            "m": ({"at": "06:00", "day_of_month": 1}, "/SC MONTHLY /D 1 /ST 06:00", "0 6 1 * * ", "<key>Day</key><integer>1</integer>"),
            "i": ({"every_minutes": 30}, "/SC MINUTE /MO 30", "*/30 * * * * ", "<key>StartInterval</key><integer>1800</integer>"),
            "h": ({"every_minutes": 120}, "/SC HOURLY /MO 2", "0 */2 * * * ", "<key>StartInterval</key><integer>7200</integer>"),
            "d": ({"every_minutes": 1440}, "/SC DAILY /ST 00:00", "0 0 * * * ", "<key>StartInterval</key><integer>86400</integer>"),
        }
        self.define(*[{"id": k, "schedule": v[0], "steps": [{"type": "command", "argv": ["x"]}]} for k, v in cases.items()])
        for pid, (_, win, cron, mac) in cases.items():
            self.assertIn(win, schedule.hint("windows", self.repo, pid, None, None, node="n", bin_="b"))
            self.assertTrue(schedule.hint("linux", self.repo, pid, None, None, node="n", bin_="b").splitlines()[-1].startswith(cron), pid)
            self.assertIn(mac, schedule.hint("darwin", self.repo, pid, None, None, node="n", bin_="b"))
        self.assertIn("/SC DAILY /ST 05:00", schedule.hint("windows", self.repo, "w", "05:00", None, node="n", bin_="b"), "--at overrides")
        cron = schedule.hint("linux", self.repo, "w", None, None, node="n", bin_="b")
        self.assertIn(" env PATH=", cron, "cron runs with a minimal PATH: the hint carries this one")
        self.assertIn("<key>EnvironmentVariables</key><dict><key>PATH</key>", schedule.hint("darwin", self.repo, "w", None, None, node="n", bin_="b"))

    def test_one_entry_per_schedule_each_with_its_mode(self):
        from python.amauta.extras.pipelines import schedule
        self.define({"id": "m", "modes": ["train", "predict"], "steps": [{"type": "command", "argv": ["x"]}],
                     "schedule": [{"at": "06:00", "days": ["mon"], "mode": "train"}, {"at": "07:00", "mode": "predict"}]})
        win = schedule.hint("windows", self.repo, "m", None, None, node="n", bin_="b")
        self.assertIn('/TN "amauta m train" /SC WEEKLY /D MON /ST 06:00', win)
        self.assertIn('/TN "amauta m predict" /SC DAILY /ST 07:00', win)
        self.assertIn("pipeline run m --trigger schedule --mode predict --cwd", win)

    @unittest.skipIf(sys.platform == "win32", "time.tzset is POSIX")
    def test_the_missed_check_uses_local_wall_time_across_a_clock_change(self):
        import os as _os
        from datetime import datetime
        from python.amauta.extras.pipelines import schedule
        old = _os.environ.get("TZ")
        _os.environ["TZ"] = "America/New_York"
        time.tzset()
        try:
            sat = {"at": "07:00", "days": ["sat"]}
            # Saturday 31 Oct 2026 07:00 EDT ran; on Monday 2 Nov (EST, after the change) it is not missed.
            self.assertEqual(schedule.state(sat, "2026-10-31T11:00:05+00:00", datetime(2026, 11, 2, 9, 0)), "ok")
        finally:
            _os.environ.pop("TZ") if old is None else _os.environ.__setitem__("TZ", old)
            time.tzset()

    def test_a_missing_scheduled_run_is_noticed(self):
        from datetime import datetime, timezone
        from python.amauta.extras.pipelines import schedule
        now = datetime(2026, 11, 9, 9, 0, tzinfo=timezone.utc)  # a Monday
        weekly = {"at": "07:30", "days": ["mon"]}
        self.assertEqual(schedule.expected_before(weekly, now), datetime(2026, 11, 9, 7, 30, tzinfo=timezone.utc))
        self.assertEqual(schedule.expected_before({"at": "10:00", "day_of_month": 1}, now), datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc))
        self.assertEqual(schedule.state(weekly, None, now), "never")
        self.assertEqual(schedule.state(weekly, "2026-11-09T07:30:05+00:00", now), "ok")
        self.assertEqual(schedule.state(weekly, "2026-11-02T07:30:05+00:00", now), "missed")
        self.assertEqual(schedule.state(weekly, "2026-11-02T07:30:05+00:00", datetime(2026, 11, 9, 7, 40, tzinfo=timezone.utc)), "ok",
                         "a grace period while the run starts")
        self.assertEqual(schedule.state({"every_minutes": 30}, "2026-11-09T08:10:00+00:00", now), "ok")
        self.assertEqual(schedule.state({"every_minutes": 30}, "2026-11-09T07:00:00+00:00", now), "missed")


class HistoryTest(Base):
    """The portal's history strip, typical duration, first error and missed-schedule check read the runs kept here."""

    def test_history_newest_first_with_steps_failure_and_typical(self):
        from python.amauta.extras.pipelines import store
        self.define({"id": "p", "steps": [{"name": "A", "type": "command", "argv": [PY, "-c", "print('a')"]}]},
                    {"id": "f", "steps": [{"name": "Bad", "type": "python", "script": "etl/fail.py"}]})
        for trigger in ("cli", "schedule", "portal"):
            runner.run(self.repo, "p", store.new_run(self.state, self.repo, "p"), python=PY, trigger=trigger)
            time.sleep(1.05)  # run files are named by the second
        runner.run(self.repo, "f", store.new_run(self.state, self.repo, "f"), python=PY)
        h = store.history(self.state, self.repo)
        self.assertEqual([r["trigger"] for r in h["p"]["runs"]], ["portal", "schedule", "cli"])
        self.assertEqual(h["p"]["runs"][0]["steps"], [{"id": "s1", "name": "A", "status": "ok", "seconds": h["p"]["runs"][0]["steps"][0]["seconds"]}])
        self.assertEqual(h["p"]["last_scheduled"], h["p"]["runs"][1]["started"])
        self.assertIsInstance(h["p"]["typical"], float)
        self.assertEqual(h["f"]["runs"][0]["failure"], "about to fail")
        self.assertIsNone(h["f"]["typical"], "no successful run yet")

    def test_old_runs_are_pruned(self):
        from python.amauta.extras.pipelines import store
        d = store.runs_dir(self.state, self.repo)
        d.mkdir(parents=True)
        for i in range(store.KEEP + 5):
            (d / f"p-2026010{i // 100}T{i:06d}Z-1.jsonl").write_text("")
        (d / "other-20260101T000000Z-1.jsonl").write_text("")
        store.new_run(self.state, self.repo, "p")
        self.assertEqual(len(list(d.glob("p-*.jsonl"))), store.KEEP - 1, "room for the new run")
        self.assertTrue((d / "other-20260101T000000Z-1.jsonl").exists())


class CheckTest(Base):
    """`amauta pipeline check`: what would stop a run, found before it starts."""

    def test_missing_scripts_programs_and_folders_are_reported(self):
        from python.amauta.extras.pipelines import check
        self.define({"id": "p", "steps": [
            {"name": "Ok", "type": "python", "script": "etl/extract.py", "interpreter": PY},
            {"name": "Gone", "type": "python", "script": "etl/gone.py", "interpreter": PY},
            {"name": "Ghost", "type": "command", "argv": ["no-such-program-amauta"]},
            {"name": "Where", "type": "command", "argv": [PY], "cwd": "nowhere"},
            {"name": "Off", "type": "python", "script": "etl/also-gone.py", "enabled": False},
            {"name": "Out", "type": "command", "argv": [PY], "outputs": ["new/out.csv"]}]})
        found = check.check(self.repo, "p")
        self.assertEqual({(f["step"], f["level"]) for f in found}, {("Gone", "error"), ("Ghost", "error"), ("Where", "error"), ("Out", "note")})
        self.assertTrue(all(f["message"] for f in found))
        self.define({"id": "p", "steps": [{"name": "Ok", "type": "python", "script": "etl/extract.py", "interpreter": PY}]})
        self.assertEqual(check.check(self.repo, "p"), [])

    def test_the_cli_exits_1_on_an_error(self):
        self.define({"id": "p", "steps": [{"name": "Gone", "type": "python", "script": "etl/gone.py", "interpreter": PY}]})
        out = io.StringIO()
        with redirect_stdout(out):
            code = main(["check", "--cwd", str(self.repo), "--state-dir", str(self.state)])
        self.assertEqual(code, 1)
        self.assertIn("etl/gone.py", out.getvalue())


class EventsFileTest(Base):
    """Review R1: the events file is read line by line on "\\n" only, a partial last line waits, and by byte offset."""

    def test_a_unicode_line_separator_in_output_does_not_hide_the_end(self):
        from python.amauta.extras.pipelines import store
        self.define({"id": "u", "steps": [{"name": "U", "type": "command", "argv": [PY, "-c", "print('a\\u2028b\\x85c')"]}]})
        events = self.root / "u.jsonl"
        self.assertEqual(runner.run(self.repo, "u", events, python=PY), 0)
        kinds = [e["kind"] for e in store.read_events(events)]
        self.assertEqual(kinds[-1], "run-end")
        self.assertIn("a b\x85c", [e.get("text") for e in store.read_events(events)])

    def test_reading_by_offset_returns_whole_lines_only(self):
        from python.amauta.extras.pipelines import store
        f = self.root / "p.jsonl"
        f.write_bytes(b'{"kind": "a"}\n{"kind": "b"}\n{"kind": "c"')
        got, nxt = store.read_from(f, 0)
        self.assertEqual([e["kind"] for e in got], ["a", "b"])
        self.assertEqual(nxt, len(b'{"kind": "a"}\n{"kind": "b"}\n'))
        with open(f, "ab") as out:
            out.write(b'}\n')
        got, nxt2 = store.read_from(f, nxt)
        self.assertEqual(([e["kind"] for e in got], nxt2), (["c"], f.stat().st_size))
        self.assertEqual(store.read_from(f, nxt2), ([], nxt2))
        self.assertEqual(store.read_from(self.root / "missing.jsonl", 0), ([], 0))


class LockTest(Base):
    """Review R2/R3: one run of a pipeline at a time, whoever starts it; a run whose runner is gone reads as abandoned."""

    def test_the_lock_is_atomic_and_a_dead_holder_is_stale(self):
        from python.amauta.extras.pipelines import lock
        self.assertTrue(lock.acquire(self.state, self.repo, "p", "p-1.jsonl"))
        self.assertFalse(lock.acquire(self.state, self.repo, "p", "p-2.jsonl"))
        self.assertTrue(lock.holds(self.state, self.repo, "p", "p-1.jsonl"))
        lock.release(self.state, self.repo, "p", "p-2.jsonl")  # not its lock: nothing happens
        self.assertTrue(lock.holds(self.state, self.repo, "p", "p-1.jsonl"))
        lock.release(self.state, self.repo, "p", "p-1.jsonl")
        dead = subprocess.Popen([PY, "-c", "pass"])
        dead.wait()
        lock.path(self.state, self.repo, "p").write_text(json.dumps({"pid": dead.pid, "run": "p-3.jsonl", "t": time.time()}))
        self.assertTrue(lock.acquire(self.state, self.repo, "p", "p-4.jsonl"), "the holder is gone")
        lock.path(self.state, self.repo, "p").write_text(json.dumps({"pid": os.getpid(), "run": "p-5.jsonl", "t": time.time() - 120,
                                                                     "starting": True}))
        self.assertTrue(lock.acquire(self.state, self.repo, "p", "p-6.jsonl"), "a runner that never adopted it")

    def test_the_cli_refuses_a_second_run_and_a_lost_run_is_abandoned(self):
        from python.amauta.extras.pipelines import lock, store
        self.define({"id": "p", "steps": [{"name": "A", "type": "command", "argv": [PY, "-c", "print(1)"]}]})
        self.assertTrue(lock.acquire(self.state, self.repo, "p", "other.jsonl"))
        out = io.StringIO()
        with redirect_stdout(out):
            code = main(["run", "p", "--cwd", str(self.repo), "--state-dir", str(self.state)])
        self.assertEqual(code, 3)
        lock.release(self.state, self.repo, "p", "other.jsonl")
        f = store.new_run(self.state, self.repo, "p")
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps({"t": "2026-11-08T10:00:00+00:00", "kind": "run-start", "pipeline": "p", "steps": ["A"]}) + "\n")
        self.assertEqual(store.last_runs(self.state, self.repo)["p"]["status"], "abandoned")
        self.assertTrue(lock.acquire(self.state, self.repo, "p", f.name))
        self.assertEqual(store.last_runs(self.state, self.repo)["p"]["status"], "running")


class StaleLockRaceTest(Base):
    """Second review, V2: many takers of one stale lock, exactly one wins."""

    def test_exactly_one_taker_wins_a_stale_lock(self):
        helper = Path(__file__).resolve().parent / "lock_race_helper.py"
        dead = subprocess.Popen([PY, "-c", "pass"])
        dead.wait()
        for attempt in range(12):
            f, go = self.root / f"p{attempt}.lock", self.root / f"go{attempt}"
            f.write_text(json.dumps({"pid": dead.pid, "run": "old", "t": time.time()}))
            procs = [subprocess.Popen([PY, str(helper), str(f), str(go), str(n)], stdout=subprocess.PIPE, text=True) for n in range(8)]
            time.sleep(0.3)
            go.write_text("")
            wins = sum(int(p.communicate()[0].strip() or 0) for p in procs)
            self.assertEqual(wins, 1, f"attempt {attempt}: {wins} winners")

    def test_adopting_never_leaves_the_lock_unreadable(self):
        from python.amauta.extras.pipelines import lock
        f = self.root / "p.lock"
        self.assertTrue(lock.take(f, "r1", starting=True))
        stop, seen = threading.Event(), []

        def read():
            while not stop.is_set():
                seen.append(lock.held_by(f, "r1"))
        t = threading.Thread(target=read)
        t.start()
        for _ in range(300):
            lock.adopt(f, "r1")
        stop.set()
        t.join()
        self.assertTrue(all(seen), f"{seen.count(False)} reads saw no holder")


class SecondReviewCliTest(Base):
    """Second review, V5."""

    def test_step_zero_is_refused(self):
        self.define({"id": "p", "steps": [{"type": "command", "argv": [PY, "-c", "print('ran')"]}]})
        out = io.StringIO()
        with redirect_stdout(out):
            code = main(["run", "p", "--step", "0", "--cwd", str(self.repo), "--state-dir", str(self.state)])
        self.assertEqual(code, 2)
        self.assertNotIn("ran", out.getvalue())

    def test_a_percent_sign_is_escaped_in_cron_lines(self):
        from python.amauta.extras.pipelines import schedule
        self.define({"id": "p", "schedule": {"at": "07:00"}, "steps": [{"type": "command", "argv": ["x"]}]})
        line = schedule.hint("linux", self.repo, "p", None, None, node="/opt/100%/node", bin_="b").splitlines()[-1]
        self.assertIn("/opt/100\\%/node", line)
        self.assertNotRegex(line.replace("\\%", ""), "%")


class PidReuseTest(Base):
    """M3: a lock records when its process started, so a pid given to another process does not keep it held."""

    def test_a_reused_pid_is_stale_and_the_real_holder_is_not(self):
        from python.amauta.extras.pipelines import lock, pidinfo
        me = pidinfo.started_at(os.getpid())
        self.assertIsNotNone(me, "the start time of a live process is known on this system")
        self.assertEqual(pidinfo.started_at(os.getpid()), me, "stable for one process")
        f = self.root / "p.lock"
        f.write_text(json.dumps({"pid": os.getpid(), "pid_start": "another process", "run": "old", "t": time.time()}))
        self.assertTrue(lock.take(f, "new"), "same pid, another start time: a reused pid")
        self.assertEqual(json.loads(f.read_text())["pid_start"], me, "the new lock records its own start")
        self.assertFalse(lock.take(f, "third"), "the real holder keeps it")
