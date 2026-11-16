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


class ActiveFoldersTest(SessionBase):
    """A Codex session's cwd is read from its rollout. One inside a git repository makes it a discovered project; one in a
    plain folder is listed apart on Projects ("active folders that are not projects"), never silently dropped."""

    def setUp(self):
        super().setUp()
        from python.amauta.usage import codex
        from python.tests.test_usage_codex import meta, record, turn, u
        home = self.root / "home"
        self.plain, self.gitrepo = home / "scratch" / "data", home / "tool"
        self.plain.mkdir(parents=True)
        (self.gitrepo / ".git").mkdir(parents=True)
        self.cfg.home = home
        self.cfg.codex_home = self.root / "codex"
        for sid, cwd in (("cx-plain", self.plain), ("cx-git", self.gitrepo)):
            write_jsonl(self.cfg.codex_home / "sessions" / "2026" / "10" / "05" / f"rollout-{sid}.jsonl", [
                meta(cwd=str(cwd), sid=sid), turn("t1", "gpt-x", cwd=str(cwd)),
                record(f"resp-{sid}", "t1", u(10, 6, 4, 1, 0), ts="2026-10-05T12:00:00.000Z", sid=sid)])
        c = mstore.connect(self.f["state"] / "memory.db")
        codex.backfill(c, self.cfg.codex_home)
        c.close()

    def test_a_codex_session_in_a_repository_is_a_discovered_project(self):
        row = next(p for p in self.get("/api/projects")["projects"] if p["name"] == "tool")
        self.assertEqual((row["origin"], row["sessions"]), (["discovered"], 1))
        self.assertEqual(self.meta(self.page("session", "cx-git"))["Working directory"], str(self.gitrepo))

    def test_a_plain_folder_with_sessions_is_listed_apart(self):
        projects = self.get("/api/projects")
        self.assertNotIn("data", [p["name"] for p in projects["projects"]])
        folder = next(f for f in projects["folders"] if f["name"] == "data")
        self.assertEqual((folder["path"], folder["sessions"]), (str(self.plain.resolve()), 1))  # resolved: macOS temp dirs are symlinks
        self.assertTrue(folder["last"].startswith("2026-10-05"))
        self.assertIn("data", {p["project"] for p in self.get("/api/sessions", days=3650)["projects"]})


class MemoryPagingTest(SessionBase):
    """The memory list and memory search say how many match and page through them; a capped search group says so."""

    def setUp(self):
        super().setUp()
        st = mstore.Store(self.f["state"] / "memory.db")
        for i in range(60):
            st.save(f"Paged note {i}", f"pager body number {i}", type="note", topic_key=f"paged/{i}", project="alpha")
        st.close()

    def test_the_list_reports_the_total_and_pages_with_an_offset(self):
        first = self.get("/api/memories", source="own")
        self.assertEqual((len(first["items"]), first["total"], first["offset"]), (50, 62, 0))
        rest = self.get("/api/memories", source="own", offset=50)
        self.assertEqual(len(rest["items"]), 12)
        self.assertFalse({i["id"] for i in first["items"]} & {i["id"] for i in rest["items"]})

    def test_a_search_reports_its_total_too(self):
        hit = self.get("/api/memories", source="own", q="pager", limit=10)
        self.assertEqual((len(hit["items"]), hit["total"]), (10, 60))
        self.assertEqual(len(self.get("/api/memories", source="own", q="pager", limit=10, offset=55)["items"]), 5)

    def test_a_capped_search_group_says_so(self):
        group = next(g for g in self.get("/api/wiki/search", q="pager")["groups"] if g["kind"] == "memory")
        self.assertTrue(group["capped"])
        self.assertEqual(group["total"], 60)


class SessionPageTest(MixedModelBase):
    def test_a_unique_short_id_opens_the_session(self):
        self.mixed_session(sid="b9600f26-aaaa-bbbb-cccc-000000000001")
        pg = self.page("session", "b9600f26")
        self.assertEqual(pg["id"], "b9600f26-aaaa-bbbb-cccc-000000000001")
        self.assertEqual(self.status("/api/wiki/page", kind="session", id="b960"), 404)  # too short to be an id prefix

    def test_an_ambiguous_short_id_is_not_found(self):
        self.mixed_session(sid="cafe0001-x")
        self.mixed_session(sid="cafe0001-y")
        self.assertEqual(self.status("/api/wiki/page", kind="session", id="cafe0001"), 404)

    def test_the_end_of_a_session_is_called_its_last_activity_like_every_table(self):
        m = self.meta(self.page("session", "s1"))
        self.assertIn("Last activity", m)
        self.assertNotIn("Ended", m)


class OrphanNoteTest(SessionBase):
    def test_orphans_say_why_once_in_the_category_note_not_per_row(self):
        orphans = next(c for c in self.get("/api/wiki/lint")["categories"] if c["id"] == "orphans")
        self.assertTrue(orphans["items"])
        self.assertTrue(all(not i.get("detail") for i in orphans["items"]), orphans["items"][0])
        self.assertIn("No wikilinks", orphans["note"])


class GraphCountTest(SessionBase):
    """The node list says how many nodes match and how many vendored ones the default view hides."""

    def test_the_node_list_counts_matches_and_hidden_vendored_nodes(self):
        import sqlite3
        key = str(self.f["repo"].resolve())
        c = sqlite3.connect(self.f["state"] / "memory.db")
        c.execute("INSERT INTO graph_nodes (repo, id, label, kind, file) VALUES (?, 'v1', 'vendored thing', 'code', 'web/lib.min.js')", (key,))
        c.commit()
        c.close()
        default = self.get("/api/graph/nodes", repo=key)
        self.assertEqual((len(default["items"]), default["matched"], default["hidden"]), (6, 7, 1))
        shown = self.get("/api/graph/nodes", repo=key, vendored="1")
        self.assertEqual((len(shown["items"]), shown["matched"], shown["hidden"]), (7, 7, 0))
