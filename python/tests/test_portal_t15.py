"""T15 W1: caps and counts. A list cut for length says how many there are and where the rest is; counts are real."""
import json
import os
import time
import unittest
from unittest import mock

from python.amauta.graph import query as graph_query

from python.amauta.memory import store as mstore
from python.amauta.portal import diagrams, wikiproject, wikiusage
from python.amauta.portal.server import STATIC
from python.amauta.usage import ingest
from python.tests import test_portal_projects as tp
from python.tests import test_portal_wiki_tools as tt
from python.tests.test_portal_wiki import WikiBase
from python.tests.test_usage import assistant, tool_use, write_jsonl


class FeatureDiagramsTest(tp.ProjectBase):
    def add_features(self, n):
        for i in range(n):
            (self.f["repo"] / "odd" / "tasks" / f"extra-{i:02d}.md").write_text("# Extra\n\n- [x] T1 one\n- [ ] T2 two\n")

    def test_eleven_features_draw_eleven_diagrams_and_say_so(self):
        self.add_features(10)
        pg = self.page("project", "repo")
        self.assertEqual(len(pg["odd_diagrams"]), 11)
        self.assertEqual(pg["odd_diagrams_total"], 11)

    def test_a_cut_list_still_reports_the_real_total(self):
        self.add_features(10)
        with mock.patch.object(wikiproject, "MAX_DIAGRAMS", 3):
            pg = self.page("project", "repo")
        self.assertEqual((len(pg["odd_diagrams"]), pg["odd_diagrams_total"]), (3, 11))


class NodePageCountsTest(WikiBase):
    def meta(self, ident):
        return {m["label"]: m["value"] for m in self.page("node", ident)["meta"]}

    def test_counts_are_real_even_when_the_edge_list_is_cut(self):
        with mock.patch.object(graph_query, "EDGE_LIMIT", 1):
            m = self.meta("repo::a")
        self.assertEqual((m["Outgoing edges"], m["Incoming edges"]), ("2", "0"))
        self.assertEqual(m["Edges listed"], "1 of 2")

    def test_nothing_is_said_when_every_edge_is_listed(self):
        self.assertNotIn("Edges listed", self.meta("repo::a"))


class NodeListPagingTest(WikiBase):
    def ids(self, **q):
        return [n["id"] for n in self.get("/api/graph/nodes", repo=str(self.f["repo"].resolve()), vendored="1", order="name", **q)["items"]]

    def test_offset_pages_through_the_same_order(self):
        everything = self.ids()
        self.assertGreater(len(everything), 4)
        self.assertEqual(self.ids(limit=3), everything[:3])
        self.assertEqual(self.ids(limit=3, offset=3), everything[3:6])
        self.assertEqual(self.ids(limit=3, offset=len(everything)), [])


class DiagramCapTest(WikiBase):
    """D10: the node count of a neighbourhood that hit the server cap is a floor, and the API says so."""

    def diagram(self, **q):
        return self.get("/api/graph/diagram", repo=str(self.f["repo"].resolve()), node="a", **q)

    def test_a_cut_neighbourhood_is_capped(self):
        with mock.patch.object(graph_query, "NODE_LIMIT", 2):
            d = self.diagram(depth=2)
        self.assertEqual((d["nodes"], d["capped"]), (2, True))

    def test_a_complete_neighbourhood_is_not(self):
        self.assertFalse(self.diagram(depth=2)["capped"])

    def test_the_node_page_diagram_says_the_same(self):
        with mock.patch.object(graph_query, "NODE_LIMIT", 2):
            self.assertTrue(self.page("node", "repo::a")["diagram"]["capped"])


class ToolPageCountsTest(tt.ToolsBase):
    """D4 and D3: the sessions list says how many there are in all, and the 30-day chart ends on the local day."""

    def add_sessions(self, n, tz_ts="2026-10-06T10:00:00.000Z"):
        for i in range(n):
            write_jsonl(self.f["home"] / "projects" / "-many" / f"b{i}.jsonl",
                        [assistant(f"b{i}-m", [tool_use("Bash", f"t{i}")], session=f"b{i}", ts=tz_ts, cwd="/work/many")])
        conn = mstore.connect(self.f["state"] / "memory.db")
        ingest.backfill(conn, self.f["home"])
        conn.close()

    def test_every_session_is_listed_up_to_a_cap(self):
        self.add_sessions(30)
        pg = self.page("tool", "Bash")
        sessions = [b for b in pg["backlinks"] if b["kind"] == "session"]
        self.assertEqual((len(sessions), pg["backlinks_more"]), (32, 0))
        self.assertEqual(self.meta(pg)["Sessions"], "32")

    def test_a_cut_session_list_says_how_many_are_missing(self):
        self.add_sessions(30)
        with mock.patch.object(wikiusage, "SESSION_REFS", 20):
            pg = self.page("tool", "Bash")
        self.assertEqual((len([b for b in pg["backlinks"] if b["kind"] == "session"]), pg["backlinks_more"]), (20, 12))

    def test_the_thirty_day_window_ends_on_the_local_day_of_the_last_call(self):
        self.addCleanup(lambda: (os.environ.pop("TZ", None), time.tzset()))
        os.environ["TZ"] = "America/Bogota"  # UTC-5: 2026-10-05T02:00Z is still 2026-10-04 here
        time.tzset()
        write_jsonl(self.f["home"] / "projects" / "-late" / "late.jsonl",
                    [assistant("late-m", [tool_use("Glob", "g1")], session="late", ts="2026-10-05T02:00:00.000Z", cwd="/work/late")])
        conn = mstore.connect(self.f["state"] / "memory.db")
        ingest.backfill(conn, self.f["home"])
        conn.close()
        daily = self.page("tool", "Glob")["usage"]["daily"]
        self.assertEqual(daily[-1], {"day": "2026-10-04", "value": 1})
        self.assertEqual(len(daily), 30)


class HarnessDiagramCountTest(unittest.TestCase):
    """C4/E4: the diagram counts the files amauta installed (its manifest), so it says so; the runtimes table and the Catalog count more."""

    def test_the_portal_node_names_what_it_counts(self):
        hs = {"installed": True, "version": "0.5.0", "skills": 32, "agents": 23, "hooks": [], "mcp_servers": []}
        src = diagrams.workflow(hs, "/s")
        self.assertIn("32 skills and 23 agents installed by amauta", src)

    def test_the_label_is_translated_like_every_server_string(self):
        catalog = json.loads((STATIC / "i18n" / "srv-es.json").read_text())
        self.assertIn("Portal: reads memory.db only \u00b7 {n} skills and {m} agents installed by amauta", catalog)


class CodexSessionNoteTest(WikiBase):
    """D6: Codex tool calls are not recorded (rollouts are read for tokens only), so a Codex session page says so."""

    def setUp(self):
        super().setUp()
        from python.amauta.usage import codex
        from python.tests.test_portal_runtime import add_codex, CSID
        self.sid = CSID
        home = self.root / "codex"
        add_codex(self.root, home)
        conn = mstore.connect(self.f["state"] / "memory.db")
        codex.backfill(conn, home)
        conn.close()

    def test_a_codex_session_says_its_tool_calls_are_not_recorded(self):
        sections = {s["heading"]: s for s in self.page("session", self.sid)["sections"]}
        self.assertIn("not recorded", sections["Tool calls"]["items"][0]["label"])

    def test_a_claude_session_has_no_such_note(self):
        self.assertNotIn("Tool calls", {s["heading"] for s in self.page("session", "s1")["sections"]})

    def test_the_note_is_translated(self):
        catalog = json.loads((STATIC / "i18n" / "srv-es.json").read_text())
        self.assertIn("Tool calls", catalog)
        self.assertIn(wikiusage.CODEX_NOTE, catalog)
