import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from python.gentle_lite.portal import api
from python.gentle_lite.portal.config import Config
from python.tests import portal_fixtures as fx

ROOT = Path(__file__).resolve().parents[2]


class ApiBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.f = fx.build(self.root)
        self.cfg = Config(state_dir=self.f["state"], claude_home=self.f["home"], engram_db=self.f["engram"], repos=[self.f["repo"]], graphify=self.f["graph"])
        self.portal = api.Portal(self.cfg)

    def get(self, path, **q):
        status, body = self.portal.get(path, {k: str(v) for k, v in q.items()})
        self.assertEqual(status, 200, body)
        return body


class UsageViewsTest(ApiBase):
    def test_overview_aggregates_by_day_model_and_cache_ratio(self):
        o = self.get("/api/overview", days=3650)
        self.assertEqual(o["totals"]["messages"], 3)
        self.assertEqual(o["totals"]["sessions"], 2)
        self.assertEqual((o["totals"]["input"], o["totals"]["output"], o["totals"]["cache_read"], o["totals"]["cache_write"]), (160, 85, 900, 150))
        self.assertAlmostEqual(o["cache_hit_ratio"], 900 / (160 + 900 + 150))
        days = {d["day"]: d for d in o["daily"]}
        self.assertEqual(sorted(days), ["2026-10-01", "2026-10-02"])
        self.assertEqual((days["2026-10-02"]["input"], days["2026-10-02"]["sessions"]), (60, 2))
        self.assertEqual({m["model"] for m in o["models"]}, {"claude-x", "claude-y"})
        self.assertEqual(o["dropped_events"], 3)
        self.assertEqual(o["events"], 1)

    def test_overview_filters_by_project_and_dates(self):
        o = self.get("/api/overview", days=3650, project="beta")
        self.assertEqual(o["totals"]["messages"], 1)
        o = self.get("/api/overview", **{"from": "2026-10-02", "to": "2026-10-02"})
        self.assertEqual(o["totals"]["messages"], 2)

    def test_bad_parameters_are_400_not_500(self):
        for q in ({"days": "abc"}, {"days": "-1"}, {"from": "yesterday"}):
            status, body = self.portal.get("/api/overview", q)
            self.assertEqual(status, 400, q)
            self.assertIn("error", body)

    def test_limit_is_validated(self):
        self.assertEqual(self.portal.get("/api/sessions", {"limit": "x"})[0], 400)
        self.assertEqual(self.portal.get("/api/sessions", {"limit": "5000"})[0], 400)

    def test_tool_tables(self):
        t = self.get("/api/tools", days=3650)
        self.assertEqual({r["name"]: r["count"] for r in t["skills"]}, {"work-unit-commits": 1})
        self.assertEqual({r["name"]: r["count"] for r in t["subagents"]}, {"sdd-apply": 1})
        self.assertEqual({r["name"]: r["count"] for r in t["mcp_servers"]}, {"engram": 1})
        self.assertEqual({r["name"]: r["count"] for r in t["mcp_tools"]}, {"mcp__engram__mem_save": 1})
        names = {r["name"] for r in t["tools"]}
        self.assertTrue({"Bash", "Read", "Skill", "Agent"} <= names)
        self.assertEqual({r["name"]: r["count"] for r in self.get("/api/tools", days=3650, project="beta")["tools"]}, {"Read": 1})

    def test_sessions_and_projects(self):
        s = self.get("/api/sessions", days=3650)
        by = {r["session_id"]: r for r in s["sessions"]}
        self.assertEqual((by["s1"]["project"], by["s1"]["messages"], by["s1"]["input"], by["s1"]["output"]), ("alpha", 2, 150, 75))
        self.assertEqual({p["project"]: p["sessions"] for p in s["projects"]}, {"alpha": 1, "beta": 1})
        only = self.get("/api/sessions", days=3650, project="beta")
        self.assertEqual([r["session_id"] for r in only["sessions"]], ["s2"])

    def test_costs_are_off_without_prices_and_labeled_estimate_with_them(self):
        c = self.get("/api/costs", days=3650)
        self.assertEqual(c["enabled"], False)
        (self.f["state"] / "prices.json").write_text(json.dumps({"models": {"claude-x": {"input": 1000000, "output": 2000000, "cache_read": 0, "cache_write": 0}}}))
        c = self.get("/api/costs", days=3650)
        self.assertTrue(c["enabled"])
        self.assertIn("estimate", c["label"].lower())
        x = {r["model"]: r for r in c["models"]}["claude-x"]
        self.assertEqual(x["cost"], 110 * 1 + 60 * 2)  # per-token price equals the per-MTok figure here
        self.assertIsNone({r["model"]: r for r in c["models"]}["claude-y"]["cost"])
        self.assertEqual(c["unpriced_models"], ["claude-y"])

    def test_old_schema_database_degrades_gracefully(self):
        old = self.root / "old"
        old.mkdir()
        c = sqlite3.connect(old / "memory.db")
        c.execute("CREATE TABLE events (id INTEGER)")
        c.execute("PRAGMA user_version = 2")
        c.commit()
        c.close()
        p = api.Portal(Config(state_dir=old, claude_home=self.f["home"]))
        status, body = p.get("/api/overview", {})
        self.assertEqual(status, 200)
        self.assertFalse(body["available"])
        self.assertEqual(sqlite3.connect(old / "memory.db").execute("PRAGMA user_version").fetchone()[0], 2)  # never migrated

    def test_missing_database_is_not_created(self):
        empty = self.root / "empty"
        p = api.Portal(Config(state_dir=empty, claude_home=self.f["home"]))
        status, body = p.get("/api/overview", {})
        self.assertEqual((status, body["available"]), (200, False))
        self.assertFalse(empty.exists())


class MemoryViewsTest(ApiBase):
    def test_own_search_filters_and_facets(self):
        r = self.get("/api/memories", source="own")
        self.assertEqual(len(r["items"]), 2)  # the second save upserts the same topic_key row
        self.assertEqual(sorted(r["facets"]["projects"]), ["alpha", "beta"])
        hit = self.get("/api/memories", source="own", q="gadgets")
        self.assertEqual([i["title"] for i in hit["items"]], ["Other note"])
        self.assertEqual([i["project"] for i in self.get("/api/memories", source="own", project="beta")["items"]], ["beta"])
        self.assertEqual({i["type"] for i in self.get("/api/memories", source="own", type="decision")["items"]}, {"decision"})

    def test_fts_syntax_in_query_is_inert(self):
        status, _ = self.portal.get("/api/memories", {"source": "own", "q": 'a" OR (NEAR'})
        self.assertEqual(status, 200)

    def test_detail_and_topic_history(self):
        items = self.get("/api/memories", source="own", q="widgets")["items"]
        self.assertTrue(items)
        detail = self.get("/api/memory", source="own", id=items[0]["id"])
        self.assertIn("widgets", detail["content"])
        self.assertEqual(detail["title"], fx.XSS)
        hist = self.get("/api/memory/history", source="own", topic_key="arch/widgets", project="alpha")
        self.assertTrue(hist["items"])
        self.assertEqual(max(i["revision"] for i in hist["items"]), 2)

    def test_engram_is_read_only_and_uses_its_revision_column(self):
        before = (self.f["engram"].stat().st_mtime_ns, self.f["engram"].read_bytes())
        r = self.get("/api/memories", source="engram")
        self.assertEqual([(i["title"], i["revision"]) for i in r["items"]], [("Engram bug", 3)])
        self.assertIn("frobnicator", self.get("/api/memory", source="engram", id=1)["content"])
        self.assertEqual((self.f["engram"].stat().st_mtime_ns, self.f["engram"].read_bytes()), before)

    def test_engram_not_found_or_incompatible_is_graceful(self):
        p = api.Portal(Config(state_dir=self.f["state"], claude_home=self.f["home"], engram_db=self.root / "missing.db"))
        status, body = p.get("/api/memories", {"source": "engram"})
        self.assertEqual((status, body["available"], body["items"]), (200, False, []))
        odd = self.root / "odd.db"
        sqlite3.connect(odd).execute("CREATE TABLE unrelated (x)").connection.commit()
        p = api.Portal(Config(state_dir=self.f["state"], claude_home=self.f["home"], engram_db=odd))
        self.assertFalse(p.get("/api/memories", {"source": "engram"})[1]["available"])

    def test_unknown_source_is_400(self):
        self.assertEqual(self.portal.get("/api/memories", {"source": "nope"})[0], 400)

    def test_claude_file_memories_listed_and_read_only_when_listed(self):
        files = self.get("/api/memory-files")["items"]
        self.assertEqual([f["name"] for f in files], ["note.md"])
        body = self.get("/api/memory-file", id=files[0]["id"])
        self.assertIn(fx.XSS, body["content"])  # raw text; the UI renders it with textContent
        for bad in ("../../settings.json", "/etc/passwd", "projects/-work-alpha/other.md", ""):
            self.assertEqual(self.portal.get("/api/memory-file", {"id": bad})[0], 404, bad)

    def test_graphify_stats_and_unconfigured(self):
        g = self.get("/api/graphify")
        self.assertEqual((g["available"], g["nodes"], g["edges"]), (True, 3, 1))
        p = api.Portal(Config(state_dir=self.f["state"], claude_home=self.f["home"]))
        self.assertFalse(p.get("/api/graphify", {})[1]["available"])
        bad = self.root / "bad.json"
        bad.write_text("{nope")
        p = api.Portal(Config(state_dir=self.f["state"], claude_home=self.f["home"], graphify=bad))
        self.assertEqual(p.get("/api/graphify", {})[0], 200)


class HarnessViewsTest(ApiBase):
    def test_harness_summary_hides_secrets(self):
        h = self.get("/api/harness")
        self.assertEqual((h["installed"], h["version"], h["rdd_mode"], h["telemetry"], h["managed_files"]), (True, "0.1.0", "on", True, 2))
        kinds = {(x["event"], x["kind"]) for x in h["hooks"]}
        self.assertIn(("Stop", "usage"), kinds)
        self.assertIn(("SessionStart", "review-stop"), kinds)
        self.assertIn(("Stop", "other"), kinds)
        blob = json.dumps(h)
        self.assertNotIn("SECRET-USER-HOOK", blob)
        self.assertNotIn("SECRET-ENV", blob)
        self.assertEqual({m["name"] for m in h["mcp_servers"]}, {"engram", "other"})

    def test_not_installed(self):
        p = api.Portal(Config(state_dir=self.root / "none", claude_home=self.root / "none"))
        self.assertFalse(p.get("/api/harness", {})[1]["installed"])

    def test_odd_progress_counts_top_level_checkboxes(self):
        o = self.get("/api/odd")
        (repo,) = o["repos"]
        (doc,) = repo["documents"]
        self.assertEqual((doc["done"], doc["total"]), (2, 3))
        self.assertEqual([t["done"] for t in doc["tasks"]], [True, False, True])
        p = api.Portal(Config(state_dir=self.f["state"], claude_home=self.f["home"], repos=[self.root / "norepo"]))
        self.assertEqual(p.get("/api/odd", {})[1]["repos"][0]["documents"], [])


class RefreshTest(ApiBase):
    def test_refresh_ingests_new_transcript_lines(self):
        from python.tests.test_usage import assistant, write_jsonl

        write_jsonl(self.f["home"] / "projects" / "-work-alpha" / "s1.jsonl", [assistant("a3", session="s1", ts="2026-10-03T10:00:00.000Z", cwd="/work/alpha")], mode="a")
        status, body = self.portal.refresh()
        self.assertEqual((status, body["messages"]), (200, 1))
        self.assertEqual(self.portal.refresh()[1]["messages"], 0)


class CliTest(unittest.TestCase):
    def test_no_host_option_exists(self):
        env = {**os.environ, "PYTHONPATH": str(ROOT / "python")}
        r = subprocess.run([sys.executable, "-P", "-m", "gentle_lite.portal", "--host", "0.0.0.0"], capture_output=True, text=True, env=env, timeout=30)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("unrecognized", r.stderr)

    def test_no_network_client_imports(self):
        import re

        pattern = re.compile(r"urllib\.request|http\.client|import requests|create_connection")
        for f in (ROOT / "python" / "gentle_lite" / "portal").glob("*.py"):
            self.assertIsNone(pattern.search(f.read_text()), str(f))


if __name__ == "__main__":
    unittest.main()
