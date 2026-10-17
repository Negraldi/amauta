import json
import re

from python.amauta.memory import store as mstore
from python.amauta.portal import wikitools
from python.amauta.usage import ingest
from python.tests.test_portal_wiki_harness import HarnessBase, write
from python.tests.test_usage import assistant, tool_use, write_jsonl

CACHE = {"projsrv": {"fetched_at": "2026-10-10T10:00:00Z", "tools": [
    {"name": "do_thing", "description": "Does a thing", "params": ["a", "b"]}, {"name": "other", "description": "Other thing", "params": []}]}}
VOSEO = re.compile(r"\b(vos|tenés|podés|querés|sabés|hacé|elegí|mirá|andá|fijate|acordate|dale|che)\b", re.I)


class ToolsBase(HarnessBase):
    def setUp(self):
        super().setUp()
        home = self.f["home"]
        write_jsonl(home / "projects" / "-work-delta" / "s7.jsonl", [assistant("d1", [
            tool_use("mcp__projsrv__do_thing", "m1"), tool_use("mcp__claude_ai_Gmail__search_threads", "m2"), tool_use("mcp__6f616b42-0ed8-571e-823f-ee4aca6b7ce9__show_widget", "m3"),
            tool_use("mcp__plugin_plug_plugsrv__act", "m4"), tool_use("Mystery", "m5"), tool_use("Bash", "m6")], session="s7", ts="2026-10-04T10:00:00.000Z", cwd="/work/delta")])
        conn = mstore.connect(self.f["state"] / "memory.db")
        ingest.backfill(conn, home)
        conn.close()
        write(self.f["state"] / "wiki" / "mcp-tools.json", json.dumps(CACHE))
        self.portal._harness_cache = None


class BuiltinToolTest(ToolsBase):
    def test_catalog_has_used_and_unused_builtins_with_the_used_first(self):
        tools = self.items("tool")
        for name in ("Bash", "Read", "Agent", "Skill", "Glob", "Grep", "WebFetch", "WebSearch", "TodoWrite", "NotebookEdit", "ToolSearch", "AskUserQuestion", "SendMessage", "ScheduleWakeup", "Edit", "Write"):
            self.assertIn(name, tools, name)
        order = [i["id"] for g in self.catalog()["groups"] if g["kind"] == "tool" for i in g["items"]]
        self.assertLess(order.index("Bash"), order.index("Glob"))
        self.assertFalse(any(i.startswith("mcp__") for i in tools))

    def test_every_catalog_entry_has_english_and_neutral_spanish_text(self):
        self.assertGreater(len(wikitools.BUILTIN), 25)
        for name, e in wikitools.BUILTIN.items():
            for lang in ("en", "es"):
                self.assertTrue(e[lang]["what"] and e[lang]["when"], (name, lang))
            self.assertNotEqual(e["es"]["what"], e["en"]["what"], name)
            self.assertIsNone(VOSEO.search(e["es"]["what"] + e["es"]["when"]), name)

    def test_used_builtin_page_keeps_usage_and_gains_the_summary_in_both_languages(self):
        pg = self.page("tool", "Bash")
        self.assertIn("usage", pg)
        self.assertEqual(self.meta(pg)["Calls"], "2")
        sm = pg["summary"]
        self.assertIn("shell command", sm["description"])
        self.assertTrue(sm["when"])
        self.assertEqual(sm["source"], "Built into Claude Code")
        self.assertTrue(sm["i18n"]["es"]["description"] and sm["i18n"]["es"]["when"])

    def test_unused_catalog_tool_has_a_page_without_usage(self):
        pg = self.page("tool", "Glob")
        self.assertEqual(pg["summary"]["source"], "Built into Claude Code")
        self.assertIn("Finds files", pg["summary"]["description"])

    def test_tool_seen_only_in_usage_says_so(self):
        pg = self.page("tool", "Mystery")
        self.assertEqual(pg["summary"]["source"], "Usage only")
        self.assertIsNone(pg["summary"]["description"])
        self.assertTrue(pg["summary"]["note"])

    def test_agent_tool_lists_link_to_tool_pages_and_back(self):
        agent = self.page("agent", "my-agent")
        links = {(r["kind"], r["id"]) for r in agent["links"]}
        self.assertIn(("tool", "Read"), links)
        self.assertIn(("mcptool", "engram/mem_save"), links)
        self.assertIn(("agent", "my-agent"), {(r["kind"], r["id"]) for r in self.page("tool", "Read")["backlinks"]})


class McpToolTest(ToolsBase):
    def test_tools_come_from_the_cache_and_from_usage(self):
        tools = self.items("mcptool")
        for ident in ("projsrv/do_thing", "projsrv/other", "engram/mem_save", "plugsrv/act"):
            self.assertIn(ident, tools, ident)
        self.assertEqual(tools["projsrv/do_thing"]["description"], "Does a thing")

    def test_page_shows_description_parameters_usage_and_source(self):
        pg = self.page("mcptool", "projsrv/do_thing")
        self.assertEqual(pg["summary"]["description"], "Does a thing")
        m = self.meta(pg)
        self.assertEqual((m["Parameters"], m["Calls"]), ("a, b", "1"))
        self.assertEqual(pg["summary"]["source"], "Reported by the server")
        self.assertIn(("mcp", "projsrv"), {(r["kind"], r["id"]) for r in pg["links"]})
        self.assertIn("usage", pg)

    def test_tool_known_only_from_usage_or_only_from_the_cache(self):
        used = self.page("mcptool", "engram/mem_save")
        self.assertEqual(used["summary"]["source"], "Usage only")
        self.assertIsNone(used["summary"]["description"])
        cached = self.page("mcptool", "projsrv/other")
        self.assertEqual(self.meta(cached).get("Calls"), None)

    def test_server_page_links_to_its_tools(self):
        links = {(r["kind"], r["id"]) for r in self.page("mcp", "projsrv")["links"]}
        self.assertTrue({("mcptool", "projsrv/do_thing"), ("mcptool", "projsrv/other")} <= links)
        self.assertIn("Tools refreshed", self.meta(self.page("mcp", "projsrv")))

    def test_full_tool_names_in_usage_point_to_the_mcp_tool_page(self):
        pg = self.page("tool", "mcp__engram__mem_save")
        self.assertIn(("mcptool", "engram/mem_save"), {(r["kind"], r["id"]) for r in pg["links"]})

    def test_a_broken_cache_is_ignored(self):
        write(self.f["state"] / "wiki" / "mcp-tools.json", "{nope")
        self.portal._harness_cache = None
        self.assertNotIn("projsrv/other", self.items("mcptool"))
        write(self.f["state"] / "wiki" / "mcp-tools.json", json.dumps({"projsrv": {"tools": [{"name": "x" * 500, "description": "d" * 5000, "params": ["p"] * 500}, "junk", {"name": 3}]}, "bad": 1}))
        self.portal._harness_cache = None
        pg = self.page("mcptool", "projsrv/" + "x" * 100)
        self.assertLessEqual(len(pg["summary"]["description"]), wikitools.MAX_DESCRIPTION)


class ConnectorTest(ToolsBase):
    def test_servers_with_no_local_config_are_connectors(self):
        conns = self.items("connector")
        self.assertTrue({"claude_ai_Gmail", "6f616b42-0ed8-571e-823f-ee4aca6b7ce9"} <= set(conns))
        for configured in ("engram", "projsrv", "plugin_plug_plugsrv"):
            self.assertNotIn(configured, conns)

    def test_connector_page_explains_what_it_is_and_lists_tools_and_usage(self):
        pg = self.page("connector", "claude_ai_Gmail")
        self.assertIn("claude.ai connector", pg["summary"]["description"])
        self.assertEqual(pg["summary"]["source"], "Usage only")
        self.assertEqual(self.meta(pg)["Calls"], "1")
        self.assertIn(("mcptool", "claude_ai_Gmail/search_threads"), {(r["kind"], r["id"]) for r in pg["links"]})
        self.assertIn("usage", pg)

    def test_connector_tools_link_back_to_the_connector(self):
        pg = self.page("mcptool", "claude_ai_Gmail/search_threads")
        self.assertIn(("connector", "claude_ai_Gmail"), {(r["kind"], r["id"]) for r in pg["links"]})
        self.assertEqual(pg["summary"]["source"], "Usage only")

    def test_the_connector_is_never_contacted_or_configured(self):
        pg = self.page("connector", "6f616b42-0ed8-571e-823f-ee4aca6b7ce9")
        self.assertNotIn("Command", self.meta(pg))
        self.assertEqual(self.status("/api/wiki/page", kind="connector", id="engram"), 404)
