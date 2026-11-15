"""T20c: the Codex tool names found in recorded use are catalog entries marked for Codex; Claude Code's tools no longer pass for
both runtimes' and the catalog says how many Codex tools it found."""
import json

from python.amauta.memory import store as mstore
from python.amauta.usage import codex, ingest
from python.tests.test_portal_wiki_codex import CodexBase
from python.tests.test_usage import assistant, tool_use, write_jsonl
from python.tests.test_usage_codex import SID, fcall, meta, record, turn, u


class CodexToolsBase(CodexBase):
    def seed(self, calls=True):
        write_jsonl(self.f["home"] / "projects" / "-work-delta" / "s7.jsonl", [assistant("d1", [
            tool_use("Bash", "m1"), tool_use("Mystery", "m2"), tool_use("mcp__projsrv__do_thing", "m3")],
            session="s7", ts="2026-10-04T10:00:00.000Z", cwd="/work/delta")])
        rollout = self.codex / "sessions" / "2026" / "10" / "20" / f"rollout-2026-10-20T09-00-00-{SID}.jsonl"
        extra = [fcall("exec", None, "c1"), fcall("send_message", "collaboration", "c2"), fcall("sleep", "clock", "c3"),
                 fcall("search", "mcp__docs__", "c4"), fcall("Bash", None, "c5")] if calls else []
        write_jsonl(rollout, [meta(), turn("t1", "gpt-x"), *extra, record("r1", "t1", u(10, 0, 0, 1, 0))])
        conn = mstore.connect(self.f["state"] / "memory.db")
        ingest.backfill(conn, self.f["home"])
        codex.backfill(conn, self.codex)
        conn.close()
        self.portal._harness_cache = None


class CodexToolEntriesTest(CodexToolsBase):
    def test_codex_tools_seen_in_use_are_tool_entries_marked_for_codex(self):
        self.seed()
        tools = self.items("tool")
        for name in ("exec", "collaboration.send_message", "clock.sleep"):
            self.assertEqual(tools[name]["runtimes"], ["codex"], name)
        self.assertNotIn("mcp__docs__search", tools, "MCP calls are MCP tools, not built-in tools")
        self.assertEqual(tools["Read"]["runtimes"], ["claude"], "a Claude Code tool never seen in use stays Claude Code's")
        self.assertEqual(tools["Mystery"]["runtimes"], ["claude"])

    def test_the_wording_says_these_are_recorded_tools_and_not_an_official_list(self):
        self.seed()
        item = self.items("tool")["exec"]
        self.assertIn("recorded Codex sessions", item["description"])
        self.assertIn("not an official", item["description"])
        self.assertTrue(item["i18n"]["es"]["description"])
        pg = self.page("tool", "exec")
        self.assertEqual(pg["summary"]["source"], "Seen in recorded Codex sessions")
        self.assertEqual(self.meta(pg)["Runtime"], "Codex")
        self.assertIn("usage", pg)

    def test_a_name_both_runtimes_used_belongs_to_both(self):
        self.seed()
        self.assertEqual(self.items("tool")["Bash"]["runtimes"], ["claude", "codex"])

    def test_the_catalog_counts_the_codex_tools_it_lists(self):
        self.seed()
        cat = self.catalog()
        listed = [i for g in cat["groups"] if g["kind"] == "tool" for i in g["items"] if "codex" in i["runtimes"]]
        self.assertEqual(cat["runtimes"]["codex"]["tools"], len(listed))
        self.assertEqual(cat["total"], sum(len(g["items"]) for g in cat["groups"]))

    def test_without_codex_use_there_are_no_codex_tools_and_the_count_says_zero(self):
        self.seed(calls=False)
        cat = self.catalog()
        self.assertEqual(cat["runtimes"]["codex"]["tools"], 0)
        self.assertFalse([i for i in self.items("tool").values() if i["runtimes"] == ["codex"]])

    def test_every_new_text_has_a_spanish_entry(self):
        from python.tests.test_portal_i18n import catalog, covered
        self.seed()
        pg = self.page("tool", "exec")
        self.assertTrue(covered(pg["summary"]["source"], catalog()))
        json.dumps(pg)
