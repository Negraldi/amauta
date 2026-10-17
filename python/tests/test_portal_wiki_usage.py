from pathlib import Path

from python.amauta.memory import store as mstore
from python.tests import portal_fixtures as fx
from python.tests.test_portal_wiki import WikiBase

SKILL = "---\nname: work-unit-commits\ndescription: >\n  Plan commits as reviewable\n  work units.\nversion: \"1.2\"\nbad: " + fx.XSS + "\n---\n# Work unit commits\n\nBody text with [[memory:1]].\n"


class SkillBase(WikiBase):
    def skill_file(self, name, text, sub=None):
        d = self.f["home"] / "skills" / name
        d.mkdir(parents=True, exist_ok=True)
        (d / "SKILL.md").write_text(text)
        return d / "SKILL.md"

    def labels(self, pg):
        return {m["label"]: m["value"] for m in pg["meta"]}


class SkillPageTest(SkillBase):
    def test_installed_skill_renders_body_and_shows_frontmatter_as_meta(self):
        self.skill_file("work-unit-commits", SKILL)
        pg = self.page("skill", "work-unit-commits")
        self.assertTrue(pg["body_md"].startswith("Body text"), pg["body_md"][:40])  # frontmatter and the repeated title heading are gone
        self.assertNotIn("description:", pg["body_md"])
        m = self.labels(pg)
        self.assertEqual(m["description"], "Plan commits as reviewable work units.")
        self.assertEqual(m["version"], "1.2")
        self.assertEqual(m["bad"], fx.XSS)  # raw data
        self.assertEqual((m["Installed"], m["Calls"]), ("yes", "1"))
        self.assertEqual([(x["kind"], x["id"]) for x in pg["missing"]], [])

    def test_installed_but_never_used_skill_still_has_a_page(self):
        self.skill_file("idle-skill", "---\nname: idle-skill\n---\nbody")
        pg = self.page("skill", "idle-skill")
        self.assertEqual(self.labels(pg)["Calls"], "0")
        self.assertEqual(pg["backlinks"], [])
        self.assertEqual(self.status("/api/wiki/page", kind="skill", id="never-heard"), 404)

    def test_used_but_not_installed_skill_says_so(self):
        pg = self.page("skill", "work-unit-commits")
        self.assertEqual(self.labels(pg)["Installed"], "no")
        self.assertIsNone(pg["body_md"])

    def test_hostile_names_never_read_outside_the_skills_directory(self):
        (self.f["home"] / "secret").mkdir()
        (self.f["home"] / "secret" / "SKILL.md").write_text("LEAK")
        for ident in ("../secret", "..", "a/b", "./x", "x\\y"):
            self.assertEqual(self.status("/api/wiki/page", kind="skill", id=ident), 404, ident)

    def test_a_huge_skill_is_cut_and_flagged(self):
        self.skill_file("big-skill", "---\nname: big-skill\n---\n" + "word " * 100000)
        pg = self.page("skill", "big-skill")
        self.assertLessEqual(len(pg["body_md"]), 100000)
        self.assertEqual(self.labels(pg)["Truncated"], "yes")

    def test_malformed_frontmatter_is_just_text(self):
        self.skill_file("odd-skill", "---\nno closing fence\nbody")
        pg = self.page("skill", "odd-skill")
        self.assertIn("no closing fence", pg["body_md"])

    def test_usage_over_time_sessions_and_attributed_tokens(self):
        pg = self.page("skill", "work-unit-commits")
        daily = pg["usage"]["daily"]
        self.assertEqual(len(daily), 30)
        self.assertEqual(daily[-1], {"day": "2026-10-01", "value": 1})
        self.assertEqual(sum(d["value"] for d in daily), 1)
        self.assertEqual([(b["kind"], b["id"]) for b in pg["backlinks"]], [("session", "s1")])
        m = self.labels(pg)
        self.assertEqual(m["Output tokens of the calling messages"], "50")
        sec = {s["heading"]: s for s in pg["sections"]}["Tokens in the sessions that used it"]
        items = {i["label"]: i["value"] for i in sec["items"]}
        self.assertEqual((items["Input"], items["Output"], items["Cache read"]), ("150", "75", "900"))
        self.assertIn("not caused", sec["items"][-1]["label"])

    def test_tool_and_mcp_pages_have_usage_and_the_server_tool_list(self):
        mcp = self.page("mcp", "engram")
        self.assertEqual(mcp["usage"]["daily"][-1], {"day": "2026-10-02", "value": 1})
        (tools,) = [s for s in mcp["sections"] if s["heading"] == "Tools of this server"]
        self.assertEqual([(i["label"], i["value"], i["id"]) for i in tools["items"]], [("mcp__engram__mem_save", "1 calls", "mcp__engram__mem_save")])
        tool = self.page("tool", "Bash")
        self.assertEqual(tool["usage"]["daily"][-1]["value"], 1)
        self.assertNotIn("Installed", self.labels(tool))


class SessionPageTest(SkillBase):
    def test_session_page_shows_period_models_token_split_and_memories_saved(self):
        st = mstore.Store(self.f["state"] / "memory.db")
        st.save("Saved in s1", "text", type="note", project="alpha", session_id="s1")
        st.close()
        pg = self.page("session", "s1")
        m = self.labels(pg)
        self.assertEqual((m["Started"], m["Ended"]), ("2026-10-01T10:00:00.000Z", "2026-10-02T10:00:00.000Z"))
        self.assertEqual(m["Models"], "claude-x (1), claude-y (1)")
        self.assertEqual((m["Input tokens"], m["Output tokens"], m["Cache read tokens"], m["Cache write tokens"]), ("150", "75", "900", "150"))
        self.assertEqual(m["Working directory"], "/work/alpha")
        sec = {s["heading"]: s for s in pg["sections"]}
        self.assertEqual([(i["kind"], i["label"]) for i in sec["Memories saved in this session"]["items"]], [("memory", "Saved in s1")])
        self.assertIn(("memory", "Saved in s1"), [(x["kind"], x["title"]) for x in pg["links"]])
        self.assertIn(("skill", "work-unit-commits"), [(i["kind"], i["id"]) for i in sec["Skills"]["items"]])
        self.assertIn(("mcp", "engram"), [(i["kind"], i["id"]) for i in sec["MCP servers"]["items"]])
        self.assertIn("sdd-apply", [i["label"] for i in sec["Subagent types"]["items"]])

    def test_a_memory_links_to_the_session_it_was_saved_in(self):
        st = mstore.Store(self.f["state"] / "memory.db")
        st.save("Saved in s1", "text", type="note", project="alpha", session_id="s1")
        st.close()
        pg = self.page("memory", "Saved in s1")
        self.assertIn(("session", "s1"), [(x["kind"], x["id"]) for x in pg["links"]])

    def test_sessions_without_saved_memories_have_no_empty_section(self):
        self.assertNotIn("Memories saved in this session", [s["heading"] for s in self.page("session", "s2")["sections"]])


class NumberHintTest(SkillBase):
    def test_meta_and_items_mark_real_numbers_so_the_ui_can_group_digits(self):
        pg = self.page("skill", "work-unit-commits")
        by = {m["label"]: m for m in pg["meta"]}
        self.assertEqual(by["Calls"].get("fmt"), "number")
        self.assertEqual(by["Sessions"].get("fmt"), "number")
        self.assertNotIn("fmt", by["Installed"])
        self.assertNotIn("fmt", by["Last used"])  # dates are recognised by shape, never hinted
        tokens = next(s for s in pg["sections"] if s["heading"].startswith("Tokens"))
        self.assertEqual(tokens["items"][0].get("fmt"), "number")
        self.assertNotIn("fmt", tokens["items"][-1])
