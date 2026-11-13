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
