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


class NodeListConceptsTest(WikiBase):
    """D8 / B9: the node list opens on the project's own code (nodes with a source file); concept nodes stay one option away."""

    def setUp(self):
        super().setUp()
        import sqlite3
        self.key = str(self.f["repo"].resolve())
        c = sqlite3.connect(self.f["state"] / "memory.db")
        c.execute("INSERT INTO graph_nodes (repo, id, label, kind, file) VALUES (?, 'ref_os', 'os', 'concept', '')", (self.key,))
        c.execute("INSERT INTO graph_nodes (repo, id, label, kind, file) VALUES (?, 'v1', 'vendored thing', 'code', 'web/lib.min.js')", (self.key,))
        c.execute("INSERT INTO graph_nodes (repo, id, label, kind, file) VALUES (?, 'v2', 'vendored idea', 'concept', 'web/lib.min.js')", (self.key,))
        c.commit()
        c.close()

    def nodes(self, **q):
        return self.get("/api/graph/nodes", repo=self.key, **q)

    def test_the_default_list_leaves_out_nodes_without_a_source_file_and_counts_them(self):
        d = self.nodes()
        self.assertNotIn("ref_os", [n["id"] for n in d["items"]])
        self.assertTrue(all(n["file"] for n in d["items"]))
        self.assertEqual(len(d["items"]), d["matched"] - d["hidden"])
        self.assertEqual(d["hidden"], 3)  # the concept, the vendored code node, the vendored concept (counted once)

    def test_concepts_one_brings_them_back_and_the_counts_stay_honest(self):
        d = self.nodes(concepts="1")
        self.assertIn("ref_os", [n["id"] for n in d["items"]])
        self.assertEqual(d["hidden"], 2)  # only the two vendored ones
        everything = self.nodes(concepts="1", vendored="1")
        self.assertEqual((len(everything["items"]), everything["hidden"]), (everything["matched"], 0))

    def test_search_still_finds_a_concept_only_with_the_option_on(self):
        self.assertEqual(self.nodes(q="os")["items"], [])
        self.assertEqual([n["id"] for n in self.nodes(q="os", concepts="1")["items"]], ["ref_os"])


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


class SessionToolsLabelsTest(WikiBase):
    """W3 A5: the session page merges case variants of one tool, labels placeholder names and groups MCP tools by server."""

    def setUp(self):
        super().setUp()
        calls = [tool_use("Bash", "t1"), tool_use("bash", "t2"), tool_use("Bash", "t3"), tool_use("bash_placeholder", "t4"),
                 tool_use("mcp__engram__mem_save", "t5"), tool_use("mcp__engram__mem_context", "t6"), tool_use("mcp__codegraph__codegraph_explore", "t7")]
        write_jsonl(self.f["home"] / "projects" / "-w-a" / "sw3.jsonl",
                    [assistant("w3-a", calls, session="sw3", ts="2026-10-06T09:00:00.000Z", cwd="/work/a", model="claude-z"),
                     assistant("w3-b", [], session="sw3", ts="2026-10-06T09:01:00.000Z", cwd="/work/a", model="<synthetic>")])
        c = mstore.connect(self.f["state"] / "memory.db")
        ingest.backfill(c, self.f["home"])
        c.close()
        self.sections = {s["heading"]: s["items"] for s in self.page("session", "sw3")["sections"]}

    def test_case_variants_of_a_tool_are_one_row(self):
        names = [i["label"] for i in self.sections["Tools"]]
        self.assertEqual([n for n in names if n.lower() == "bash"], ["Bash"])
        self.assertEqual(next(i["value"] for i in self.sections["Tools"] if i["label"] == "Bash"), "3 calls")

    def test_placeholder_names_are_one_labelled_row(self):
        names = [i["label"] for i in self.sections["Tools"]]
        self.assertNotIn("bash_placeholder", names)
        self.assertIn("Placeholder entries (not tool calls)", names)

    def test_mcp_tools_are_grouped_by_server_not_listed_with_raw_names(self):
        self.assertFalse([i for i in self.sections["Tools"] if i["label"].startswith("mcp__")])
        grouped = self.sections["MCP tools"]
        self.assertEqual({i["label"] for i in grouped}, {"engram / mem_context", "engram / mem_save", "codegraph / codegraph_explore"})
        self.assertTrue(all(" / " in i["label"] for i in grouped))
        self.assertEqual([i["label"].split(" / ")[0] for i in grouped], sorted(i["label"].split(" / ")[0] for i in grouped))

    def test_the_synthetic_model_does_not_count_in_the_plus_n(self):
        rows = self.get("/api/sessions", days=3650)["sessions"]
        row = next(r for r in rows if r["session_id"] == "sw3")
        self.assertEqual((row["model"], row["models"]), ("claude-z", 1))


class MemoryFileProjectTest(WikiBase):
    """W3 B8: the memory files list and page name a project like #/memory does (no leading dash of the directory slug)."""

    def test_the_list_and_the_page_agree(self):
        item = self.get("/api/memory-files")["items"][0]
        self.assertEqual(item["project"], "work-alpha")
        meta = {m["label"]: m["value"] for m in self.page("memfile", item["id"])["meta"]}
        self.assertEqual(meta["Project"], "work-alpha")


class McpToolOriginTest(tt.ToolsBase):
    """W3 C5: the origin of an MCP tool says it once, and the refresh time is a value the page formats, not a raw label."""

    def test_the_origin_row_has_no_second_copy_of_the_source(self):
        pg = self.page("mcptool", "projsrv/other")
        for s in pg["sections"]:
            for it in s["items"]:
                self.assertNotEqual(it["label"], it.get("value"), s["heading"])

    def test_the_refresh_time_is_a_value(self):
        pg = self.page("mcptool", "projsrv/do_thing")
        refresh = next((s for s in pg["sections"] if s["heading"] == "Last refresh"), None)
        self.assertIsNotNone(refresh)
        self.assertEqual(refresh["items"][0]["label"], "Tool list read from the server")
        self.assertRegex(refresh["items"][0]["value"], r"^\d{4}-\d{2}-\d{2}")
