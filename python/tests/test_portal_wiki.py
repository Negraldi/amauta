import json
import tempfile
import unittest
from pathlib import Path

from python.amauta.memory import store as mstore
from python.amauta.portal import api
from python.amauta.portal.config import Config
from python.tests import portal_fixtures as fx
from python.tests.test_portal import ApiBase

EXTRA_KEYS = {"memory": {"history"}, "skill": {"usage", "impact"}, "tool": {"usage"}, "mcp": {"usage"}, "feature": {"progress", "commits", "diagram"}, "node": {"truncated", "diagram"}}
PAGE_KEYS = {"kind", "id", "title", "body_md", "meta", "links", "backlinks", "sections", "missing"}


class WikiBase(ApiBase):
    def page(self, kind, ident, **q):
        return self.get("/api/wiki/page", kind=kind, id=ident, **q)

    def status(self, path, **q):
        return self.portal.get(path, {k: str(v) for k, v in q.items()})[0]

    def meta(self, pg):
        return {m["label"]: m["value"] for m in pg["meta"]}


class PageSchemaTest(WikiBase):
    def test_every_served_kind_returns_the_common_schema(self):
        key = "repo::a"
        for kind, ident in (("memory", "1"), ("skill", "work-unit-commits"), ("tool", "Bash"), ("mcp", "engram"), ("session", "s1"), ("feature", "feat"), ("node", key)):
            pg = self.page(kind, ident)
            self.assertEqual(set(pg), PAGE_KEYS | EXTRA_KEYS.get(kind, set()), kind)
            self.assertEqual((pg["kind"], pg["id"] if kind != "memory" else "1"), (kind, ident), kind)
            for k in ("meta", "links", "backlinks", "sections", "missing"):
                self.assertIsInstance(pg[k], list, (kind, k))

    def test_bad_requests_and_unknown_pages(self):
        self.assertEqual(self.status("/api/wiki/page"), 400)
        self.assertEqual(self.status("/api/wiki/page", kind="memory"), 400)
        self.assertEqual(self.status("/api/wiki/page", kind="memory", id="x" * 600), 400)
        for kind, ident in (("nope", "1"), ("memory", "999"), ("memory", "no-such-topic"), ("skill", "nope"), ("tool", "nope"), ("mcp", "nope"),
                            ("session", "nope"), ("feature", "nope"), ("feature", "../../etc/passwd"), ("node", "repo::nope"), ("node", "other::a"), ("node", "a"), ("node", "repo::")):
            self.assertEqual(self.status("/api/wiki/page", kind=kind, id=ident), 404, (kind, ident))
        self.assertEqual(self.status("/api/wiki/page", kind="memory", id="1", source="evil"), 400)


class MemoryPageTest(WikiBase):
    def test_by_id_and_by_topic_key_with_revisions_and_raw_text(self):
        by_id, by_topic = self.page("memory", "1"), self.page("memory", "arch/widgets")
        self.assertEqual(by_id, by_topic)
        self.assertEqual(by_id["title"], fx.XSS)  # raw data; the UI renders text nodes
        self.assertEqual(by_id["body_md"], "body two about widgets revised")
        m = self.meta(by_id)
        self.assertEqual((m["Type"], m["Project"], m["Topic"], m["Revision"]), ("decision", "alpha", "arch/widgets", "2"))
        self.assertEqual(by_id["sections"], [])  # one row per topic_key: the row is not listed as its own revision
        self.assertFalse(by_id["history"]["available"])

    def test_wikilinks_siblings_and_backlinks_are_derived(self):
        st = mstore.Store(self.f["state"] / "memory.db")
        st.save("Gadgets topic", "see [[arch/widgets]] and [[skill:work-unit-commits|commits]] and [[missing-thing]] and [[node:repo::nope]]", type="note", topic_key="arch/gadgets", project="alpha")
        st.close()
        gadgets = self.page("memory", "arch/gadgets")
        self.assertEqual({(link["kind"], link["title"]) for link in gadgets["links"]}, {("memory", fx.XSS), ("skill", "work-unit-commits")})
        self.assertEqual({(x["kind"], x["id"]) for x in gadgets["missing"]}, {("memory", "missing-thing"), ("node", "repo::nope")})
        widgets = self.page("memory", "arch/widgets")
        self.assertEqual([(b["kind"], b["title"]) for b in widgets["backlinks"]], [("memory", "Gadgets topic")])
        self.assertIn(("memory", "Gadgets topic"), [(link["kind"], link["title"]) for link in widgets["links"]])  # same topic prefix

    def test_engram_source_and_closed_connection(self):
        pg = self.page("memory", "1", source="engram")
        self.assertEqual(pg["title"], "Engram bug")
        self.assertEqual(self.meta(pg)["Revision"], "3")

    def test_hostile_ids_are_inert(self):
        for ident in ("' OR 1=1 --", "%", "_", "[[x]]", "\x00", "\\", "arch/%"):
            self.assertEqual(self.status("/api/wiki/page", kind="memory", id=ident), 404, ident)


class UsagePagesTest(WikiBase):
    def test_skill_tool_mcp_pages(self):
        skill = self.page("skill", "work-unit-commits")
        self.assertEqual((self.meta(skill)["Calls"], self.meta(skill)["Sessions"]), ("1", "1"))
        self.assertEqual([(b["kind"], b["id"]) for b in skill["backlinks"]], [("session", "s1")])
        mcp = self.page("mcp", "engram")
        self.assertEqual([(x["kind"], x["id"]) for x in mcp["links"]], [("tool", "mcp__engram__mem_save")])
        tool = self.page("tool", "mcp__engram__mem_save")
        self.assertEqual([(x["kind"], x["id"]) for x in tool["links"]], [("mcp", "engram")])
        self.assertEqual(self.page("tool", "Bash")["links"], [])

    def test_session_page_links_what_it_used(self):
        pg = self.page("session", "s1")
        m = self.meta(pg)
        self.assertEqual((m["Project"], m["Messages"], m["Input tokens"]), ("alpha", "2", "150"))
        headings = {s["heading"]: s for s in pg["sections"]}
        self.assertIn(("skill", "work-unit-commits"), [(i["kind"], i["id"]) for i in headings["Skills"]["items"]])
        self.assertIn(("tool", "Bash"), [(i["kind"], i["id"]) for i in headings["Tools"]["items"]])
        self.assertIn("sdd-apply", [i["label"] for i in headings["Subagent types"]["items"]])
        self.assertIn(("skill", "work-unit-commits"), [(x["kind"], x["id"]) for x in pg["links"]])
        self.assertIn(("mcp", "engram"), [(x["kind"], x["id"]) for x in pg["links"]])

    def test_usage_pages_404_without_a_database(self):
        empty = api.Portal(Config(state_dir=self.root / "nowhere", claude_home=self.f["home"], repos=[]))
        self.assertEqual(empty.get("/api/wiki/page", {"kind": "skill", "id": "x"})[0], 404)
        self.assertEqual(empty.get("/api/wiki/recent", {})[1], {"items": []})
        self.assertEqual(empty.get("/api/wiki/search", {"q": "x"})[1]["groups"], [])


class FeatureAndNodePagesTest(WikiBase):
    def test_feature_page_has_the_document_and_task_progress(self):
        pg = self.page("feature", "feat")
        self.assertEqual(pg["title"], "Feature")
        self.assertIn("T2 Open thing", pg["body_md"])
        self.assertEqual(self.meta(pg)["Tasks done"], "2 of 3")
        (tasks,) = pg["sections"]
        self.assertEqual([(i["label"], i["value"]) for i in tasks["items"]][:2], [("T1 Done thing", "done"), ("T2 Open thing", "pending")])

    def test_feature_links_its_odd_memories(self):
        st = mstore.Store(self.f["state"] / "memory.db")
        st.save("feat tasks", "mirror", type="note", topic_key="odd/feat/tasks", project="alpha")
        st.close()
        self.assertEqual([(x["kind"], x["title"]) for x in self.page("feature", "feat")["links"]], [("memory", "feat tasks")])

    def test_node_page_splits_outgoing_and_incoming_edges(self):
        a = self.page("node", "repo::a")
        self.assertEqual(a["title"], "Alpha")
        self.assertEqual(self.meta(a)["Repository"], "repo")
        self.assertIn(("node", "repo::b", "Beta"), [(x["kind"], x["id"], x["title"]) for x in a["links"]])
        b = self.page("node", "repo::b")
        self.assertIn("repo::a", [x["id"] for x in b["backlinks"]])
        self.assertIn(("node", "repo::e", fx.XSS), [(x["kind"], x["id"], x["title"]) for x in a["links"]])


class RecentTest(WikiBase):
    def test_recent_merges_memories_sessions_and_documents_newest_first(self):
        items = self.get("/api/wiki/recent")["items"]
        self.assertEqual({i["kind"] for i in items}, {"memory", "session", "feature"})
        self.assertEqual([i["ts"] for i in items], sorted((i["ts"] for i in items), reverse=True))
        for i in items:
            self.assertEqual(set(i), {"kind", "id", "title", "ts", "what"})
        self.assertIn("memory revised (revision 2)", [i["what"] for i in items])

    def test_limit_is_validated_and_applied(self):
        self.assertEqual(len(self.get("/api/wiki/recent", limit=2)["items"]), 2)
        for bad in ("0", "101", "x"):
            self.assertEqual(self.status("/api/wiki/recent", limit=bad), 400, bad)


class SearchTest(WikiBase):
    def groups(self, q, **extra):
        return {g["kind"]: g for g in self.get("/api/wiki/search", q=q, **extra)["groups"]}

    def test_finds_every_kind_grouped_with_counts(self):
        self.assertEqual(self.groups("widgets")["memory"]["count"], 1)
        self.assertEqual(self.groups("work-unit")["skill"]["items"][0], {"kind": "skill", "id": "work-unit-commits", "title": "work-unit-commits", "snippet": "1 calls"})
        self.assertEqual(self.groups("Bash")["tool"]["items"][0]["id"], "Bash")
        self.assertEqual(self.groups("engram")["mcp"]["items"][0]["id"], "engram")
        self.assertEqual(self.groups("alpha")["session"]["items"][0]["id"], "s1")
        self.assertEqual(self.groups("feat")["feature"]["items"][0]["id"], "feat")
        task = self.groups("open thing")["task"]["items"][0]
        self.assertEqual((task["kind"], task["id"], task["title"]), ("feature", "feat", "T2 Open thing"))
        node = self.groups("alp")["node"]["items"][0]
        self.assertEqual((node["kind"], node["id"], node["title"]), ("node", "repo::a", "Alpha"))

    def test_only_matching_groups_are_returned_and_blank_queries_are_empty(self):
        self.assertEqual(list(self.groups("gadgets")), ["memory"])
        for q in ("", "   ", "\x00"):
            self.assertEqual(self.get("/api/wiki/search", q=q)["groups"], [], repr(q))
        self.assertEqual(self.get("/api/wiki/search")["groups"], [])

    def test_per_kind_cap(self):
        st = mstore.Store(self.f["state"] / "memory.db")
        for n in range(12):
            st.save(f"zebra {n}", "zebra content", type="note", project="alpha")
        st.close()
        g = self.groups("zebra", limit=3)["memory"]
        self.assertEqual((len(g["items"]), g["count"]), (3, 12))
        self.assertEqual(self.status("/api/wiki/search", q="x", limit=26), 400)

    def test_hostile_queries_never_error_or_inject(self):
        for q in ('" OR 1=1 --', "%", "_", "*", "NEAR(a b)", "a AND", "\\", "'; DROP TABLE observations;--", "(((", "x" * 5000, "[[a]]", "<img src=x onerror=1>"):
            self.assertEqual(self.status("/api/wiki/search", q=q), 200, q[:20])
        self.assertEqual(self.groups("%"), {})  # LIKE wildcards are literal: no item contains a percent sign
        self.assertEqual(self.groups("m_m"), {})  # would match "mem" if _ were a wildcard
        self.assertEqual(self.groups(fx.XSS)["memory"]["items"][0]["title"], fx.XSS)

    def test_search_is_read_only(self):
        db = self.f["state"] / "memory.db"
        before = db.stat().st_mtime_ns
        self.get("/api/wiki/search", q="widgets")
        self.get("/api/wiki/recent")
        self.page("memory", "1")
        self.assertEqual(db.stat().st_mtime_ns, before)


if __name__ == "__main__":
    unittest.main()
