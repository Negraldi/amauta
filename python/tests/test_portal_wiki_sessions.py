import json
from pathlib import Path

from python.amauta.portal import wikisess
from python.amauta.usage import ingest
from python.amauta.memory import store as mstore
from python.tests import portal_fixtures as fx
from python.tests.test_portal_wiki import WikiBase
from python.tests.test_usage import assistant, write_jsonl


class SessionLabelTest(WikiBase):
    def add_session(self, sid, cwd, prompts=(), n=1, model="claude-z", slug="-x-proj"):
        lines = [{"type": "user", "sessionId": sid, "timestamp": "2026-10-05T08:00:00.000Z", "cwd": cwd, "message": {"role": "user", "content": p}} for p in prompts]
        lines += [assistant(f"{sid}-m{i}", session=sid, ts="2026-10-05T09:00:00.000Z", cwd=cwd, model=model) for i in range(n)]
        write_jsonl(self.f["home"] / "projects" / slug / f"{sid}.jsonl", lines)
        c = mstore.connect(self.f["state"] / "memory.db")
        ingest.backfill(c, self.f["home"])
        c.close()

    def test_label_has_repo_prompt_snippet_and_date(self):
        pg = self.page("session", "s1")
        self.assertEqual(pg["title"], "alpha · Fix the portal wiki bug please · 2026-10-01")

    def test_without_a_prompt_the_label_uses_model_and_message_count(self):
        self.assertEqual(self.page("session", "s2")["title"], "beta · claude-x, 1 message · 2026-10-02")
        self.add_session("s5", "/work/gamma", n=3)
        self.assertEqual(self.page("session", "s5")["title"], "gamma · claude-z, 3 messages · 2026-10-05")

    def test_repo_name_is_the_git_root_of_the_cwd_not_the_last_directory(self):
        root = self.root / "myrepo"
        (root / ".git").mkdir(parents=True)
        (root / "static" / "deep").mkdir(parents=True)
        self.add_session("s6", str(root / "static" / "deep"), prompts=["hello there"])
        self.assertTrue(self.page("session", "s6")["title"].startswith("myrepo · hello there"), self.page("session", "s6")["title"])

    def test_system_looking_prompts_are_skipped_and_long_ones_cut(self):
        self.add_session("s7", "/work/delta", prompts=["<command-message>x</command-message>", "word " * 100])
        title = self.page("session", "s7")["title"]
        self.assertTrue(title.startswith("delta · word word"), title)
        self.assertLess(len(title), 120)
        self.assertNotIn("command-message", title)

    def test_recent_changes_and_skill_backlinks_use_the_same_label(self):
        items = {i["id"]: i for i in self.get("/api/wiki/recent", limit=100)["items"] if i["kind"] == "session"}
        self.assertEqual(items["s1"]["title"], "alpha · Fix the portal wiki bug please · 2026-10-01")
        self.assertNotIn("static", items["s2"]["title"])
        skill = self.page("skill", "work-unit-commits")
        self.assertEqual(skill["backlinks"][0]["title"], items["s1"]["title"])

    def test_hostile_ids_never_leave_the_projects_directory(self):
        outside = self.f["home"] / "secret.jsonl"
        outside.write_text(json.dumps({"cwd": "/etc", "type": "user", "message": {"content": "LEAK"}}) + "\n")
        for sid in ("../secret", "..", "a/b", "s1\x00", "x" * 300):
            self.assertEqual(wikisess.session_info(self.portal, sid), {}, repr(sid))

    def test_missing_transcript_falls_back_to_project_name(self):
        (self.f["home"] / "projects" / "-work-alpha" / "s1.jsonl").unlink()
        self.assertEqual(wikisess.session_info(self.portal, "s1"), {})
        self.assertEqual(self.page("session", "s1")["title"], "alpha · claude-y, 2 messages · 2026-10-01")
