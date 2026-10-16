import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from python.amauta.memory import store as mstore
from python.amauta.telemetry import hook as thook
from python.amauta.telemetry import housekeeping
from python.amauta.telemetry import report as treport

ROOT = Path(__file__).resolve().parents[2]
SECRET = "TOP-SECRET-PROMPT-TEXT-12345"


def run_cli(state, *args, stdin=""):
    env = {**os.environ, "PYTHONPATH": str(ROOT / "python"), "AMAUTA_STATE_DIR": str(state)}
    return subprocess.run([sys.executable, "-m", "amauta.telemetry", *args], input=stdin, capture_output=True, text=True, env=env, timeout=30)


def events(state):
    c = sqlite3.connect(Path(state) / "memory.db")
    c.row_factory = sqlite3.Row
    rows = [dict(r) for r in c.execute("SELECT * FROM events ORDER BY id")]
    c.close()
    return rows


class HookTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name) / "state"

    def test_records_one_event_per_payload_with_sizes_only(self):
        payload = {
            "session_id": "s1", "hook_event_name": "PostToolUse", "cwd": "/work/my-project", "tool_name": "Bash",
            "tool_input": {"command": f"echo {SECRET}"}, "tool_response": {"stdout": SECRET, "is_error": False},
            "prompt": SECRET,
        }
        r = run_cli(self.state, "hook", stdin=json.dumps(payload))
        self.assertEqual((r.returncode, r.stdout), (0, ""))
        (e,) = events(self.state)
        self.assertEqual((e["session_id"], e["event"], e["tool_name"], e["cwd"], e["project"], e["ok"]), ("s1", "PostToolUse", "Bash", "/work/my-project", "my-project", 1))
        self.assertEqual(e["payload_bytes"], len(json.dumps(payload).encode()))
        self.assertIsNone(e["duration_ms"])
        self.assertRegex(e["ts"], r"^\d{4}-\d\d-\d\dT")

    def test_never_stores_prompt_text_or_tool_io(self):
        for event in ("UserPromptSubmit", "PostToolUse", "Stop"):
            run_cli(self.state, "hook", stdin=json.dumps({
                "session_id": "s", "hook_event_name": event, "cwd": "/x", "prompt": SECRET, "tool_name": "Write",
                "tool_input": {"content": SECRET}, "tool_response": {"error": SECRET}, "last_assistant_message": SECRET,
            }))
        raw = b"".join(p.read_bytes() for p in self.state.glob("memory.db*"))
        self.assertNotIn(SECRET.encode(), raw)
        self.assertEqual(len(events(self.state)), 3)

    def test_ok_flag_and_duration(self):
        run_cli(self.state, "hook", stdin=json.dumps({"session_id": "s", "hook_event_name": "PostToolUse", "cwd": "/x", "tool_name": "Bash", "tool_response": {"is_error": True}, "duration_ms": 42}))
        run_cli(self.state, "hook", stdin=json.dumps({"session_id": "s", "hook_event_name": "PostToolUse", "cwd": "/x", "tool_name": "Bash", "tool_response": {"error": "boom"}}))
        a, b = events(self.state)
        self.assertEqual((a["ok"], a["duration_ms"], b["ok"]), (0, 42, 0))

    def test_fails_open_on_bad_input_and_unwritable_state(self):
        for stdin in ("", "not json", "[]", "null", "123", '{"hook_event_name": 5}'):
            r = run_cli(self.state, "hook", stdin=stdin)
            self.assertEqual((r.returncode, r.stdout), (0, ""), stdin)
        blocker = Path(self.tmp.name) / "file"
        blocker.write_text("x")
        r = run_cli(blocker / "inside", "hook", stdin=json.dumps({"hook_event_name": "Stop"}))
        self.assertEqual((r.returncode, r.stdout), (0, ""))

    def test_hot_path_runs_no_subprocess(self):
        conn = mstore.connect(self.state / "memory.db")
        conn.close()
        with mock.patch("subprocess.run", side_effect=AssertionError("no subprocess on the hot path")), \
                mock.patch("subprocess.Popen", side_effect=AssertionError("no subprocess on the hot path")):
            thook.record({"session_id": "s", "hook_event_name": "Stop", "cwd": "/a/b"}, 10, env={"AMAUTA_STATE_DIR": str(self.state)})
        self.assertEqual(events(self.state)[0]["project"], "b")

    def test_values_are_bounded(self):
        thook.record({"session_id": "s" * 500, "hook_event_name": "E" * 500, "cwd": "/x", "tool_name": "t" * 500}, 1, env={"AMAUTA_STATE_DIR": str(self.state)})
        e = events(self.state)[0]
        self.assertLessEqual(len(e["session_id"]), 128)
        self.assertLessEqual(len(e["event"]), 64)
        self.assertLessEqual(len(e["tool_name"]), 128)


class DroppedAndRetentionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name) / "state"
        self.env = {"AMAUTA_STATE_DIR": str(self.state)}
        self.conn = mstore.connect(self.state / "memory.db")
        self.addCleanup(self.conn.close)

    def add_event(self, days_ago, event="PostToolUse"):
        ts = (datetime.now(timezone.utc) - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.conn.execute("INSERT INTO events (ts, event, payload_bytes, ok) VALUES (?,?,1,1)", (ts, event))
        self.conn.commit()

    def test_write_failure_is_counted_in_sidecar(self):
        locker = sqlite3.connect(self.state / "memory.db")
        locker.execute("BEGIN EXCLUSIVE")
        self.addCleanup(locker.close)
        for _ in range(2):
            thook.record({"hook_event_name": "Stop", "cwd": "/x"}, 5, env=self.env)
        self.assertEqual(housekeeping.dropped(self.env), 2)
        self.assertEqual(treport.build(self.state / "memory.db", days=7, env=self.env)["dropped"], 2)
        locker.rollback()
        thook.record({"hook_event_name": "Stop", "cwd": "/x"}, 5, env=self.env)
        self.assertEqual(housekeeping.dropped(self.env), 2)  # success does not reset or bump it

    def test_dropped_defaults_to_zero_and_counter_failure_is_silent(self):
        self.assertEqual(housekeeping.dropped(self.env), 0)
        blocker = Path(self.tmp.name) / "f"
        blocker.write_text("x")
        housekeeping.count_dropped({"AMAUTA_STATE_DIR": str(blocker / "inside")})  # must not raise

    def test_prune_removes_only_old_events(self):
        self.add_event(100)
        self.add_event(95)
        self.add_event(5)
        self.assertEqual(housekeeping.prune(self.conn, 90), 2)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM events").fetchone()[0], 1)
        with self.assertRaises(ValueError):
            housekeeping.prune(self.conn, 0)

    def test_cli_prune(self):
        self.add_event(40)
        self.add_event(1)
        r = run_cli(self.state, "prune", "--days", "30")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), {"deleted": 1, "days": 30})
        self.assertEqual(len(events(self.state)), 1)

    def test_hook_prunes_automatically_at_most_once_per_day(self):
        self.add_event(100)
        thook.record({"hook_event_name": "Stop", "cwd": "/x"}, 5, env=self.env)
        self.assertEqual([e["event"] for e in events(self.state)], ["Stop"])
        self.add_event(100)
        thook.record({"hook_event_name": "Stop", "cwd": "/x"}, 5, env=self.env)
        self.assertEqual(len(events(self.state)), 3)  # second old row survives: pruned today already
        (self.state / "telemetry.pruned").write_text("2000-01-01")
        thook.record({"hook_event_name": "Stop", "cwd": "/x"}, 5, env=self.env)
        self.assertEqual(len(events(self.state)), 3)  # old row gone, one new row added

    def test_retention_days_env_and_invalid_values(self):
        self.assertEqual(housekeeping.retention_days({}), 90)
        self.assertEqual(housekeeping.retention_days({"AMAUTA_TELEMETRY_RETENTION_DAYS": "30"}), 30)
        for bad in ("x", "0", "-3", ""):
            self.assertEqual(housekeeping.retention_days({"AMAUTA_TELEMETRY_RETENTION_DAYS": bad}), 90)
        self.add_event(40)
        thook.record({"hook_event_name": "Stop", "cwd": "/x"}, 5, env={**self.env, "AMAUTA_TELEMETRY_RETENTION_DAYS": "30"})
        self.assertEqual([e["event"] for e in events(self.state)], ["Stop"])


class ReportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        conn = mstore.connect(self.state / "memory.db")
        today = datetime.now(timezone.utc)

        def add(days_ago, session, event, tool=None):
            ts = (today - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")
            conn.execute("INSERT INTO events (ts, session_id, event, tool_name, cwd, project, payload_bytes, ok) VALUES (?,?,?,?,?,?,?,1)", (ts, session, event, tool, "/x", "x", 10))

        add(0, "a", "SessionStart")
        add(0, "a", "PostToolUse", "Bash")
        add(0, "a", "PostToolUse", "Bash")
        add(0, "b", "PostToolUse", "Edit")
        add(1, "c", "UserPromptSubmit")
        add(40, "old", "PostToolUse", "Bash")
        conn.commit()
        conn.close()

    def test_report_aggregates_within_window(self):
        data = treport.build(self.state / "memory.db", days=7)
        self.assertEqual(data["total"], 5)
        self.assertEqual(data["events"], {"PostToolUse": 3, "SessionStart": 1, "UserPromptSubmit": 1})
        self.assertEqual(data["top_tools"][0], {"tool": "Bash", "count": 2})
        self.assertEqual(sum(data["sessions_per_day"].values()), 3)
        self.assertEqual(max(data["sessions_per_day"].values()), 2)
        self.assertEqual(treport.build(self.state / "memory.db", days=90)["total"], 6)

    def test_cli_report_json_and_text(self):
        j = run_cli(self.state, "report", "--days", "7", "--json")
        self.assertEqual(j.returncode, 0, j.stderr)
        self.assertEqual(json.loads(j.stdout)["total"], 5)
        t = run_cli(self.state, "report")
        self.assertEqual(t.returncode, 0)
        self.assertIn("PostToolUse", t.stdout)
        self.assertIn("Bash", t.stdout)

    def test_empty_database(self):
        with tempfile.TemporaryDirectory() as d:
            r = run_cli(d, "report", "--json")
            self.assertEqual(json.loads(r.stdout)["total"], 0)


class NoNetworkTest(unittest.TestCase):
    def test_telemetry_and_memory_sources_have_no_network_imports(self):
        pattern = re.compile(r"urllib|http\.client|socket|requests")
        for pkg in ("telemetry", "memory"):
            files = list((ROOT / "python" / "amauta" / pkg).glob("*.py"))
            self.assertTrue(files, pkg)
            for f in files:
                hit = pattern.search(f.read_text())
                self.assertIsNone(hit, f"{f} mentions {hit and hit.group(0)}")


if __name__ == "__main__":
    unittest.main()
