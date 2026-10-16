import sqlite3
import unittest

from python.amauta.memory import store as mstore
from python.amauta.usage import ingest
from python.tests.test_usage import SECRET, Base, assistant, rows, tool_use, write_jsonl


def result_line(call_id, content, is_error=None, session="s1", ts="2026-10-01T10:00:05.000Z"):
    item = {"type": "tool_result", "tool_use_id": call_id, "content": content}
    if is_error is not None:
        item["is_error"] = is_error
    return {"type": "user", "sessionId": session, "timestamp": ts, "message": {"role": "user", "content": [item]}}


class OutcomeTest(Base):
    def by_call(self):
        return {r["call_id"]: r for r in rows(self.state, "SELECT * FROM tool_calls")}

    def test_results_are_classified_without_keeping_any_content(self):
        write_jsonl(self.transcript, [
            assistant("m1", [tool_use("Bash", "ok1", command="ls"), tool_use("Bash", "e1", command="false"), tool_use("Bash", "e2", command="x"),
                             tool_use("Bash", "e127", command="nope"), tool_use("Bash", "e137", command="x"), tool_use("Bash", "e9", command="x"),
                             tool_use("Read", "r1", file_path=f"/x/{SECRET}"), tool_use("Edit", "d1"), tool_use("Edit", "d2"), tool_use("Edit", "d3"), tool_use("Bash", "pending", command="sleep 1")]),
            result_line("ok1", SECRET),
            result_line("e1", f"Exit code 1\n{SECRET}", True),
            result_line("e2", [{"type": "text", "text": f"Exit code 2\n{SECRET}"}], True),
            result_line("e127", "Exit code 127\ncommand not found", True),
            result_line("e137", "Exit code 137", True),
            result_line("e9", "Exit code 9", True),
            result_line("r1", f"File does not exist {SECRET}", True),
            result_line("d1", "User rejected tool use", True),
            result_line("d2", "The user doesn't want to proceed with this tool use. The tool use was rejected", True),
            result_line("d3", "Permission for this action was denied by the Claude Code auto mode classifier. " + SECRET, True),
        ])
        stats = ingest.ingest_file(self.conn(), self.transcript)
        self.assertEqual(stats["results"], 10)
        got = {k: (v["result"], v["exit_class"]) for k, v in self.by_call().items()}
        self.assertEqual(got, {
            "ok1": ("ok", None), "e1": ("error", "fail"), "e2": ("error", "misuse"), "e127": ("error", "missing"), "e137": ("error", "signal"), "e9": ("error", "other"),
            "r1": ("error", None), "d1": ("denied", None), "d2": ("denied", None), "d3": ("denied", None), "pending": (None, None),
        })
        raw = b"".join(p.read_bytes() for p in self.state.glob("memory.db*"))
        self.assertNotIn(SECRET.encode(), raw)
        self.assertNotIn(b"command not found", raw)

    def test_test_commands_get_a_coarse_class_and_the_command_is_not_stored(self):
        cmds = {"a": "npm test", "b": "cd x && python3 -m unittest discover -s t", "c": "pytest -q tests/", "d": "node --test test/", "e": "cargo test --all",
                "f": "go test ./...", "g": "ctest --output-on-failure", "h": "Rscript -e 'testthat::test_dir(\"tests\")'", "i": "npm run test:unit",
                "n1": "ls -la", "n2": "git commit -m 'fix test names'", "n3": "npm install", "n4": "echo contest"}
        write_jsonl(self.transcript, [assistant("m1", [tool_use("Bash", k, command=v + " " + SECRET) for k, v in cmds.items()] + [tool_use("Read", "z", command="npm test")])])
        ingest.ingest_file(self.conn(), self.transcript)
        got = {k: v["cmd_class"] for k, v in self.by_call().items()}
        for k in "abcdefghi":
            self.assertEqual(got[k], "test", cmds[k])
        for k in ("n1", "n2", "n3", "n4", "z"):
            self.assertIsNone(got[k], k)
        self.assertNotIn(SECRET.encode(), b"".join(p.read_bytes() for p in self.state.glob("memory.db*")))

    def test_results_in_a_later_run_and_a_full_rescan_are_idempotent(self):
        write_jsonl(self.transcript, [assistant("m1", [tool_use("Bash", "c1", command="pytest")])])
        conn = self.conn()
        ingest.ingest_file(conn, self.transcript)
        self.assertIsNone(self.by_call()["c1"]["result"])
        write_jsonl(self.transcript, [result_line("c1", "Exit code 1", True)], mode="a")
        ingest.ingest_file(conn, self.transcript)
        self.assertEqual(self.by_call()["c1"]["result"], "error")
        conn.execute("DELETE FROM ingest_state")
        conn.commit()
        ingest.ingest_file(conn, self.transcript)
        (t,) = rows(self.state, "SELECT * FROM tool_calls")
        self.assertEqual((t["result"], t["exit_class"], t["cmd_class"]), ("error", "fail", "test"))

    def test_malformed_results_are_ignored(self):
        write_jsonl(self.transcript, [
            assistant("m1", [tool_use("Bash", "c1", command="ls")]),
            {"type": "user", "message": {"content": "plain prompt"}}, {"type": "user", "message": {"content": [5, {"type": "tool_result"}, {"type": "tool_result", "tool_use_id": 7}]}},
            {"type": "user", "message": 5}, result_line("unknown-id", "x", True),
        ])
        ingest.ingest_file(self.conn(), self.transcript)
        self.assertIsNone(self.by_call()["c1"]["result"])


class MigrationTest(Base):
    def test_v5_database_gains_the_columns_and_is_rescanned_once(self):
        c = sqlite3.connect(self.state / "memory.db") if (self.state / "memory.db").exists() else None
        self.assertIsNone(c)
        self.state.mkdir(parents=True)
        c = sqlite3.connect(self.state / "memory.db")
        for target in range(1, 6):
            for stmt in mstore._split(mstore._MIGRATIONS[target]):
                c.execute(stmt)
        c.execute("PRAGMA user_version = 5")
        c.execute("INSERT INTO ingest_state (path, size, mtime, \"offset\") VALUES ('x', 1, 1.0, 1)")
        c.commit()
        c.close()
        conn = self.conn()
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(tool_calls)")}
        self.assertTrue({"result", "exit_class", "cmd_class"} <= cols)
        self.assertEqual(conn.execute("SELECT count(*) FROM ingest_state").fetchone()[0], 0)
        self.assertGreaterEqual(mstore.SCHEMA_VERSION, 6)


if __name__ == "__main__":
    unittest.main()
