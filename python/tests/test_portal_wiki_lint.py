import json

from python.amauta.memory import store as mstore
from python.amauta.portal import api, wikilint
from python.amauta.portal.config import Config
from python.tests.test_portal_wiki import WikiBase

IDS = ["orphans", "duplicates", "superseded", "unused_skills", "features_no_commits", "missing_links", "stale_notes"]


class LintBase(WikiBase):
    def lint(self, **q):
        return self.get("/api/wiki/lint", **q)

    def cat(self, name, **q):
        return {c["id"]: c for c in self.lint(**q)["categories"]}[name]

    def save(self, title, content="body", **kw):
        st = mstore.Store(self.f["state"] / "memory.db")
        kw.setdefault("type", "note")
        kw.setdefault("project", "alpha")
        try:
            return st.save(title, content, **kw)
        finally:
            st.close()

    def install_skill(self, name):
        d = self.f["home"] / "skills" / name
        d.mkdir(parents=True, exist_ok=True)
        (d / "SKILL.md").write_text(f"---\nname: {name}\n---\nBody\n")

    def feature(self, name, text):
        (self.f["repo"] / "odd" / "tasks" / f"{name}.md").write_text(text)


class ShapeTest(LintBase):
    def test_categories_are_stable_and_carry_counts_notes_and_items(self):
        out = self.lint()
        self.assertEqual([c["id"] for c in out["categories"]], IDS)
        for c in out["categories"]:
            self.assertEqual(set(c), {"id", "title", "note", "count", "items", "truncated"})
            self.assertGreaterEqual(c["count"], len(c["items"]))
            self.assertTrue(c["note"])
        self.assertEqual(out["window_days"], 30)

    def test_bad_window_is_a_400(self):
        self.assertEqual(self.status("/api/wiki/lint", days="0"), 400)
        self.assertEqual(self.status("/api/wiki/lint", days="x"), 400)

    def test_no_database_gives_empty_categories(self):
        empty = api.Portal(Config(state_dir=self.root / "nowhere", claude_home=self.f["home"], repos=[]))
        status, body = empty.get("/api/wiki/lint", {})
        self.assertEqual(status, 200)
        self.assertEqual([c["count"] for c in body["categories"]], [0] * 7)


class OrphanTest(LintBase):
    def test_unconnected_memories_are_orphans_and_connected_ones_are_not(self):
        base = {i["title"] for i in self.cat("orphans")["items"]}
        self.assertIn("Other note", base)
        self.assertEqual(self.cat("orphans")["count"], 2)
        self.save("Gadgets", "see [[arch/widgets]]", topic_key="arch/gadgets")
        titles = {i["title"] for i in self.cat("orphans")["items"]}
        self.assertNotIn("Gadgets", titles)  # it links out
        self.assertEqual(titles, {"Other note"})  # the target has a backlink now (widgets also shares the arch/ prefix)

    def test_topic_siblings_and_mentions_connect(self):
        self.save("Left", "x", topic_key="area/left")
        self.save("Right", "y", topic_key="area/right")
        self.save("The long distinctive title here", "z")
        self.save("Mentioner", "talks about The long distinctive title here today")
        titles = {i["title"] for i in self.cat("orphans")["items"]}
        self.assertFalse({"Left", "Right", "Mentioner", "The long distinctive title here"} & titles)

    def test_items_link_to_the_memory_page(self):
        item = self.cat("orphans")["items"][0]
        self.assertEqual(item["kind"], "memory")
        self.assertTrue(item["id"].isdigit())


class DuplicateTest(LintBase):
    def test_same_title_in_different_topic_keys_is_flagged_for_review(self):
        self.save("Use sqlite for storage", topic_key="db/choice")
        self.save("Use SQLite for storage!", topic_key="storage/choice")
        c = self.cat("duplicates")
        self.assertEqual(c["count"], 1)
        group = c["items"][0]
        self.assertIn("review", group["detail"].lower())
        self.assertNotIn("contradict", group["detail"].lower())
        self.assertEqual(len(group["members"]), 2)

    def test_same_topic_key_in_two_projects_is_not_a_duplicate(self):
        self.save("Shared topic title here", topic_key="same/topic", project="alpha")
        self.save("Shared topic title here", topic_key="same/topic", project="beta")
        self.assertEqual(self.cat("duplicates")["count"], 0)

    def test_distinct_titles_are_not_flagged(self):
        self.save("Use sqlite for storage", topic_key="db/choice")
        self.save("Pick a different ordering approach", topic_key="order/choice")
        self.assertEqual(self.cat("duplicates")["count"], 0)


class SupersededTest(LintBase):
    def test_older_note_with_a_newer_sibling_of_the_same_type_is_flagged_for_review(self):
        old = self.save("Auth token storage decision v1", type="decision", topic_key="decision/auth/v1")
        new = self.save("Auth token storage decision v2", type="decision", topic_key="decision/auth/v2")
        st = mstore.Store(self.f["state"] / "memory.db")
        st.conn.execute("UPDATE observations SET updated_at = '2026-01-01T00:00:00Z' WHERE topic_key = 'decision/auth/v1'")
        st.conn.execute("UPDATE observations SET updated_at = '2026-06-01T00:00:00Z' WHERE topic_key = 'decision/auth/v2'")
        st.conn.commit()
        st.close()
        c = self.cat("superseded")
        self.assertEqual(c["count"], 1)
        item = c["items"][0]
        self.assertEqual(item["title"], "Auth token storage decision v1")
        self.assertIn("v2", item["detail"])
        self.assertIn("review", item["detail"].lower())
        self.assertEqual(old is None or new is None, False)

    def test_unrelated_titles_or_other_types_are_not_flagged(self):
        self.save("Completely different thing", type="decision", topic_key="decision/auth/a")
        self.save("Another unrelated matter altogether", type="decision", topic_key="decision/auth/b")
        self.save("Auth token storage decision v1", type="note", topic_key="decision/auth/c")
        self.save("Auth token storage decision v2", type="decision", topic_key="decision/auth/d")
        self.assertEqual(self.cat("superseded")["count"], 0)


class UnusedSkillTest(LintBase):
    def test_installed_skills_without_a_load_in_the_window(self):
        self.install_skill("work-unit-commits")
        self.install_skill("never-used")
        wide = {i["id"] for i in self.cat("unused_skills", days=3650)["items"]}
        self.assertEqual(wide, {"never-used"})
        narrow = {i["id"] for i in self.cat("unused_skills", days=1)["items"]}  # the fixture's load is from 2026-10-01
        self.assertEqual(narrow, {"work-unit-commits", "never-used"})
        self.assertEqual(self.cat("unused_skills", days=3650)["items"][0]["kind"], "skill")

    def test_no_skills_directory_is_fine(self):
        self.assertEqual(self.cat("unused_skills")["count"], 0)

    def test_odd_directory_names_are_ignored(self):
        d = self.f["home"] / "skills" / "bad name!"
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text("x")
        self.assertEqual(self.cat("unused_skills", days=3650)["count"], 0)


class FeatureEvidenceTest(LintBase):
    def test_checked_tasks_without_any_commit_hash_are_listed(self):
        self.feature("proof", "# Proof\n\n- [x] W1 has hash (`abc1234`)\n- [x] W2 no evidence here\n- [ ] W3 open\n- [x] W4 evidence only in progress\n\n## Progress\n- W4 done in `deadbee`\n")
        c = self.cat("features_no_commits")
        item = next(i for i in c["items"] if i["id"] == "proof")
        self.assertEqual(item["kind"], "feature")
        self.assertIn("W2", item["detail"])
        self.assertNotIn("W1", item["detail"])
        self.assertNotIn("W4", item["detail"])
        self.assertNotIn("W3", item["detail"])

    def test_range_in_progress_covers_each_task(self):
        self.feature("ranged", "# R\n\n- [x] W5 a\n- [x] W6 b\n- [x] W7 c\n\nProgress: W5-W7 in `cafe123`.\n")
        self.assertNotIn("ranged", {i["id"] for i in self.cat("features_no_commits")["items"]})

    def test_feature_with_all_evidence_is_clean(self):
        self.feature("clean", "# C\n\n- [x] A1 done `abc1234`\n")
        self.assertNotIn("clean", {i["id"] for i in self.cat("features_no_commits")["items"]})

    def test_fixture_feature_without_hashes_is_flagged(self):
        self.assertIn("feat", {i["id"] for i in self.cat("features_no_commits")["items"]})


class MissingLinkTest(LintBase):
    def test_memory_and_feature_wikilinks_to_missing_pages(self):
        self.save("Linker", "see [[nope-page]] and [[skill:ghost|g]] and [[arch/widgets]]", topic_key="x/linker")
        self.feature("linkdoc", "# L\n\nSee [[also-missing]].\n- [x] A1 `abc1234`\n")
        c = self.cat("missing_links")
        details = [i["detail"] for i in c["items"]]
        self.assertTrue(any("nope-page" in d for d in details))
        self.assertTrue(any("skill:ghost" in d for d in details))
        self.assertTrue(any("also-missing" in d for d in details))
        self.assertFalse(any("arch/widgets" in d for d in details))
        self.assertEqual({i["kind"] for i in c["items"]}, {"memory", "feature"})

    def test_all_good_links_give_zero(self):
        self.save("Linker", "see [[arch/widgets]]", topic_key="x/linker")
        self.assertEqual(self.cat("missing_links")["count"], 0)


class CapTest(LintBase):
    def test_items_are_capped_but_count_is_the_total(self):
        st = mstore.Store(self.f["state"] / "memory.db")
        for n in range(wikilint.ITEM_CAP + 20):
            st.save(f"solo note {n:04d} unique words {n * 7919}", "x", type="note", project="alpha", topic_key=f"lonely{n}")
        st.close()
        c = self.cat("orphans")
        self.assertLessEqual(len(c["items"]), wikilint.ITEM_CAP)
        self.assertGreater(c["count"], wikilint.ITEM_CAP)
        self.assertTrue(c["truncated"])

    def test_scan_cap_is_reported(self):
        out = self.lint()
        self.assertEqual(set(out["scanned"]), {"memories", "capped"})
        self.assertFalse(out["scanned"]["capped"])

    def test_json_serializable(self):
        json.dumps(self.lint())


class ScanCapTest(LintBase):
    def test_link_to_a_memory_beyond_the_scan_cap_is_not_reported_missing(self):
        from unittest import mock
        for n in range(5):
            self.save(f"filler {n} words", "x", topic_key=f"fill{n}")
        self.save("Linker newest", "see [[arch/widgets]]", topic_key="x/linker")
        with mock.patch.object(wikilint, "SCAN_CAP", 3):
            out = self.lint()
        self.assertTrue(out["scanned"]["capped"])
        self.assertEqual({c["id"]: c["count"] for c in out["categories"]}["missing_links"], 0)
