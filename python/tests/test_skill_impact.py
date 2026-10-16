import unittest

from python.amauta.portal import skillimpact as si


def call(ts, tool="Bash", result="ok", skill=None, cmd=None):
    return {"ts": ts, "tool": tool, "skill": skill, "result": result, "cmd_class": cmd}


def turn(ts, tokens):
    return {"ts": ts, "tokens": tokens}


def sess(sid, calls, turns=(), project="p"):
    return {"id": sid, "project": project, "calls": list(calls), "turns": list(turns)}


def exposed(sid, n_ok=3, n_err=1, project="p", tokens=100):
    calls = [call("2026-10-01T10:00:00.000Z", "Skill", "ok", skill="S")]
    calls += [call(f"2026-10-01T10:01:{i:02d}.000Z", result="error" if i < n_err else "ok") for i in range(n_ok + n_err)]
    turns = [turn("2026-10-01T09:59:00.000Z", 9999), turn("2026-10-01T10:00:00.000Z", 9999), turn("2026-10-01T10:02:00.000Z", tokens)]
    return sess(sid, calls, turns, project)


def control(sid, n_ok=9, n_err=1, project="p", tokens=200):
    calls = [call(f"2026-10-02T10:01:{i:02d}.000Z", result="error" if i < n_err else "ok") for i in range(n_ok + n_err)]
    return sess(sid, calls, [turn("2026-10-02T10:00:00.000Z", tokens)], project)


class GroupingTest(unittest.TestCase):
    def test_exposed_and_control_sessions_are_counted_and_the_load_message_tokens_are_excluded(self):
        data = [exposed(f"e{i}") for i in range(5)] + [control(f"c{i}") for i in range(5)]
        r = si.analyze(data, "S")
        self.assertEqual((r["exposed_sessions"], r["control_sessions"], r["control_scope"]), (5, 5, "same-project"))
        tok = r["metrics"]["tokens_per_turn"]
        self.assertEqual((tok["exposed"]["value"], tok["baseline"]["value"]), (100, 200))  # turns at or before the load are not "after load"
        self.assertEqual((tok["exposed"]["n"], tok["baseline"]["n"]), (5, 5))

    def test_error_rate_ignores_denied_and_unknown_results_and_the_skill_call_itself(self):
        s = exposed("e0", n_ok=2, n_err=2)
        s["calls"] += [call("2026-10-01T10:05:00.000Z", result="denied"), call("2026-10-01T10:05:01.000Z", result=None)]
        data = [s] + [exposed(f"e{i}", n_ok=4, n_err=0) for i in range(1, 5)] + [control(f"c{i}", 9, 1) for i in range(5)]
        er = si.analyze(data, "S")["metrics"]["error_rate"]
        self.assertEqual((er["exposed"]["errors"], er["exposed"]["n"]), (2, 20))  # 4 + 4*4 outcomes; denied, unknown and the Skill call are out
        self.assertAlmostEqual(er["exposed"]["value"], 2 / 20)

    def test_a_control_session_that_loads_the_skill_later_is_not_a_control(self):
        data = [exposed(f"e{i}") for i in range(5)] + [control(f"c{i}") for i in range(5)]
        data[5]["calls"].append(call("2026-10-02T11:00:00.000Z", "Skill", skill="S"))
        r = si.analyze(data, "S")
        self.assertEqual((r["exposed_sessions"], r["control_sessions"]), (6, 4))


class SmallNTest(unittest.TestCase):
    def test_fewer_than_five_sessions_on_either_side_suppresses_values_but_keeps_n(self):
        data = [exposed(f"e{i}") for i in range(4)] + [control(f"c{i}") for i in range(8)]
        r = si.analyze(data, "S")
        for name, m in r["metrics"].items():
            if name == "unused_after_load":
                continue
            self.assertTrue(m["suppressed"], name)
            self.assertIsNone(m["exposed"]["value"], name)
            self.assertIsNone(m["delta"], name)
            self.assertIsNone(m["verdict"], name)
        self.assertEqual(r["metrics"]["error_rate"]["exposed"]["n"], 16)  # n is still reported
        self.assertEqual(r["min_sessions"], 5)
        data = [exposed(f"e{i}") for i in range(5)] + [control(f"c{i}") for i in range(4)]
        self.assertTrue(si.analyze(data, "S")["metrics"]["error_rate"]["suppressed"])

    def test_threshold_is_configurable_and_enough_sessions_unlock_values(self):
        data = [exposed(f"e{i}") for i in range(5)] + [control(f"c{i}") for i in range(5)]
        er = si.analyze(data, "S")["metrics"]["error_rate"]
        self.assertFalse(er["suppressed"])
        self.assertAlmostEqual(er["exposed"]["value"], 0.25)
        self.assertAlmostEqual(er["baseline"]["value"], 0.1)
        self.assertAlmostEqual(er["delta"], 0.15)
        self.assertEqual(er["verdict"], "worse")  # lower is better for every metric here
        self.assertTrue(si.analyze([exposed("e"), control("c")], "S", min_sessions=1)["metrics"]["error_rate"]["delta"] is not None)

    def test_no_sessions_at_all(self):
        r = si.analyze([], "S")
        self.assertEqual((r["exposed_sessions"], r["control_sessions"]), (0, 0))
        self.assertTrue(r["metrics"]["error_rate"]["suppressed"])


class ControlScopeTest(unittest.TestCase):
    def test_same_project_controls_are_preferred_and_all_projects_is_the_fallback(self):
        data = [exposed(f"e{i}", project="a") for i in range(5)] + [control(f"c{i}", project="a") for i in range(5)] + [control(f"o{i}", project="b", n_err=5, n_ok=5) for i in range(5)]
        r = si.analyze(data, "S")
        self.assertEqual((r["control_sessions"], r["control_scope"]), (5, "same-project"))
        self.assertAlmostEqual(r["metrics"]["error_rate"]["baseline"]["value"], 0.1)
        thin = [exposed(f"e{i}", project="a") for i in range(5)] + [control(f"c{i}", project="a") for i in range(2)] + [control(f"o{i}", project="b") for i in range(5)]
        r = si.analyze(thin, "S")
        self.assertEqual((r["control_sessions"], r["control_scope"]), (7, "all-projects"))


class RetryTest(unittest.TestCase):
    def test_retry_is_the_same_tool_within_the_next_three_calls_after_an_error(self):
        def s(sid, seq):
            return sess(sid, [call("2026-10-01T10:00:00.000Z", "Skill", skill="S")] + [call(f"2026-10-01T10:01:{i:02d}.000Z", t, r) for i, (t, r) in enumerate(seq)])
        retried = [("Bash", "error"), ("Read", "ok"), ("Read", "ok"), ("Bash", "ok")]  # 3rd call after: still inside the window
        too_far = [("Bash", "error"), ("Read", "ok"), ("Read", "ok"), ("Read", "ok"), ("Bash", "ok")]  # 4th call after: outside
        different = [("Bash", "error"), ("Read", "ok"), ("Edit", "ok")]
        self.assertEqual(si.retries(s("a", retried)["calls"][1:]), (1, 1))
        self.assertEqual(si.retries(s("b", too_far)["calls"][1:]), (1, 0))
        self.assertEqual(si.retries(s("c", different)["calls"][1:]), (1, 0))
        self.assertEqual(si.retries([call("t", "Bash", "ok")]), (0, 0))
        self.assertEqual(si.retries([call("t", "Bash", "denied"), call("t", "Bash", "ok")]), (0, 0))  # a refusal is not a failure to retry

    def test_retry_rate_pools_errors_and_has_sample_sizes(self):
        data = []
        for i in range(5):
            data.append(sess(f"e{i}", [call("2026-10-01T10:00:00.000Z", "Skill", skill="S"), call("2026-10-01T10:01:00.000Z", "Bash", "error"), call("2026-10-01T10:01:01.000Z", "Bash", "ok")]))
            data.append(sess(f"c{i}", [call("2026-10-02T10:01:00.000Z", "Bash", "error"), call("2026-10-02T10:01:01.000Z", "Read", "ok")]))
        rr = si.analyze(data, "S")["metrics"]["retry_rate"]
        self.assertEqual((rr["exposed"]["value"], rr["exposed"]["n"], rr["baseline"]["value"], rr["baseline"]["n"]), (1.0, 5, 0.0, 5))
        self.assertEqual(rr["verdict"], "worse")


class TestOutcomeTest(unittest.TestCase):
    def test_test_runner_failures_after_load_are_compared_with_baseline(self):
        data = []
        for i in range(5):
            data.append(sess(f"e{i}", [call("2026-10-01T10:00:00.000Z", "Skill", skill="S"), call("2026-10-01T10:01:00.000Z", "Bash", "ok", cmd="test"), call("2026-10-01T10:02:00.000Z", "Bash", "ok")]))
            data.append(sess(f"c{i}", [call("2026-10-02T10:01:00.000Z", "Bash", "error", cmd="test"), call("2026-10-02T10:02:00.000Z", "Bash", "ok", cmd="test"), call("2026-10-02T10:03:00.000Z", "Bash", "ok")]))
        tf = si.analyze(data, "S")["metrics"]["test_failure_rate"]
        self.assertEqual((tf["exposed"]["value"], tf["exposed"]["n"], tf["baseline"]["value"], tf["baseline"]["n"]), (0.0, 5, 0.5, 10))
        self.assertEqual(tf["verdict"], "better")

    def test_a_metric_with_no_data_on_a_side_is_suppressed_with_a_reason(self):
        data = [exposed(f"e{i}") for i in range(5)] + [control(f"c{i}") for i in range(5)]  # no test commands anywhere
        tf = si.analyze(data, "S")["metrics"]["test_failure_rate"]
        self.assertTrue(tf["suppressed"])
        self.assertIn("no", tf["reason"].lower())


class UnusedAfterLoadTest(unittest.TestCase):
    def test_loaded_sessions_with_no_call_after_the_load_are_counted(self):
        data = [sess(f"e{i}", [call("2026-10-01T10:00:00.000Z", "Skill", skill="S")] + ([call("2026-10-01T10:01:00.000Z")] if i < 3 else [])) for i in range(5)]
        u = si.analyze(data, "S")["metrics"]["unused_after_load"]
        self.assertEqual((u["unused"], u["n"], u["value"]), (2, 5, 0.4))
        self.assertFalse(u["suppressed"])
        small = si.analyze(data[:3], "S")["metrics"]["unused_after_load"]
        self.assertTrue(small["suppressed"])
        self.assertEqual((small["unused"], small["n"]), (0, 3))


class VerdictTest(unittest.TestCase):
    def test_verdict_has_a_flat_band(self):
        self.assertEqual(si.verdict("rate", 0.10, 0.11), "no clear difference")
        self.assertEqual(si.verdict("rate", 0.10, 0.20), "worse")
        self.assertEqual(si.verdict("rate", 0.20, 0.10), "better")
        self.assertEqual(si.verdict("mean", 100, 103), "no clear difference")
        self.assertEqual(si.verdict("mean", 100, 150), "worse")
        self.assertEqual(si.verdict("mean", 200, 100), "better")
        self.assertIsNone(si.verdict("mean", None, 1))


if __name__ == "__main__":
    unittest.main()


class LoaderTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        from pathlib import Path

        from python.amauta.usage import ingest
        from python.tests.test_usage import assistant, tool_use, write_jsonl
        from python.tests.test_usage_outcome import result_line

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.home, self.state = root / "claude", root / "state"
        lines = [
            assistant("m1", [tool_use("Skill", "k1", skill="S")], session="s1", ts="2026-10-01T10:00:00.000Z", usage={"input_tokens": 1, "output_tokens": 50}),
            assistant("m2", [tool_use("Bash", "k2", command="pytest")], session="s1", ts="2026-10-01T10:00:10.000Z", usage={"input_tokens": 1, "output_tokens": 70}),
            result_line("k2", "Exit code 1", True, session="s1", ts="2026-10-01T10:00:11.000Z"),
            assistant("m3", [tool_use("Read", "k3")], session="s1", ts="2026-10-01T10:00:20.000Z", usage={"input_tokens": 1, "output_tokens": 5}, sidechain=True),
            assistant("o1", [tool_use("Read", "k4")], session="old", ts="2026-05-01T10:00:00.000Z"),
        ]
        write_jsonl(self.home / "projects" / "-w" / "s1.jsonl", lines)
        from python.amauta.memory import store as mstore
        self.conn = mstore.connect(self.state / "memory.db")
        self.addCleanup(self.conn.close)
        ingest.backfill(self.conn, self.home)

    def test_sessions_are_loaded_in_time_order_with_outcomes_and_main_thread_turns_only(self):
        (s,) = si.load_sessions(self.conn, "2026-10-01")  # the May session is outside the window
        self.assertEqual((s["id"], s["project"]), ("s1", "proj"))
        self.assertEqual([(c["tool"], c["result"], c["cmd_class"]) for c in s["calls"]], [("Skill", None, None), ("Bash", "error", "test"), ("Read", None, None)])
        self.assertEqual([t["tokens"] for t in s["turns"]], [50, 70])  # the sidechain turn is not part of the main thread
        self.assertTrue(si.outcomes_recorded(self.conn))

    def test_old_schema_without_outcome_columns_still_loads(self):
        import sqlite3
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        c.executescript("CREATE TABLE tool_calls (message_id TEXT, call_id TEXT, session_id TEXT, ts TEXT, tool TEXT, skill TEXT);"
                        "CREATE TABLE usage_messages (message_id TEXT, session_id TEXT, project TEXT, ts TEXT, output INTEGER, sidechain INTEGER);"
                        "INSERT INTO tool_calls VALUES ('m','c','s','2026-10-01T10:00:00Z','Bash',NULL);")
        (s,) = si.load_sessions(c, "2026-10-01")
        self.assertEqual(s["calls"][0]["result"], None)
        self.assertFalse(si.outcomes_recorded(c))

    def test_since_date(self):
        from datetime import date
        self.assertEqual(si.since_date(30, date(2026, 10, 16)), "2026-09-16")
