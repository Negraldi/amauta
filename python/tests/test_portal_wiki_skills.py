import json
import os

from python.amauta.memory import store as mstore
from python.amauta.portal import wikiskills
from python.amauta.usage import ingest
from python.tests import portal_fixtures as fx
from python.tests.test_portal_wiki import WikiBase
from python.tests.test_usage import assistant, tool_use, write_jsonl


def skill(path, name, description, body="Body.\n", extra=""):
    path.mkdir(parents=True, exist_ok=True)
    (path / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {description}\n{extra}---\n# {name}\n\n{body}")


class SkillsBase(WikiBase):
    def setUp(self):
        super().setUp()
        home, repo = self.f["home"], self.f["repo"]
        skill(home / "skills" / "amauta-made", "amauta-made", "Trigger: when committing. Plan commits as work units.")
        skill(home / "skills" / "my-own", "my-own", "Does my own thing. Trigger: on request")
        skill(home / "skills" / "_shared", "_shared", "internal")
        skill(home / "plugins" / "cache" / "mk" / "plug" / "1.2.3" / "skills" / "pskill", "pskill", "A plugin skill. Trigger: plugin time")
        skill(repo / ".claude" / "skills" / "rskill", "rskill", "A project skill")
        state = json.loads((self.f["state"] / "state.json").read_text())
        state["managed_files"]["skills/amauta-made/SKILL.md"] = "h"
        (self.f["state"] / "state.json").write_text(json.dumps(state))
        write_jsonl(home / "projects" / "-work-gamma" / "s9.jsonl", [
            assistant("c1", [tool_use("Skill", "k1", skill="artifact-capabilities"), tool_use("Skill", "k2", skill="anthropic-skills:docs"),
                             tool_use("Skill", "k3", skill="plug:pskill"), tool_use("Skill", "k4", skill="amauta-made")], session="s9", ts="2026-10-03T10:00:00.000Z", cwd="/work/gamma")])
        conn = mstore.connect(self.f["state"] / "memory.db")
        ingest.backfill(conn, home)
        conn.close()

    def catalog(self):
        return self.get("/api/skills")

    def entries(self):
        return {i["id"]: (g["source"], i) for g in self.catalog()["groups"] for i in g["items"]}


class TriggerSplitTest(SkillsBase):
    def test_trigger_is_split_from_the_description_in_both_layouts(self):
        self.assertEqual(wikiskills.split_trigger("Trigger: PRs over 400 lines. Split big changes."), ("Split big changes.", "PRs over 400 lines"))
        self.assertEqual(wikiskills.split_trigger("Does a thing. Trigger: on request"), ("Does a thing.", "on request"))
        self.assertEqual(wikiskills.split_trigger("No trigger here"), ("No trigger here", None))
        self.assertEqual(wikiskills.split_trigger("Trigger: only this"), ("", "only this"))
        self.assertEqual(wikiskills.split_trigger(None), ("", None))


class CatalogTest(SkillsBase):
    def test_groups_every_source_in_a_stable_order(self):
        groups = self.catalog()["groups"]
        self.assertEqual([g["source"] for g in groups], ["installed", "user", "plugin", "project", "builtin"])
        self.assertTrue(all(g["label"] and g["items"] for g in groups))

    def test_each_source_lands_in_its_group_with_description_trigger_and_usage(self):
        e = self.entries()
        self.assertEqual(e["amauta-made"][0], "installed")
        self.assertEqual(e["my-own"][0], "user")
        self.assertEqual(e["plug:pskill"][0], "plugin")
        self.assertEqual(e["alpha-repo/rskill" if "alpha-repo/rskill" in e else f"{self.f['repo'].name}/rskill"][0], "project")
        self.assertNotIn("_shared", e)
        made = e["amauta-made"][1]
        self.assertEqual((made["description"], made["trigger"]), ("Plan commits as work units.", "when committing"))
        self.assertEqual(made["uses"], 1)
        self.assertEqual(e["my-own"][1]["trigger"], "on request")
        self.assertEqual(e["plug:pskill"][1]["uses"], 1)
        self.assertEqual(e["work-unit-commits"][0], "builtin")  # used, no local file in this fixture
        self.assertEqual(e["work-unit-commits"][1]["uses"], 1)

    def test_used_skills_without_a_local_file_are_built_in(self):
        e = self.entries()
        for name in ("artifact-capabilities", "anthropic-skills:docs"):
            self.assertEqual(e[name][0], "builtin", name)
            self.assertIsNone(e[name][1]["description"])
        self.assertNotIn("plug:pskill", [i["id"] for g in self.catalog()["groups"] if g["source"] == "builtin" for i in g["items"]])

    def test_discovery_is_bounded_and_ignores_symlinks(self):
        home = self.f["home"]
        outside = self.root / "outside"
        skill(outside, "leak", "LEAK")
        (home / "skills" / "linked").symlink_to(outside, target_is_directory=True)
        (home / "plugins" / "cache" / "mk" / "plug" / "1.2.3" / "skills" / "linkedp").symlink_to(outside, target_is_directory=True)
        self.assertNotIn("linked", self.entries())
        self.assertNotIn("plug:linkedp", self.entries())
        for i in range(wikiskills.MAX_PER_ROOT + 20):
            skill(home / "skills" / f"bulk-{i:04d}", f"bulk-{i}", "x")
        self.assertLessEqual(sum(1 for k in self.entries() if k.startswith("bulk-")), wikiskills.MAX_PER_ROOT)

    def test_empty_state_has_no_groups_but_still_answers(self):
        from python.amauta.portal import api
        from python.amauta.portal.config import Config
        p = api.Portal(Config(state_dir=self.root / "none", claude_home=self.root / "none"))
        status, body = p.get("/api/skills", {})
        self.assertEqual((status, body["groups"]), (200, []))


class SkillPageSummaryTest(SkillsBase):
    def test_installed_skill_opens_with_a_summary_before_the_body(self):
        pg = self.page("skill", "amauta-made")
        s = pg["summary"]
        self.assertEqual((s["description"], s["trigger"], s["source"], s["builtin"]), ("Plan commits as work units.", "when committing", "Installed by amauta", False))
        self.assertTrue(s["path"].endswith("skills/amauta-made/SKILL.md"))
        self.assertTrue(pg["body_md"].startswith("Body."))
        labels = {m["label"]: m["value"] for m in pg["meta"]}
        self.assertNotIn("Installed", labels)
        self.assertEqual(labels["Source"], "Installed by amauta")

    def test_built_in_skill_says_so_plainly_with_its_usage(self):
        pg = self.page("skill", "artifact-capabilities")
        s = pg["summary"]
        self.assertTrue(s["builtin"])
        self.assertIsNone(s["description"])
        self.assertIn("Built into Claude Code (no local file)", s["note"])
        self.assertIn("description unavailable locally", s["note"])
        labels = {m["label"]: m["value"] for m in pg["meta"]}
        self.assertEqual(labels["Calls"], "1")
        self.assertNotIn("Installed", labels)
        self.assertIsNone(pg["body_md"])

    def test_plugin_namespaced_name_resolves_to_the_plugin_skill_file(self):
        pg = self.page("skill", "plug:pskill")
        self.assertEqual(pg["summary"]["description"], "A plugin skill.")
        self.assertEqual(pg["summary"]["source"], "Plugin plug")
        self.assertFalse(pg["summary"]["builtin"])
        self.assertTrue(pg["body_md"].startswith("Body."))

    def test_unused_plugin_and_project_skills_have_pages_and_hostile_ids_do_not_escape(self):
        self.assertEqual(self.page("skill", f"{self.f['repo'].name}/rskill")["summary"]["source"], f"Project {self.f['repo'].name}")
        (self.f["home"] / "secret").mkdir()
        (self.f["home"] / "secret" / "SKILL.md").write_text("LEAK")
        for ident in ("../secret", "plug:../../secret", "x/../../secret", "a/b/c", "nope:nope", "ghost"):
            self.assertEqual(self.status("/api/wiki/page", kind="skill", id=ident), 404, ident)

    def test_search_and_wikilink_titles_know_catalog_skills(self):
        st = mstore.Store(self.f["state"] / "memory.db")
        st.save("Links", "see [[skill:plug:pskill]]", type="note", project="alpha")
        st.close()
        pg = self.page("memory", "Links")
        self.assertIn(("skill", "plug:pskill"), [(r["kind"], r["id"]) for r in pg["links"]])
