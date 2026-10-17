import sqlite3

from python.amauta.graph import sync
from python.amauta.memory import store as mstore
from python.tests import portal_fixtures as fx
from python.tests import test_graph as tg
from python.tests.test_portal_wiki import WikiBase


class Saver(WikiBase):
    def save(self, title, content, **kw):
        st = mstore.Store(self.f["state"] / "memory.db")
        try:
            return st.save(title, content, type=kw.pop("type", "note"), project=kw.pop("project", "alpha"), **kw)
        finally:
            st.close()

    def refs(self, items):
        return {(x["kind"], x["title"]) for x in items}


class TitleDedupTest(Saver):
    def test_feature_page_drops_a_leading_h1_equal_to_the_title(self):
        pg = self.page("feature", "feat")
        self.assertEqual(pg["title"], "Feature")
        self.assertFalse(pg["body_md"].lstrip().startswith("#"))
        self.assertIn("T1 Done thing", pg["body_md"])

    def test_feature_prefix_and_case_are_ignored_and_other_headings_stay(self):
        (self.f["repo"] / "odd" / "tasks" / "other.md").write_text("# Feature: Portal Wiki\n\n## Objective\n\ntext\n# Portal wiki\n")
        pg = self.page("feature", "other")
        self.assertEqual(pg["title"], "Feature: Portal Wiki")
        self.assertTrue(pg["body_md"].startswith("## Objective"))
        self.assertIn("# Portal wiki", pg["body_md"])  # only the leading heading is dropped

    def test_memory_content_repeating_its_title_is_trimmed_but_a_different_heading_is_kept(self):
        self.save("Gadgets topic", "# gadgets TOPIC\n\nbody")
        self.save("Second note", "# Something else\n\nbody")
        self.assertEqual(self.page("memory", "Gadgets topic")["body_md"], "body")
        self.assertTrue(self.page("memory", "Second note")["body_md"].startswith("# Something else"))


class MemoryHistoryTest(Saver):
    def test_own_store_states_it_keeps_the_latest_revision_only(self):
        h = self.page("memory", "1")["history"]
        self.assertFalse(h["available"])
        self.assertIn("latest revision only", h["note"])
        self.assertEqual(h["diffs"], [])

    def test_a_revisions_table_gives_a_list_and_line_diffs_between_consecutive_revisions(self):
        e = sqlite3.connect(self.f["engram"])
        e.execute("CREATE TABLE observation_revisions (id INTEGER PRIMARY KEY, observation_id INTEGER, title TEXT, content TEXT, created_at TEXT)")
        e.execute("INSERT INTO observation_revisions (observation_id, title, content, created_at) VALUES (1, 'v1', ?, '2026-09-01T00:00:00Z')", ("one\ntwo\nthree",))
        e.execute("INSERT INTO observation_revisions (observation_id, title, content, created_at) VALUES (1, 'v2', ?, '2026-09-01T12:00:00Z')", ("one\nTWO\nthree\n" + fx.XSS,))
        e.commit()
        e.close()
        h = self.page("memory", "1", source="engram")["history"]
        self.assertTrue(h["available"])
        self.assertEqual([r["title"] for r in h["revisions"]], ["v1", "v2"])
        first = h["diffs"][0]
        self.assertEqual((first["from"], first["to"]), (1, 2))
        ops = [(ln["op"], ln["text"]) for ln in first["lines"]]
        self.assertIn(("-", "two"), ops)
        self.assertIn(("+", "TWO"), ops)
        self.assertIn(("+", fx.XSS), ops)  # raw data, the UI uses text nodes
        self.assertIn((" ", "one"), ops)
        last = h["diffs"][-1]  # newest stored revision against the current content
        self.assertEqual((last["from"], last["to"]), (2, "current"))

    def test_diffs_are_capped(self):
        e = sqlite3.connect(self.f["engram"])
        e.execute("CREATE TABLE observation_revisions (id INTEGER PRIMARY KEY, observation_id INTEGER, title TEXT, content TEXT, created_at TEXT)")
        for n in range(30):
            e.execute("INSERT INTO observation_revisions (observation_id, title, content) VALUES (1, ?, ?)", (f"v{n}", "\n".join(f"line {n} {i}" for i in range(500))))
        e.commit()
        e.close()
        h = self.page("memory", "1", source="engram")["history"]
        self.assertLessEqual(len(h["diffs"]), 10)
        self.assertTrue(all(len(d["lines"]) <= 200 for d in h["diffs"]))
        self.assertLessEqual(len(h["revisions"]), 50)

    def test_an_unrelated_table_with_the_wrong_columns_is_ignored(self):
        e = sqlite3.connect(self.f["engram"])
        e.execute("CREATE TABLE observation_revisions (x TEXT)")
        e.commit()
        e.close()
        self.assertFalse(self.page("memory", "1", source="engram")["history"]["available"])


class MemoryRelationsTest(Saver):
    def test_topic_hierarchy_links_parent_and_child_both_ways(self):
        self.save("Widget parts", "parts", topic_key="arch/widgets/parts")
        child = self.page("memory", "arch/widgets/parts")
        self.assertIn(("memory", fx.XSS), self.refs(child["links"]))  # parent arch/widgets
        parent = self.page("memory", "arch/widgets")
        self.assertIn(("memory", "Widget parts"), self.refs(parent["backlinks"]))
        self.assertNotIn(("memory", "Widget parts"), self.refs(child["backlinks"]))

    def test_plain_text_mentions_of_topic_keys_and_long_titles_link_both_ways(self):
        self.save("Deployment strategy notes", "deploy text", topic_key="ops/deployment-strategy")
        self.save("Reader", "We follow ops/deployment-strategy, and the DEPLOYMENT STRATEGY NOTES, here.")
        reader = self.page("memory", "Reader")
        self.assertIn(("memory", "Deployment strategy notes"), self.refs(reader["links"]))
        target = self.page("memory", "ops/deployment-strategy")
        self.assertIn(("memory", "Reader"), self.refs(target["backlinks"]))
        self.assertEqual(len([x for x in reader["links"] if x["title"] == "Deployment strategy notes"]), 1)  # once, though mentioned twice

    def test_mentions_do_not_false_positive(self):
        self.save("Deployment strategy notes", "x", topic_key="ops/deployment-strategy")
        self.save("Short title", "x")  # 11 chars: too short to match by title
        self.save("Reader", "ops/deployment-strategy-two, xops/deployment-strategy, Deployment strategy notesX, short title, ops/deployment, [[none]]")
        links = self.refs(self.page("memory", "Reader")["links"])
        self.assertNotIn(("memory", "Deployment strategy notes"), links)
        self.assertNotIn(("memory", "Short title"), links)

    def test_mentions_and_graph_relations_are_capped(self):
        for n in range(25):
            self.save(f"Mentionable title number {n:02d}", "x")
        self.save("Hub", " ".join(f"Mentionable title number {n:02d}" for n in range(25)))
        hub = self.page("memory", "Hub")
        self.assertLessEqual(len([x for x in hub["links"] if x["kind"] == "memory"]), 20)

    def test_graph_nodes_whose_label_appears_in_the_text_are_related(self):
        g = dict(tg.GRAPH)
        g["nodes"] = g["nodes"] + [tg.node("wr", "WidgetRenderer"), tg.node("tiny", "tiny")]
        tg.write_graph(self.f["repo"], g)
        c = mstore.connect(self.f["state"] / "memory.db")
        sync.sync_repo(c, self.f["repo"])
        c.close()
        self.save("Renderer note", "The WidgetRenderer draws tiny things, not Alphabet soup.")
        pg = self.page("memory", "Renderer note")
        nodes = [(x["id"], x["title"]) for x in pg["links"] if x["kind"] == "node"]
        self.assertEqual(nodes, [("repo::wr", "WidgetRenderer")])  # "tiny" is too short, "Alpha" only occurs inside "Alphabet"


class MemoryFilePageTest(WikiBase):
    FILE_ID = "-work-alpha/memory/note.md"

    def test_a_file_memory_has_a_read_only_wiki_page(self):
        pg = self.page("memfile", self.FILE_ID)
        self.assertEqual((pg["kind"], pg["id"], pg["title"]), ("memfile", self.FILE_ID, "note.md"))
        self.assertIn(fx.XSS, pg["body_md"])  # raw data; the UI renders text nodes
        m = {x["label"]: x for x in pg["meta"]}
        self.assertEqual(m["Project"]["value"], "-work-alpha")
        self.assertEqual(m["Size"].get("fmt"), "number")
        self.assertIn("Modified", m)
        self.assertEqual(set(pg), {"kind", "id", "title", "body_md", "meta", "links", "backlinks", "sections", "missing"})

    def test_only_listed_memory_files_can_be_read(self):
        (self.f["home"] / "secret.md").write_text("LEAK")
        (self.f["home"] / "projects" / "-work-alpha" / "other.md").write_text("LEAK2")  # not under memory/
        for ident in ("../../secret.md", "-work-alpha/other.md", "-work-alpha/memory/../other.md", "/etc/passwd", "-work-alpha/memory/nope.md", "x"):
            self.assertEqual(self.status("/api/wiki/page", kind="memfile", id=ident), 404, ident)

    def test_a_symlinked_memory_file_is_not_served(self):
        target = self.f["home"] / "secret.md"
        target.write_text("LEAK")
        (self.f["home"] / "projects" / "-work-alpha" / "memory" / "link.md").symlink_to(target)
        self.assertEqual(self.status("/api/wiki/page", kind="memfile", id="-work-alpha/memory/link.md"), 404)

    def test_wikilinks_inside_a_memory_file_resolve(self):
        (self.f["home"] / "projects" / "-work-alpha" / "memory" / "linky.md").write_text("see [[arch/widgets]] and [[gone-thing]]\n")
        pg = self.page("memfile", "-work-alpha/memory/linky.md")
        self.assertEqual([(r["kind"], r["title"]) for r in pg["links"] if r["kind"] == "memory"][0][0], "memory")
        self.assertEqual([m["id"] for m in pg["missing"]], ["gone-thing"])


class EngramPageSourceTest(WikiBase):
    def test_engram_page_marks_its_memory_links_with_the_source(self):
        import sqlite3
        e = sqlite3.connect(self.f["engram"])
        e.execute("INSERT INTO observations (id, type, title, content, project, scope, topic_key, revision_count, created_at, updated_at) "
                  "VALUES (2, 'note', 'Pointer', 'see [[bug/frob]]', 'alpha', 'project', 'bug/pointer', 1, '2026-09-03T00:00:00Z', '2026-09-03T00:00:00Z')")
        e.commit()
        e.close()
        pg = self.page("memory", "1", source="engram")
        self.assertEqual([r["id"] for r in pg["backlinks"]], ["2"])
        self.assertEqual(pg["title"], "Engram bug")
        refs = pg["links"] + pg["backlinks"] + [i for s in pg["sections"] for i in s["items"] if i.get("kind") == "memory"]
        for r in refs:
            if r["kind"] == "memory":
                self.assertEqual(r.get("source"), "engram", r)

    def test_own_page_links_carry_no_source(self):
        for r in self.page("memory", "1")["links"]:
            self.assertNotIn("source", r)
