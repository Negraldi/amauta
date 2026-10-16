from datetime import date
from unittest import mock

from python.amauta.memory import store as mstore
from python.amauta.portal import wikihome
from python.amauta.usage import ingest
from python.tests import portal_fixtures as fx
from python.tests.portal_fixtures import usage_blob
from python.tests.test_portal_wiki import WikiBase
from python.tests.test_usage import assistant, write_jsonl


class HomeTest(WikiBase):
    def home(self, today=date(2026, 10, 5)):
        with mock.patch.object(wikihome, "_today", return_value=today):
            return self.get("/api/wiki/home")

    def add_old_session(self):
        write_jsonl(self.f["home"] / "projects" / "-old" / "s9.jsonl",
                    [assistant("o1", usage=usage_blob(7, 3, 0), session="s9", ts="2026-09-20T10:00:00.000Z", cwd="/work/old", model="claude-old")])
        c = mstore.connect(self.f["state"] / "memory.db")
        ingest.backfill(c, self.f["home"])
        c.close()

    def test_shape(self):
        h = self.home()
        self.assertEqual(set(h), {"activity", "spending", "health"})

    def test_activity_is_grouped_by_day_newest_first_with_links_data(self):
        days = self.home()["activity"]
        self.assertEqual([d["day"] for d in days], sorted((d["day"] for d in days), reverse=True))
        items = [i for d in days for i in d["items"]]
        self.assertEqual({i["kind"] for i in items}, {"memory", "session", "feature"})
        for d in days:
            for i in d["items"]:
                self.assertEqual(set(i), {"kind", "id", "title", "ts", "what"})
                self.assertTrue(i["ts"].startswith(d["day"]))
        self.assertIn("memory revised (revision 2)", [i["what"] for i in items])

    def test_activity_is_capped_per_day_and_in_days(self):
        st = mstore.Store(self.f["state"] / "memory.db")
        for n in range(40):
            st.save(f"note {n}", "x", type="note", project="alpha")
        st.close()
        days = self.home()["activity"]
        self.assertTrue(all(len(d["items"]) <= wikihome.PER_DAY for d in days))
        self.assertLessEqual(len(days), wikihome.DAYS_SHOWN)

    def test_spending_windows_cache_ratio_and_top_models(self):
        self.add_old_session()
        s = self.home()["spending"]
        self.assertTrue(s["available"])
        w = {x["days"]: x for x in s["windows"]}
        self.assertEqual((w[7]["input"], w[7]["output"], w[7]["cache_read"], w[7]["cache_write"]), (160, 85, 900, 150))
        self.assertEqual((w[30]["input"], w[30]["output"]), (167, 88))
        self.assertAlmostEqual(s["cache_hit_ratio"], 900 / (167 + 900 + 150))
        self.assertEqual([m["model"] for m in s["top_models"]], ["claude-x", "claude-y", "claude-old"])
        self.assertEqual(s["top_models"][0]["tokens"], 1050 + 20)

    def test_spending_is_unavailable_without_usage_data(self):
        from python.amauta.portal import api
        from python.amauta.portal.config import Config
        empty = api.Portal(Config(state_dir=self.root / "nowhere", claude_home=self.f["home"], repos=[]))
        status, body = empty.get("/api/wiki/home", {})
        self.assertEqual(status, 200)
        self.assertFalse(body["spending"]["available"])
        self.assertEqual(body["activity"], [])
        self.assertFalse(body["health"]["installed"])

    def test_health_counts_and_nothing_secret(self):
        h = self.home()["health"]
        self.assertTrue(h["installed"])
        self.assertEqual((h["version"], h["hooks"], h["mcp_servers"], h["skills"], h["agents"], h["telemetry"]), ("0.1.0", 3, 2, 0, 0, True))
        self.assertNotIn("SECRET", str(h))
