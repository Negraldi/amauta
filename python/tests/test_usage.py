import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from python.amauta.memory import store as mstore
from python.amauta.usage import ingest

ROOT = Path(__file__).resolve().parents[2]
SECRET = "TOP-SECRET-TRANSCRIPT-TEXT-98765"


def run_cli(state, *args, stdin=""):
    env = {**os.environ, "PYTHONPATH": str(ROOT / "python"), "GENTLE_LITE_STATE_DIR": str(state)}
    return subprocess.run([sys.executable, "-P", "-m", "amauta.usage", *args], input=stdin, capture_output=True, text=True, env=env, timeout=60)


def assistant(msg_id, content=None, usage=None, model="claude-x", session="s1", ts="2026-10-01T10:00:00.000Z", cwd="/work/proj", sidechain=False, request="req1"):
    usage = usage if usage is not None else {
        "input_tokens": 10, "output_tokens": 20, "cache_creation_input_tokens": 300, "cache_read_input_tokens": 4000,
        "cache_creation": {"ephemeral_5m_input_tokens": 100, "ephemeral_1h_input_tokens": 200},
        "output_tokens_details": {"thinking_tokens": 7},
    }
    return {
        "type": "assistant", "sessionId": session, "timestamp": ts, "cwd": cwd, "isSidechain": sidechain, "requestId": request,
        "message": {"id": msg_id, "model": model, "usage": usage, "content": content if content is not None else [{"type": "text", "text": SECRET}]},
    }


def tool_use(name, tool_id, **inp):
    return {"type": "tool_use", "id": tool_id, "name": name, "input": inp}


def write_jsonl(path, lines, mode="w"):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, mode) as f:
        for line in lines:
            f.write((line if isinstance(line, str) else json.dumps(line)) + "\n")


def rows(state, sql):
    c = sqlite3.connect(Path(state) / "memory.db")
    c.row_factory = sqlite3.Row
    out = [dict(r) for r in c.execute(sql)]
    c.close()
    return out


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / "state"
        self.home = self.root / "claude"
        self.transcript = self.home / "projects" / "-work-proj" / "s1.jsonl"

    def conn(self):
        c = mstore.connect(self.state / "memory.db")
        self.addCleanup(c.close)
        return c


class ParseTest(Base):
    def test_usage_message_is_extracted_and_deduped_by_message_id(self):
        write_jsonl(self.transcript, [
            {"type": "user", "message": {"role": "user", "content": SECRET}},
            assistant("m1", [{"type": "thinking", "thinking": SECRET}]),
            assistant("m1", [{"type": "text", "text": SECRET}]),
            assistant("m1", [tool_use("Bash", "t1", command=f"echo {SECRET}")]),
        ])
        stats = ingest.ingest_file(self.conn(), self.transcript)
        self.assertEqual(stats["messages"], 1)
        (m,) = rows(self.state, "SELECT * FROM usage_messages")
        self.assertEqual(
            (m["message_id"], m["session_id"], m["project"], m["model"], m["ts"], m["input"], m["output"], m["cache_read"], m["cache_write_5m"], m["cache_write_1h"], m["thinking"], m["sidechain"]),
            ("m1", "s1", "proj", "claude-x", "2026-10-01T10:00:00.000Z", 10, 20, 4000, 100, 200, 7, 0),
        )
        (t,) = rows(self.state, "SELECT * FROM tool_calls")
        self.assertEqual((t["message_id"], t["tool"], t["skill"], t["subagent_type"], t["mcp_server"]), ("m1", "Bash", None, None, None))

    def test_missing_cache_breakdown_falls_back_to_5m(self):
        usage = {"input_tokens": 1, "output_tokens": 2, "cache_creation_input_tokens": 50, "cache_read_input_tokens": 3}
        write_jsonl(self.transcript, [assistant("m1", usage=usage)])
        ingest.ingest_file(self.conn(), self.transcript)
        (m,) = rows(self.state, "SELECT * FROM usage_messages")
        self.assertEqual((m["cache_write_5m"], m["cache_write_1h"], m["thinking"]), (50, 0, 0))

    def test_fallback_to_request_id_and_skip_lines_without_usage(self):
        line = assistant("x", request="rq9")
        del line["message"]["id"]
        nousage = assistant("m2")
        del nousage["message"]["usage"]
        write_jsonl(self.transcript, [line, nousage, "not json", "[]", '{"type":"assistant","message":5}'])
        ingest.ingest_file(self.conn(), self.transcript)
        self.assertEqual([r["message_id"] for r in rows(self.state, "SELECT message_id FROM usage_messages")], ["rq9"])

    def test_names_only_for_skill_agent_and_mcp(self):
        write_jsonl(self.transcript, [
            assistant("m1", [
                tool_use("Skill", "a", skill="work-unit-commits", args=SECRET),
                tool_use("Agent", "b", subagent_type="sdd-apply", prompt=SECRET, description=SECRET),
                tool_use("Task", "c", subagent_type="Explore", prompt=SECRET),
                tool_use("mcp__engram__mem_save", "d", content=SECRET),
                tool_use("Read", "e", file_path=f"/x/{SECRET}"),
            ]),
        ])
        ingest.ingest_file(self.conn(), self.transcript)
        got = {r["tool"]: r for r in rows(self.state, "SELECT * FROM tool_calls")}
        self.assertEqual(got["Skill"]["skill"], "work-unit-commits")
        self.assertEqual(got["Agent"]["subagent_type"], "sdd-apply")
        self.assertEqual(got["Task"]["subagent_type"], "Explore")
        self.assertEqual(got["mcp__engram__mem_save"]["mcp_server"], "engram")
        self.assertIsNone(got["Read"]["skill"])
        raw = b"".join(p.read_bytes() for p in self.state.glob("memory.db*"))
        self.assertNotIn(SECRET.encode(), raw)

    def test_sidechain_flag_and_project_fallback_to_directory(self):
        line = assistant("m1", sidechain=True)
        del line["cwd"]
        write_jsonl(self.transcript, [line])
        ingest.ingest_file(self.conn(), self.transcript)
        (m,) = rows(self.state, "SELECT * FROM usage_messages")
        self.assertEqual((m["sidechain"], m["project"]), (1, "-work-proj"))

    def test_values_are_bounded_and_non_numeric_usage_is_zero(self):
        usage = {"input_tokens": "x", "output_tokens": True, "cache_read_input_tokens": -5, "cache_creation_input_tokens": 1.5}
        write_jsonl(self.transcript, [assistant("m" * 500, model="y" * 500, usage=usage, session="s" * 500)])
        ingest.ingest_file(self.conn(), self.transcript)
        (m,) = rows(self.state, "SELECT * FROM usage_messages")
        self.assertLessEqual(len(m["message_id"]), 128)
        self.assertLessEqual(len(m["model"]), 128)
        self.assertEqual((m["input"], m["output"], m["cache_read"], m["cache_write_5m"]), (0, 0, 0, 0))


class IncrementalTest(Base):
    def test_resumes_from_offset_and_skips_unchanged_file(self):
        write_jsonl(self.transcript, [assistant("m1")])
        c = self.conn()
        self.assertEqual(ingest.ingest_file(c, self.transcript)["messages"], 1)
        self.assertEqual(ingest.ingest_file(c, self.transcript)["messages"], 0)
        write_jsonl(self.transcript, [assistant("m2", [tool_use("Bash", "t2")])], mode="a")
        stats = ingest.ingest_file(c, self.transcript)
        self.assertEqual(stats["messages"], 1)
        (st,) = rows(self.state, "SELECT * FROM ingest_state")
        self.assertEqual(st["offset"], self.transcript.stat().st_size)

    def test_partial_trailing_line_is_not_consumed_until_complete(self):
        full = json.dumps(assistant("m2"))
        write_jsonl(self.transcript, [assistant("m1")])
        with open(self.transcript, "a") as f:
            f.write(full[:40])
        c = self.conn()
        self.assertEqual(ingest.ingest_file(c, self.transcript)["messages"], 1)
        with open(self.transcript, "a") as f:
            f.write(full[40:] + "\n")
        self.assertEqual(ingest.ingest_file(c, self.transcript)["messages"], 1)
        self.assertEqual(len(rows(self.state, "SELECT * FROM usage_messages")), 2)

    def test_shrunk_file_is_rescanned_without_duplicates(self):
        write_jsonl(self.transcript, [assistant("m1"), assistant("m2")])
        c = self.conn()
        ingest.ingest_file(c, self.transcript)
        write_jsonl(self.transcript, [assistant("m3")])  # rotated: smaller than the stored offset
        self.assertLess(self.transcript.stat().st_size, rows(self.state, "SELECT * FROM ingest_state")[0]["offset"])
        ingest.ingest_file(c, self.transcript)
        ids = sorted(r["message_id"] for r in rows(self.state, "SELECT message_id FROM usage_messages"))
        self.assertEqual(ids, ["m1", "m2", "m3"])

    def test_same_size_rewrite_with_new_mtime_is_rescanned(self):
        write_jsonl(self.transcript, [assistant("m1"), assistant("m2")])
        c = self.conn()
        ingest.ingest_file(c, self.transcript)
        write_jsonl(self.transcript, [assistant("m1"), assistant("m3")])
        os.utime(self.transcript, (1, 1))
        ingest.ingest_file(c, self.transcript)
        ids = sorted(r["message_id"] for r in rows(self.state, "SELECT message_id FROM usage_messages"))
        self.assertEqual(ids, ["m1", "m2", "m3"])

    def test_same_message_split_across_runs_keeps_all_tool_calls_once(self):
        write_jsonl(self.transcript, [assistant("m1", [tool_use("Bash", "t1")])])
        c = self.conn()
        ingest.ingest_file(c, self.transcript)
        write_jsonl(self.transcript, [assistant("m1", [tool_use("Bash", "t1"), tool_use("Read", "t2")])], mode="a")
        ingest.ingest_file(c, self.transcript)
        self.assertEqual(sorted(r["tool"] for r in rows(self.state, "SELECT tool FROM tool_calls")), ["Bash", "Read"])
        self.assertEqual(len(rows(self.state, "SELECT * FROM usage_messages")), 1)

    def test_deadline_stops_early_and_resumes(self):
        write_jsonl(self.transcript, [assistant(f"m{i}") for i in range(50)])
        c = self.conn()
        first = ingest.ingest_file(c, self.transcript, max_lines=10)
        self.assertEqual(first["messages"], 10)
        rest = ingest.ingest_file(c, self.transcript)
        self.assertEqual(rest["messages"], 40)


class BatchTest(Base):
    def test_write_lock_is_released_between_batches(self):
        """A concurrent writer (telemetry) must get in while a long ingest is in progress."""
        write_jsonl(self.transcript, [assistant(f"m{i}") for i in range(30)])
        c = self.conn()
        other = sqlite3.connect(self.state / "memory.db", timeout=0.05)
        self.addCleanup(other.close)
        outcomes = []
        real_store = ingest._store

        def spy(conn, raw, path, stats):
            if stats["lines"] % 10 == 1:  # first line of a batch: nothing of it written yet
                try:
                    other.execute("INSERT INTO events (ts, event) VALUES ('t', 'probe')")
                    other.commit()
                    outcomes.append(True)
                except sqlite3.OperationalError:
                    outcomes.append(False)
            real_store(conn, raw, path, stats)

        with mock.patch.object(ingest, "BATCH_LINES", 10), mock.patch.object(ingest, "_store", spy):
            self.assertEqual(ingest.ingest_file(c, self.transcript)["messages"], 30)
        self.assertEqual(outcomes, [True, True, True])

    def test_offset_is_committed_per_batch(self):
        write_jsonl(self.transcript, [assistant(f"m{i}") for i in range(25)])
        c = self.conn()
        with mock.patch.object(ingest, "BATCH_LINES", 10):
            ingest.ingest_file(c, self.transcript, max_lines=15)
        (st,) = rows(self.state, "SELECT * FROM ingest_state")
        self.assertGreater(st["offset"], 0)
        self.assertEqual(ingest.ingest_file(c, self.transcript)["messages"], 10)


class AtomicBatchTest(Base):
    def test_failure_mid_batch_rolls_back_the_batch_and_never_leaks_into_the_next_file(self):
        write_jsonl(self.transcript, [assistant(f"m{i}") for i in range(8)])
        other = self.home / "projects" / "-other" / "s2.jsonl"
        write_jsonl(other, [assistant("o1", session="s2")])
        c = self.conn()
        real_store = ingest._store
        calls = []

        def failing(conn, raw, path, stats):
            calls.append(1)
            if len(calls) == 5:
                raise sqlite3.OperationalError("database is locked")
            real_store(conn, raw, path, stats)

        with mock.patch.object(ingest, "BATCH_LINES", 10), mock.patch.object(ingest, "_store", failing):
            with self.assertRaises(sqlite3.OperationalError):
                ingest.ingest_file(c, self.transcript)
        self.assertFalse(c.in_transaction)
        self.assertEqual(rows(self.state, "SELECT count(*) AS n FROM usage_messages")[0]["n"], 0)
        ingest.ingest_file(c, other)  # its state save must not commit the failed file's rows
        self.assertEqual([r["message_id"] for r in rows(self.state, "SELECT message_id FROM usage_messages")], ["o1"])
        self.assertEqual(ingest.ingest_file(c, self.transcript)["messages"], 8)  # nothing was half-recorded


class BackfillTest(Base):
    def test_sqlite_error_on_one_file_is_counted_and_backfill_continues(self):
        write_jsonl(self.transcript, [assistant("m1")])
        write_jsonl(self.home / "projects" / "-other" / "s2.jsonl", [assistant("m3", session="s2")])
        real = ingest.ingest_file

        def flaky(conn, path, **kw):
            if Path(path).name == "s1.jsonl":
                raise sqlite3.OperationalError("database is locked")
            return real(conn, path, **kw)

        with mock.patch.object(ingest, "ingest_file", flaky):
            out = ingest.backfill(self.conn(), self.home)
        self.assertEqual((out["errors"], out["files"], out["messages"]), (1, 1, 1))

    def test_cli_help_lists_only_real_subcommands(self):
        r = run_cli(self.state, "--help")
        self.assertIn("{backfill}", r.stdout)

    def test_backfill_discovers_nested_subagent_transcripts(self):
        write_jsonl(self.transcript, [assistant("m1")])
        write_jsonl(self.home / "projects" / "-work-proj" / "s1" / "subagents" / "agent-a.jsonl", [assistant("m2", sidechain=True)])
        write_jsonl(self.home / "projects" / "-other" / "s2.jsonl", [assistant("m3", session="s2")])
        r = run_cli(self.state, "backfill", "--claude-home", str(self.home))
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual((out["files"], out["messages"]), (3, 3))
        again = json.loads(run_cli(self.state, "backfill", "--claude-home", str(self.home)).stdout)
        self.assertEqual(again["messages"], 0)

    def test_backfill_missing_home_is_not_an_error(self):
        r = run_cli(self.state, "backfill", "--claude-home", str(self.root / "nope"))
        self.assertEqual(r.returncode, 0)
        self.assertEqual(json.loads(r.stdout)["files"], 0)


class HookTest(Base):
    def test_hook_ingests_transcript_path_and_agent_transcript_path(self):
        write_jsonl(self.transcript, [assistant("m1")])
        sub = self.home / "projects" / "-work-proj" / "s1" / "subagents" / "agent-a.jsonl"
        write_jsonl(sub, [assistant("m2", sidechain=True)])
        payload = {"hook_event_name": "SubagentStop", "transcript_path": str(self.transcript), "agent_transcript_path": str(sub), "last_assistant_message": SECRET}
        r = run_cli(self.state, "hook", stdin=json.dumps(payload))
        self.assertEqual((r.returncode, r.stdout), (0, ""))
        self.assertEqual(len(rows(self.state, "SELECT * FROM usage_messages")), 2)

    def test_hook_fails_open_and_silent(self):
        for stdin in ("", "not json", "[]", "null", '{"transcript_path": 5}', '{"transcript_path": "/nonexistent/x.jsonl"}', '{"transcript_path": "/etc/passwd"}'):
            r = run_cli(self.state, "hook", stdin=stdin)
            self.assertEqual((r.returncode, r.stdout), (0, ""), stdin)
        blocker = self.root / "file"
        blocker.write_text("x")
        write_jsonl(self.transcript, [assistant("m1")])
        r = run_cli(blocker / "inside", "hook", stdin=json.dumps({"transcript_path": str(self.transcript)}))
        self.assertEqual((r.returncode, r.stdout), (0, ""))

    def test_hook_does_not_import_code_from_cwd(self):
        evil = self.root / "evil"
        (evil / "amauta").mkdir(parents=True)
        marker = self.root / "pwned"
        (evil / "amauta" / "__init__.py").write_text(f"open({str(marker)!r}, 'w').write('x')\n")
        env = {**os.environ, "PYTHONPATH": str(ROOT / "python"), "GENTLE_LITE_STATE_DIR": str(self.state)}
        subprocess.run([sys.executable, "-P", "-m", "amauta.usage", "hook"], input="{}", capture_output=True, text=True, env=env, cwd=evil, timeout=30)
        self.assertFalse(marker.exists())


class NoNetworkTest(unittest.TestCase):
    def test_usage_sources_have_no_network_imports(self):
        import re
        pattern = re.compile(r"urllib|http\.client|socket|requests")
        files = list((ROOT / "python" / "amauta" / "usage").glob("*.py"))
        self.assertTrue(files)
        for f in files:
            self.assertIsNone(pattern.search(f.read_text()), str(f))


if __name__ == "__main__":
    unittest.main()
