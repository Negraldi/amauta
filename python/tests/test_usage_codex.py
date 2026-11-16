"""Codex usage ingestion: rollout files -> usage_messages with runtime='codex'. Synthetic rollouts only; usage and metadata, never text."""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from python.amauta.memory import store as mstore
from python.amauta.usage import codex, ingest
from python.amauta.usage import hook as uhook
from python.tests.test_usage import ROOT, SECRET, rows, write_jsonl

SID = "019a0000-aaaa-7000-8000-000000000001"


def u(inp, cached, write, out, reasoning):
    return {"input_tokens": inp, "cached_input_tokens": cached, "cache_write_input_tokens": write, "output_tokens": out,
            "reasoning_output_tokens": reasoning, "total_tokens": inp + out}


def meta(cwd="/work/proj", parent=None, sid=SID):
    return {"timestamp": "2026-10-20T09:00:00.000Z", "type": "session_meta", "payload": {
        "session_id": sid, "id": sid, "timestamp": "2026-10-20T09:00:00.000Z", "cwd": cwd, "cli_version": "0.1.0",
        "model_provider": "openai", "source": {"cli": True}, "parent_thread_id": parent, "instructions": SECRET}}


def turn(turn_id, model, cwd="/work/proj"):
    return {"timestamp": "2026-10-20T09:00:01.000Z", "type": "turn_context", "payload": {"turn_id": turn_id, "cwd": cwd, "model": model, "effort": "high"}}


def record(resp, turn_id, usage, ts="2026-10-20T09:00:05.000Z", sid=SID):
    return {"timestamp": ts, "type": "token_usage_record", "payload": {
        "thread_id": sid, "turn_id": turn_id, "session_id": sid, "response_id": resp, "usage": usage,
        "turn_token_usage": usage, "thread_token_usage": usage}}


def noise():
    return [
        {"timestamp": "2026-10-20T09:00:02.000Z", "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": SECRET}]}},
        {"timestamp": "2026-10-20T09:00:03.000Z", "type": "response_item", "payload": {"type": "function_call_output", "output": SECRET}},
    ]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / "state"
        self.codex_home = self.root / "codex"
        self.rollout = self.codex_home / "sessions" / "2026" / "10" / "20" / f"rollout-2026-10-20T09-00-00-{SID}.jsonl"

    def conn(self):
        c = mstore.connect(self.state / "memory.db")
        self.addCleanup(c.close)
        return c

    def usage_rows(self):
        return rows(self.state, "SELECT * FROM usage_messages ORDER BY message_id")


class SchemaTest(Base):
    def test_runtime_columns_exist_default_claude_and_user_version_is_untouched(self):
        c = self.conn()
        for table in ("usage_messages", "events"):
            cols = {r["name"]: r for r in c.execute(f"PRAGMA table_info({table})")}
            self.assertIn("runtime", cols, table)
            self.assertEqual(cols["runtime"]["dflt_value"], "'claude'")
        self.assertEqual(c.execute("PRAGMA user_version").fetchone()[0], mstore.SCHEMA_VERSION)

    def test_a_database_already_at_user_version_9_gains_the_columns_and_stays_at_9(self):
        self.state.mkdir()
        raw = sqlite3.connect(self.state / "memory.db")
        for v in range(1, mstore.SCHEMA_VERSION + 1):
            for stmt in mstore._split(mstore._MIGRATIONS[v]):
                raw.execute(stmt)
        raw.execute("INSERT INTO usage_messages (message_id, session_id, project) VALUES ('old', 's', 'p')")
        raw.execute("PRAGMA user_version = 9")
        raw.commit()
        raw.close()
        c = self.conn()
        self.assertEqual(c.execute("PRAGMA user_version").fetchone()[0], 9)
        self.assertEqual(c.execute("SELECT runtime FROM usage_messages WHERE message_id = 'old'").fetchone()[0], "claude")
        self.conn()  # a second open changes nothing and does not fail on the duplicate column


class ParseTest(Base):
    def test_one_row_per_response_with_the_token_mapping_and_no_text(self):
        write_jsonl(self.rollout, [
            meta(), turn("t1", "gpt-x"), *noise(),
            record("resp_1", "t1", u(1000, 800, 50, 120, 30)),
            record("resp_1", "t1", u(1000, 800, 50, 120, 30)),  # replayed line: same response
            record("resp_2", "t1", u(500, 0, 0, 10, 0), ts="2026-10-20T09:01:00.000Z"),
        ])
        stats = codex.ingest_file(self.conn(), self.rollout)
        self.assertEqual(stats["messages"], 2)
        r1, r2 = self.usage_rows()
        self.assertEqual((r1["message_id"], r1["runtime"], r1["session_id"], r1["project"], r1["model"], r1["ts"], r1["sidechain"]),
                         ("resp_1", "codex", SID, "proj", "gpt-x", "2026-10-20T09:00:05.000Z", 0))
        self.assertEqual((r1["input"], r1["cache_read"], r1["cache_write_5m"], r1["cache_write_1h"], r1["output"], r1["thinking"]), (200, 800, 50, 0, 120, 30))
        self.assertEqual((r2["input"], r2["cache_read"], r2["output"]), (500, 0, 10))
        raw = b"".join(p.read_bytes() for p in self.state.glob("memory.db*"))
        self.assertNotIn(SECRET.encode(), raw)
        self.assertEqual(rows(self.state, "SELECT count(*) n FROM tool_calls")[0]["n"], 0)

    def test_model_follows_the_turn_and_a_subagent_thread_is_a_sidechain(self):
        write_jsonl(self.rollout, [
            meta(parent="019a-parent"), turn("t1", "gpt-a"), record("r1", "t1", u(10, 0, 0, 1, 0)),
            turn("t2", "gpt-b", cwd="/work/other"), record("r2", "t2", u(10, 0, 0, 1, 0)),
        ])
        codex.ingest_file(self.conn(), self.rollout)
        a, b = self.usage_rows()
        self.assertEqual((a["model"], b["model"], a["sidechain"], b["sidechain"]), ("gpt-a", "gpt-b", 1, 1))
        self.assertEqual((a["project"], b["project"]), ("proj", "other"))

    def test_ingest_is_idempotent_and_picks_up_appended_records(self):
        write_jsonl(self.rollout, [meta(), turn("t1", "gpt-x"), record("r1", "t1", u(10, 0, 0, 1, 0))])
        c = self.conn()
        self.assertEqual(codex.ingest_file(c, self.rollout)["messages"], 1)
        self.assertEqual(codex.ingest_file(c, self.rollout)["messages"], 0)
        write_jsonl(self.rollout, [record("r2", "t1", u(20, 5, 0, 2, 0))], mode="a")
        self.assertEqual(codex.ingest_file(c, self.rollout)["messages"], 1)
        self.assertEqual([r["message_id"] for r in self.usage_rows()], ["r1", "r2"])

    def test_token_count_events_are_used_only_when_there_is_no_token_usage_record(self):
        def tc(total, last):
            return {"timestamp": "2026-10-20T09:00:09.000Z", "type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": total, "last_token_usage": last}}}
        write_jsonl(self.rollout, [meta(), turn("t1", "gpt-x"), tc(u(100, 40, 0, 10, 2), u(100, 40, 0, 10, 2)), tc(u(100, 40, 0, 10, 2), u(100, 40, 0, 10, 2)),
                                   tc(u(300, 100, 0, 30, 5), u(200, 60, 0, 20, 3))])
        codex.ingest_file(self.conn(), self.rollout)
        got = self.usage_rows()
        self.assertEqual(len(got), 2)  # the repeated cumulative snapshot is one response
        self.assertEqual(sorted((r["input"], r["cache_read"], r["output"], r["thinking"]) for r in got), [(60, 40, 10, 2), (140, 60, 20, 3)])
        both = self.rollout.with_name("both.jsonl")
        write_jsonl(both, [meta(sid="s-both"), turn("t1", "gpt-x"), record("only", "t1", u(1, 0, 0, 1, 0), sid="s-both"), tc(u(9, 0, 0, 9, 0), u(9, 0, 0, 9, 0))])
        codex.ingest_file(self.conn(), both)
        self.assertEqual([r["message_id"] for r in self.usage_rows() if r["session_id"] == "s-both"], ["only"])

    def test_garbage_lines_and_missing_fields_are_skipped(self):
        write_jsonl(self.rollout, ["not json", "[]", {"type": "token_usage_record", "payload": 5}, {"type": "token_usage_record", "payload": {"usage": "x"}},
                                   meta(), record("r1", "t1", {"input_tokens": "x", "output_tokens": -3})])
        codex.ingest_file(self.conn(), self.rollout)
        (r,) = self.usage_rows()
        self.assertEqual((r["input"], r["output"], r["model"]), (0, 0, None))

    def test_claude_rows_are_untouched_and_default_to_claude(self):
        c = self.conn()
        c.execute("INSERT INTO usage_messages (message_id, session_id) VALUES ('m', 's')")
        c.commit()
        self.assertEqual(rows(self.state, "SELECT runtime FROM usage_messages")[0]["runtime"], "claude")


def fcall(name, ns=None, cid="c1", ts="2026-10-20T09:00:04.000Z", arguments=SECRET):
    payload = {"type": "function_call", "name": name, "arguments": arguments, "call_id": cid, "id": "fc_" + str(cid), "status": "completed"}
    if ns is not None:
        payload["namespace"] = ns
    return {"ordinal": 1, "timestamp": ts, "type": "response_item", "payload": payload}


def ccall(name, cid, ts="2026-10-20T09:00:04.000Z"):
    return {"timestamp": ts, "type": "response_item", "payload": {"type": "custom_tool_call", "name": name, "input": SECRET, "call_id": cid, "status": "completed"}}


class ToolCallsTest(Base):
    def calls(self):
        return rows(self.state, "SELECT * FROM tool_calls ORDER BY call_id")

    def test_calls_are_stored_like_claude_ones_without_content_and_joined_to_the_response(self):
        write_jsonl(self.rollout, [
            meta(), turn("t1", "gpt-x"),
            fcall("send_message", "collaboration", "c1"), ccall("exec", "c2"), fcall("sleep", "clock", "c3"), fcall("shell", None, "c4"),
            {"type": "response_item", "payload": {"type": "function_call_output", "call_id": "c1", "output": SECRET}},
            {"type": "response_item", "payload": {"type": "custom_tool_call_output", "call_id": "c2", "output": SECRET}},
            record("resp_1", "t1", u(10, 0, 0, 1, 0)),
            fcall("wait_agent", "collaboration", "c5", ts="2026-10-20T09:02:00.000Z"),
            record("resp_2", "t1", u(10, 0, 0, 1, 0), ts="2026-10-20T09:02:05.000Z"),
        ])
        stats = codex.ingest_file(self.conn(), self.rollout)
        self.assertEqual(stats["tools"], 5)
        got = {r["call_id"]: r for r in self.calls()}
        self.assertEqual({k: v["tool"] for k, v in got.items()},
                         {"c1": "collaboration.send_message", "c2": "exec", "c3": "clock.sleep", "c4": "shell", "c5": "collaboration.wait_agent"})
        self.assertEqual([got[k]["message_id"] for k in ("c1", "c2", "c3", "c4", "c5")], ["resp_1"] * 4 + ["resp_2"])
        self.assertEqual((got["c1"]["session_id"], got["c1"]["ts"], got["c1"]["mcp_server"], got["c1"]["skill"]), (SID, "2026-10-20T09:00:04.000Z", None, None))
        raw = b"".join(p.read_bytes() for p in self.state.glob("memory.db*"))
        self.assertNotIn(SECRET.encode(), raw)

    def test_mcp_namespaces_are_stored_like_claude_mcp_tools(self):
        write_jsonl(self.rollout, [meta(), turn("t1", "g"), fcall("search", "mcp__docs__", "c1"), fcall("mcp__docs__fetch", None, "c2"),
                                   record("r1", "t1", u(1, 0, 0, 1, 0))])
        codex.ingest_file(self.conn(), self.rollout)
        got = {r["call_id"]: (r["tool"], r["mcp_server"]) for r in self.calls()}
        self.assertEqual(got, {"c1": ("mcp__docs__search", "docs"), "c2": ("mcp__docs__fetch", "docs")})

    def test_a_rescan_does_not_duplicate_and_appended_calls_are_added(self):
        write_jsonl(self.rollout, [meta(), turn("t1", "g"), fcall("a", "x", "c1"), record("r1", "t1", u(1, 0, 0, 1, 0))])
        c = self.conn()
        self.assertEqual(codex.ingest_file(c, self.rollout)["tools"], 1)
        write_jsonl(self.rollout, [fcall("b", "x", "c2"), record("r2", "t1", u(1, 0, 0, 1, 0))], mode="a")
        self.assertEqual(codex.ingest_file(c, self.rollout)["tools"], 1)
        self.assertEqual([r["call_id"] for r in self.calls()], ["c1", "c2"])

    def test_old_and_odd_shapes_are_tolerated(self):
        write_jsonl(self.rollout, [
            meta(), turn("t1", "g"),
            {"type": "response_item", "payload": {"type": "local_shell_call", "call_id": "c1", "action": {"command": [SECRET]}}},
            {"type": "response_item", "payload": {"type": "function_call", "call_id": "c2"}},  # no name
            {"type": "response_item", "payload": {"type": "function_call", "name": 7, "namespace": ["x"], "call_id": "c3"}},
            {"type": "response_item", "payload": {"type": "web_search_call", "status": "completed"}},  # unknown type
            {"type": "response_item", "payload": "function_call"}, '{"type": "response_item", "payload": {"type": "function_call", "name": "cut',
            fcall("ok", None, "c4"), fcall("noid", None, None),
            record("r1", "t1", u(1, 0, 0, 1, 0)),
        ])
        codex.ingest_file(self.conn(), self.rollout)
        tools = sorted(r["tool"] for r in self.calls())
        self.assertEqual(tools, ["local_shell", "noid", "ok"])

    def test_calls_in_a_rollout_with_only_token_count_events_join_the_nearest_row(self):
        tc = {"timestamp": "2026-10-20T09:00:09.000Z", "type": "event_msg", "payload": {"type": "token_count", "info": {
            "total_token_usage": u(100, 0, 0, 10, 0), "last_token_usage": u(100, 0, 0, 10, 0)}}}
        write_jsonl(self.rollout, [meta(), turn("t1", "g"), fcall("a", "x", "c1"), tc, fcall("b", "x", "c2")])
        codex.ingest_file(self.conn(), self.rollout)
        ids = {r["message_id"] for r in self.usage_rows()}
        self.assertEqual({r["message_id"] for r in self.calls()}, ids)

    def test_a_rollout_ingested_before_tool_calls_were_read_is_rescanned_once(self):
        write_jsonl(self.rollout, [meta(), turn("t1", "g"), fcall("a", "x", "c1"), record("r1", "t1", u(1, 0, 0, 1, 0))])
        c = self.conn()
        st = self.rollout.stat()  # the state an older amauta left: offset == size
        c.execute('INSERT INTO ingest_state (path, size, mtime, "offset") VALUES (?,?,?,?)', (str(self.rollout), st.st_size, st.st_mtime, st.st_size))
        c.commit()
        self.assertEqual(codex.ingest_file(c, self.rollout)["tools"], 1)
        self.assertEqual(codex.ingest_file(c, self.rollout)["tools"], 0)
        self.assertEqual(len(self.calls()), 1)


class BackfillHookTest(Base):
    def make(self):
        write_jsonl(self.rollout, [meta(), turn("t1", "gpt-x"), record("r1", "t1", u(10, 2, 0, 3, 1))])
        link = self.codex_home / "sessions" / "2026" / "10" / "20" / "link.jsonl"
        link.symlink_to(self.rollout)

    def test_backfill_walks_sessions_and_skips_symlinks(self):
        self.make()
        total = codex.backfill(self.conn(), self.codex_home)
        self.assertEqual((total["files"], total["messages"]), (1, 1))
        self.assertEqual(codex.backfill(self.conn(), self.codex_home)["messages"], 0)
        self.assertEqual(codex.backfill(self.conn(), self.root / "missing"), {"files": 0, "messages": 0, "tools": 0, "errors": 0})

    def run_cli(self, *args, stdin="", env=None):
        e = {**os.environ, "PYTHONPATH": str(ROOT / "python"), "AMAUTA_STATE_DIR": str(self.state), "AMAUTA_CLAUDE_HOME": str(self.root / "no-claude"), **(env or {})}
        return subprocess.run([sys.executable, "-P", "-m", "amauta.usage", *args], input=stdin, capture_output=True, text=True, env=e, timeout=60)

    def test_cli_backfill_runtime_codex_and_all(self):
        self.make()
        r = self.run_cli("backfill", "--runtime", "codex", "--codex-home", str(self.codex_home))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), {"codex": {"files": 1, "messages": 1, "tools": 0, "errors": 0}})
        r = self.run_cli("backfill", "--runtime", "all", "--codex-home", str(self.codex_home))
        out = json.loads(r.stdout)
        self.assertEqual(set(out), {"files", "messages", "tools", "errors", "codex"})
        self.assertEqual(out["codex"]["messages"], 0)  # already imported

    def test_the_default_backfill_stays_claude_only(self):
        self.make()
        out = json.loads(self.run_cli("backfill").stdout)
        self.assertNotIn("codex", out)
        self.assertEqual(rows(self.state, "SELECT count(*) n FROM usage_messages")[0]["n"], 0)

    def test_codex_home_resolution(self):
        from python.amauta import paths
        self.assertEqual(paths.codex_home({"AMAUTA_CODEX_HOME": "/x/c"}), Path("/x/c"))
        self.assertEqual(paths.codex_home({}, home=Path("/h")), Path("/h/.codex"))

    def test_stop_hook_with_the_codex_runtime_imports_the_finished_session(self):
        self.make()
        payload = {"session_id": SID, "hook_event_name": "Stop", "transcript_path": str(self.rollout), "cwd": "/work/proj"}
        r = self.run_cli("hook", stdin=json.dumps(payload), env={"AMAUTA_RUNTIME": "codex"})
        self.assertEqual((r.returncode, r.stdout), (0, ""))
        (row,) = self.usage_rows()
        self.assertEqual((row["runtime"], row["message_id"], row["input"], row["cache_read"]), ("codex", "r1", 8, 2))
        self.run_cli("hook", stdin=json.dumps(payload), env={"AMAUTA_RUNTIME": "codex"})  # idempotent
        self.assertEqual(len(self.usage_rows()), 1)

    def test_hook_without_the_codex_runtime_keeps_the_claude_parser(self):
        self.make()
        uhook.run({"transcript_path": str(self.rollout)}, env={"AMAUTA_STATE_DIR": str(self.state)})
        self.assertEqual(self.usage_rows(), [])

    def test_telemetry_events_carry_the_runtime(self):
        from python.amauta.telemetry import hook as thook
        thook.record({"session_id": "s", "hook_event_name": "Stop", "cwd": "/x/p"}, 10, env={"AMAUTA_STATE_DIR": str(self.state), "AMAUTA_RUNTIME": "codex"})
        thook.record({"session_id": "s", "hook_event_name": "Stop", "cwd": "/x/p"}, 10, env={"AMAUTA_STATE_DIR": str(self.state)})
        thook.record({"session_id": "s", "hook_event_name": "Stop", "cwd": "/x/p"}, 10, env={"AMAUTA_STATE_DIR": str(self.state), "AMAUTA_RUNTIME": "../evil"})
        self.assertEqual([e["runtime"] for e in rows(self.state, "SELECT runtime FROM events ORDER BY id")], ["codex", "claude", "claude"])


if __name__ == "__main__":
    unittest.main()
