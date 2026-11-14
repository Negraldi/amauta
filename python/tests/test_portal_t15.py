"""T15 W1: caps and counts. A list cut for length says how many there are and where the rest is; counts are real."""
from unittest import mock

from python.amauta.graph import query as graph_query

from python.amauta.portal import wikiproject
from python.tests import test_portal_projects as tp
from python.tests.test_portal_wiki import WikiBase


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
