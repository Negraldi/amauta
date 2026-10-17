import os
import shutil
import subprocess
import unittest

from python.amauta.portal import wikifeature
from python.tests import portal_fixtures as fx
from python.tests.test_portal_wiki import WikiBase

GIT = shutil.which("git")
ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
       "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True, env=ENV).stdout.strip()


class HashExtractionTest(unittest.TestCase):
    def test_hashes_in_backticks_or_plain_are_found_once_in_order(self):
        text = "see `15fd38b` and e41ae64 then `15fd38b` again; also (d383531), 554a40b0c1de."
        self.assertEqual(wikifeature.extract_hashes(text), ["15fd38b", "e41ae64", "d383531", "554a40b0c1de"])

    def test_plain_text_needs_letters_and_digits_and_a_clean_boundary(self):
        text = "20261016 1234567 deadbeef abcdefabcdef notes: b67c928a1 xe41ae64 e41ae64x e41ae64-two 0123456789abc0 `1234567` `cafebabe`"
        self.assertEqual(wikifeature.extract_hashes(text), ["b67c928a1", "1234567", "cafebabe"])  # backticks admit all-digit and all-letter hashes

    def test_cap(self):
        text = " ".join(f"`{n:07x}`" for n in range(1, 200))
        self.assertEqual(len(wikifeature.extract_hashes(text)), wikifeature.MAX_HASHES)


@unittest.skipUnless(GIT, "git is not installed")
class FeatureCommitsTest(WikiBase):
    def setUp(self):
        super().setUp()
        repo = self.f["repo"]
        git(repo, "init", "-q")
        git(repo, "add", "-A")
        git(repo, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "feat: first <b>subject</b>")
        self.full = git(repo, "rev-parse", "HEAD")
        self.short = self.full[:9]

    def doc(self, text):
        (self.f["repo"] / "odd" / "tasks" / "feat.md").write_text(text)

    def test_resolves_hashes_to_subject_and_date_and_leaves_unknown_ones_plain(self):
        self.doc(f"# Feature\n\n- [x] T1 done (`{self.short}`)\n- [ ] T2 later, see deadbee and `abcdef1`\n")
        pg = self.page("feature", "feat")
        (c,) = pg["commits"]
        self.assertEqual((c["hash"], c["full"], c["subject"]), (self.short, self.full, "feat: first <b>subject</b>"))
        self.assertRegex(c["date"], r"^\d{4}-\d\d-\d\dT")
        self.assertIn("deadbee", pg["body_md"])  # unresolved stays in the document as text

    def test_progress_is_reported(self):
        self.assertEqual(self.page("feature", "feat")["progress"], {"done": 2, "total": 3, "percent": 67})

    def test_no_commits_without_a_git_repo_or_hashes(self):
        self.doc("# Feature\n\n- [x] T1\n")
        self.assertEqual(self.page("feature", "feat")["commits"], [])
        shutil.rmtree(self.f["repo"] / ".git")
        self.doc(f"# Feature\n\n- [x] T1 `{self.short}`\n")
        self.assertEqual(self.page("feature", "feat")["commits"], [])

    def test_hostile_hashes_are_never_passed_to_git(self):
        for bad in ("--output=/tmp/pwned", "-p", "HEAD", "g123456", "abc", "a" * 13, "`;touch x;`", "$(id)abcdef1", "abcdef1\nHEAD", "abcdef1 --all"):
            self.assertIsNone(wikifeature.resolve(self.f["repo"], bad), bad)
        self.assertEqual(wikifeature.resolve(self.f["repo"], self.short)["full"], self.full)

    def test_a_missing_git_binary_or_timeout_degrades_to_plain_text(self):
        from unittest import mock
        with mock.patch("subprocess.run", side_effect=FileNotFoundError()):
            self.assertIsNone(wikifeature.resolve(self.f["repo"], self.short))
        with mock.patch("subprocess.run", side_effect=subprocess.TimeoutExpired("git", 5)):
            self.assertIsNone(wikifeature.resolve(self.f["repo"], self.short))


class FeatureProgressTest(WikiBase):
    def test_commits_key_exists_even_for_plain_directories(self):
        pg = self.page("feature", "feat")
        self.assertEqual(pg["commits"], [])
        self.assertEqual(pg["progress"]["total"], 3)


class NodePageTest(WikiBase):
    def test_neighbors_are_grouped_by_relation_and_direction(self):
        pg = self.page("node", "repo::a")
        sec = {s["heading"]: s for s in pg["sections"]}
        self.assertEqual([(i["label"], i["id"]) for i in sec["calls (outgoing)"]["items"]], [("Beta", "repo::b")])
        self.assertEqual([(i["label"], i["id"]) for i in sec["references (outgoing)"]["items"]], [(fx.XSS, "repo::e")])
        b = {s["heading"]: s for s in self.page("node", "repo::b")["sections"]}
        self.assertEqual([i["label"] for i in b["calls (incoming)"]["items"]], ["Alpha"])
        self.assertEqual([i["label"] for i in b["imports (outgoing)"]["items"]], ["Gamma"])
        self.assertEqual(self.page("node", "repo::iso")["sections"], [])

    def test_meta_counts_neighbors(self):
        m = {x["label"]: x["value"] for x in self.page("node", "repo::a")["meta"]}
        self.assertEqual((m["Outgoing edges"], m["Incoming edges"]), ("2", "0"))

    def test_neighborhood_diagram_source_is_generated_and_escaped(self):
        d = self.page("node", "repo::a")["diagram"]
        self.assertEqual((d["nodes"], d["truncated"]), (3, False))
        self.assertIn("Alpha", d["source"])
        self.assertIn("flowchart", d["source"])
        self.assertNotIn("<img", d["source"])
        self.assertTrue(self.page("node", "repo::iso")["diagram"]["source"])  # an isolated node is still drawn

    def test_diagram_is_capped(self):
        from python.amauta.graph import sync
        from python.amauta.memory import store as mstore
        from python.tests import test_graph as tg
        g = {"nodes": [tg.node("hub", "Hub")] + [tg.node(f"n{i}", f"Leaf {i}") for i in range(80)], "links": [tg.edge("hub", f"n{i}") for i in range(80)]}
        tg.write_graph(self.f["repo"], g)
        c = mstore.connect(self.f["state"] / "memory.db")
        sync.sync_repo(c, self.f["repo"])
        c.close()
        d = self.page("node", "repo::hub")["diagram"]
        self.assertLessEqual(d["source"].count("-->"), 40)


class ParseTasksTest(unittest.TestCase):
    DOC = """# Feature

## Tasks

F0 Design (impeccable)
- [x] W1 first
- [ ] W2 second

F1 Wiki shell
- [x] W3 third
- [ ] W4 blocked by the user, BLOCKED on review
- [!] W5 explicit mark

### Later work
- [ ] W6 under a markdown heading

## Notes
- [ ] not a task heading but still a checkbox
"""

    def test_phase_from_bare_lines_and_markdown_headings_and_blocked_marks(self):
        t = wikifeature.parse_tasks(self.DOC)
        self.assertEqual([x["title"][:2] for x in t], ["W1", "W2", "W3", "W4", "W5", "W6", "no"])
        self.assertEqual([x["phase"] for x in t], ["F0 Design (impeccable)"] * 2 + ["F1 Wiki shell"] * 3 + ["Later work", "Notes"])
        self.assertEqual([x["done"] for x in t], [True, False, True, False, False, False, False])
        self.assertEqual([x["blocked"] for x in t], [False, False, False, True, True, False, False])

    def test_a_doc_without_headings_has_no_phase_and_the_generic_heading_is_ignored_when_alone(self):
        t = wikifeature.parse_tasks("- [x] a\n- [ ] b\n")
        self.assertEqual([x["phase"] for x in t], [None, None])
        t = wikifeature.parse_tasks("## Tasks\n- [x] a\n- [ ] b\n")
        self.assertEqual([x["phase"] for x in t], [None, None])  # a single phase is no grouping

    def test_titles_are_capped_and_prose_lines_are_not_phases(self):
        t = wikifeature.parse_tasks("Some prose sentence that ends here.\n- [ ] " + "x" * 400 + "\n")
        self.assertEqual(len(t[0]["title"]), 160)
        self.assertIsNone(t[0]["phase"])


class FeatureDiagramTest(WikiBase):
    def doc(self, text):
        (self.f["repo"] / "odd" / "tasks" / "feat.md").write_text(text)

    def test_feature_page_has_a_grouped_diagram_source(self):
        self.doc("# F\n\nP1 First\n- [x] T1 a\n- [ ] T2 b\n\nP2 Second\n- [!] T3 c\n")
        d = self.page("feature", "feat")["diagram"]
        self.assertEqual((d["tasks"], d["shown"]), (3, 3))
        self.assertEqual(d["source"].count("subgraph "), 2)
        self.assertIn("blocked", d["source"])

    def test_no_tasks_means_no_diagram(self):
        self.doc("# F\n\njust text\n")
        self.assertIsNone(self.page("feature", "feat")["diagram"])

    def test_feature_page_diagram_groups_tasks_by_phase(self):
        self.doc("# F\n\nP1 First\n- [x] T1 a\n\nP2 Second\n- [ ] T2 b\n")
        self.assertEqual(self.page("feature", "feat")["diagram"]["source"].count("subgraph "), 2)
