"""T14 cross-page agreement: one fact per session (its main model, its project) reads the same on every page."""
from python.amauta.memory import store as mstore
from python.amauta.usage import ingest
from python.tests.test_portal_wiki_sessions import SessionBase
from python.tests.test_usage import assistant, write_jsonl


class MixedModelBase(SessionBase):
    def mixed_session(self, sid="s20", cwd="/work/alpha", counts=(("claude-opus-5-5", 3), ("claude-sonnet-5-5", 1))):
        lines, i = [], 0
        for model, n in counts:
            for _ in range(n):
                lines.append(assistant(f"{sid}-m{i}", session=sid, ts=f"2026-10-05T09:{i:02d}:00.000Z", cwd=cwd, model=model))
                i += 1
        write_jsonl(self.f["home"] / "projects" / "-mixed" / f"{sid}.jsonl", lines)
        c = mstore.connect(self.f["state"] / "memory.db")
        ingest.backfill(c, self.f["home"])
        c.close()


class MainModelTest(MixedModelBase):
    """A session's model is the one with the most messages (the session page lists them by count), with how many models it used."""

    def test_usage_sessions_name_the_model_with_most_messages_and_count_the_others(self):
        self.mixed_session()
        row = next(r for r in self.get("/api/sessions", days=3650)["sessions"] if r["session_id"] == "s20")
        self.assertEqual((row["model"], row["models"]), ("claude-opus-5-5", 2))
        models = self.meta(self.page("session", "s20"))["Models"]
        self.assertTrue(models.startswith("claude-opus-5-5 (3)"), models)

    def test_a_label_without_a_prompt_names_the_main_model(self):
        self.mixed_session()
        self.assertIn("claude-opus-5-5, 4 messages", self.page("session", "s20")["title"])
        item = next(i for i in self.get("/api/wiki/recent", limit=100)["items"] if i["id"] == "s20")
        self.assertIn("claude-opus-5-5", item["title"])


class OneProjectRuleTest(SessionBase):
    """Membership, the displayed name, last activity and the Usage grouping and filter all follow sessname's rule, never the
    folder basename the usage import stored. s30 runs in a folder named "amauta" inside the ortho-conv repository; s31 runs
    inside the configured amauta project."""

    def setUp(self):
        super().setUp()
        home = self.root / "home"
        self.amauta, self.ortho = home / "amauta", home / "ortho-conv"
        for repo in (self.amauta, self.ortho):
            (repo / ".git").mkdir(parents=True)
        (self.amauta / "src").mkdir()
        (self.ortho / "amauta").mkdir()
        self.cfg.home = home
        self.cfg.repos.append(self.amauta)
        self.add_session("s30", str(self.ortho / "amauta"), prompts=["ortho work"], slug="-ortho")
        self.add_session("s31", str(self.amauta / "src"), prompts=["amauta work"], slug="-amauta")

    def ids(self, **q):
        return {r["session_id"] for r in self.get("/api/sessions", days=3650, **q)["sessions"]}

    def test_the_usage_project_filter_follows_the_rule(self):
        self.assertEqual(self.ids(project="amauta"), {"s31"})
        self.assertEqual(self.ids(project="ortho-conv"), {"s30"})
        self.assertEqual(self.get("/api/overview", days=3650, project="ortho-conv")["totals"]["sessions"], 1)

    def test_usage_projects_group_by_the_rule(self):
        by = {p["project"]: p["sessions"] for p in self.get("/api/sessions", days=3650)["projects"]}
        self.assertEqual((by.get("amauta"), by.get("ortho-conv")), (1, 1))
        self.assertNotIn("src", by)

    def test_the_project_page_and_the_projects_list_count_the_same_members(self):
        pg = self.page("project", "amauta")
        self.assertEqual(self.meta(pg)["Sessions"], "1")
        listed = [i for s in pg["sections"] if s["heading"] == "Recent sessions" for i in s["items"]]
        self.assertEqual([i["id"] for i in listed], ["s31"])
        row = next(p for p in self.get("/api/projects")["projects"] if p["name"] == "amauta")
        self.assertEqual(row["sessions"], 1)
        last = next(r["last_ts"] for r in self.get("/api/sessions", days=3650)["sessions"] if r["session_id"] == "s31")
        self.assertEqual(row["last"], last)

    def test_search_finds_a_session_by_its_project_name(self):
        hits = self.get("/api/wiki/search", q="ortho-conv")
        ids = [i["id"] for g in hits["groups"] if g["kind"] == "session" for i in g["items"]]
        self.assertIn("s30", ids)
