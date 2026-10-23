"""Portal: usage by runtime (Claude Code / Codex). Codex has no prices in amauta: tokens only, never an invented cost."""
import json
from datetime import date
from unittest import mock

from python.amauta.memory import store as mstore
from python.amauta.portal import api, wikihome
from python.amauta.portal.config import Config
from python.amauta.usage import codex
from python.tests.test_portal import ApiBase
from python.tests.test_usage import write_jsonl
from python.tests.test_usage_codex import meta, record, turn, u

CSID = "019a-codex-session"


def add_codex(root, home_dir):
    rollout = home_dir / "sessions" / "2026" / "10" / "02" / f"rollout-{CSID}.jsonl"
    write_jsonl(rollout, [meta(cwd="/work/alpha", sid=CSID), turn("t1", "gpt-x", cwd="/work/alpha"),
                          record("resp_1", "t1", u(1000, 600, 40, 100, 20), ts="2026-10-02T12:00:00.000Z", sid=CSID)])
    return rollout


class RuntimeBase(ApiBase):
    def setUp(self):
        super().setUp()
        self.codex_home = self.root / "codex"
        add_codex(self.root, self.codex_home)
        conn = mstore.connect(self.f["state"] / "memory.db")
        codex.backfill(conn, self.codex_home)
        conn.close()


class FilterTest(RuntimeBase):
    def test_sessions_carry_the_runtime_and_the_filter_splits_them(self):
        by = {r["session_id"]: r for r in self.get("/api/sessions", days=3650)["sessions"]}
        self.assertEqual((by["s1"]["runtime"], by[CSID]["runtime"]), ("claude", "codex"))
        self.assertEqual((by[CSID]["input"], by[CSID]["cache_read"], by[CSID]["cache_write"], by[CSID]["output"]), (400, 600, 40, 100))
        only = self.get("/api/sessions", days=3650, runtime="codex")
        self.assertEqual([r["session_id"] for r in only["sessions"]], [CSID])
        self.assertEqual({r["session_id"] for r in self.get("/api/sessions", days=3650, runtime="claude")["sessions"]}, {"s1", "s2"})
        self.assertEqual(len(self.get("/api/sessions", days=3650, runtime="")["sessions"]), 3)

    def test_overview_filters_and_splits_by_runtime(self):
        o = self.get("/api/overview", days=3650)
        self.assertEqual(o["totals"]["messages"], 4)
        by = {r["runtime"]: r for r in o["runtimes"]}
        self.assertEqual((by["claude"]["messages"], by["claude"]["sessions"], by["codex"]["messages"], by["codex"]["input"], by["codex"]["output"]), (3, 2, 1, 400, 100))
        c = self.get("/api/overview", days=3650, runtime="codex")
        self.assertEqual((c["totals"]["messages"], c["totals"]["input"]), (1, 400))
        self.assertEqual([m["model"] for m in c["models"]], ["gpt-x"])
        self.assertEqual(self.get("/api/overview", days=3650, runtime="claude")["totals"]["messages"], 3)

    def test_tools_follow_the_filter_and_a_bad_runtime_is_a_400(self):
        self.assertEqual(self.get("/api/tools", days=3650, runtime="codex")["tools"], [])
        self.assertTrue(self.get("/api/tools", days=3650, runtime="claude")["tools"])
        status, body = self.portal.get("/api/overview", {"runtime": "gemini"})
        self.assertEqual(status, 400)
        self.assertIn("runtime", body["error"])

    def test_codex_models_stay_unpriced_even_with_a_prices_file(self):
        (self.f["state"] / "prices.json").write_text(json.dumps({"models": {"claude-x": {"input": 1000000, "output": 1000000}}}))
        c = self.get("/api/costs", days=3650)
        row = next(m for m in c["models"] if m["model"] == "gpt-x")
        self.assertIsNone(row["cost"])
        self.assertIn("gpt-x", c["unpriced_models"])
        self.assertEqual(row["input"], 400)  # tokens are still shown


class HomeAndSessionTest(RuntimeBase):
    def test_home_spending_splits_by_runtime(self):
        with mock.patch.object(wikihome, "_today", return_value=date(2026, 10, 5)):
            s = self.get("/api/wiki/home")["spending"]
        by = {r["runtime"]: {w["days"]: w for w in r["windows"]} for r in s["runtimes"]}
        self.assertEqual([r["runtime"] for r in s["runtimes"]], ["claude", "codex"])
        self.assertEqual((by["codex"][7]["input"], by["codex"][7]["output"], by["codex"][7]["cache_read"], by["codex"][7]["cache_write"]), (400, 100, 600, 40))
        self.assertEqual(by["claude"][7]["input"], 160)
        self.assertEqual({m["model"] for m in s["top_models"]}, {"claude-x", "claude-y", "gpt-x"})

    def test_session_page_names_the_runtime(self):
        status, page = self.portal.get("/api/wiki/page", {"kind": "session", "id": CSID})
        self.assertEqual(status, 200, page)
        self.assertIn({"label": "Runtime", "value": "Codex"}, page["meta"])
        status, page = self.portal.get("/api/wiki/page", {"kind": "session", "id": "s1"})
        self.assertIn({"label": "Runtime", "value": "Claude Code"}, page["meta"])

    def test_refresh_also_imports_codex_rollouts_when_a_codex_home_is_configured(self):
        write_jsonl(self.codex_home / "sessions" / "2026" / "10" / "03" / "rollout-new.jsonl",
                    [meta(sid="new-s"), turn("t9", "gpt-x"), record("resp_new", "t9", u(10, 0, 0, 1, 0), ts="2026-10-03T12:00:00.000Z", sid="new-s")])
        cfg = Config(state_dir=self.f["state"], claude_home=self.f["home"], codex_home=self.codex_home)
        status, body = api.Portal(cfg).refresh()
        self.assertEqual(status, 200)
        self.assertEqual(body["codex"]["messages"], 1)
        status, body = self.portal.refresh()  # no codex home configured: Claude only, unchanged shape
        self.assertNotIn("codex", body)


class OldDatabaseTest(ApiBase):
    """The portal opens memory.db read-only: a database no newer build has touched has no runtime column, and all of it is Claude."""

    def setUp(self):
        super().setUp()
        import sqlite3
        db = self.f["state"] / "old.db"
        raw = sqlite3.connect(db)
        for v in range(1, mstore.SCHEMA_VERSION + 1):
            for stmt in mstore._split(mstore._MIGRATIONS[v]):
                raw.execute(stmt)
        raw.execute("INSERT INTO usage_messages (message_id, session_id, project, model, ts, input) VALUES ('m', 's', 'p', 'claude-x', '2026-10-02T10:00:00Z', 5)")
        raw.commit()
        raw.close()
        (self.f["state"] / "memory.db").unlink()
        for ext in ("-wal", "-shm"):
            (self.f["state"] / f"memory.db{ext}").unlink(missing_ok=True)
        db.rename(self.f["state"] / "memory.db")

    def test_views_and_filters_work_without_the_column(self):
        self.assertEqual(self.get("/api/sessions", days=3650)["sessions"][0]["runtime"], "claude")
        self.assertEqual([r["runtime"] for r in self.get("/api/overview", days=3650)["runtimes"]], ["claude"])
        self.assertEqual(len(self.get("/api/sessions", days=3650, runtime="claude")["sessions"]), 1)
        self.assertEqual(self.get("/api/sessions", days=3650, runtime="codex")["sessions"], [])
        with mock.patch.object(wikihome, "_today", return_value=date(2026, 10, 5)):
            self.assertEqual([r["runtime"] for r in self.get("/api/wiki/home")["spending"]["runtimes"]], ["claude"])
        self.assertIn({"label": "Runtime", "value": "Claude Code"}, self.get("/api/wiki/page", kind="session", id="s")["meta"])
