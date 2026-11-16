"""The harness wiki inventories the Codex target too: MCP servers from config.toml, hooks from hooks.json, AGENTS.md
blocks and skill links, one entry per component with the runtimes that have it, and nothing secret."""
import json

from python.tests.test_portal_wiki_harness import SECRETS, HarnessBase, write
from python.tests.test_portal_wiki_skills import skill

CONFIG_TOML = '''model = "o3"

[mcp_servers.engram]
command = "python3"
args = ["-P", "-m", "amauta.memory", "serve"]
env = { AMAUTA_RUNTIME = "codex", X_TOKEN = "SECRET-ENV" }

[mcp_servers.codexonly]
command = "cx"
args = ["--api-key", "{key}"]

[mcp_servers.codexonly.env]
API_TOKEN = "hunter2-secret"
'''.replace("{key}", SECRETS[2])


class CodexBase(HarnessBase):
    def setUp(self):
        super().setUp()
        codex = self.root / "codex"
        write(codex / "config.toml", CONFIG_TOML)
        write(codex / "hooks.json", json.dumps({"hooks": {
            "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "env PYTHONPATH=/r python3 -P -m amauta.usage hook --runtime codex", "timeout": 10}]}],
            "SessionStart": [{"matcher": "", "hooks": [{"type": "command", "command": "node /x/codex-only.js"}]}]}}))
        write(codex / "AGENTS.md", "# Mine\n\n<!-- amauta:core -->\nbody\n<!-- /amauta:core -->\n<!-- amauta:odd -->\nx\n<!-- /amauta:odd -->\n")
        write(self.f["home"] / "CLAUDE.md", "<!-- amauta:core -->\nbody\n<!-- /amauta:core -->\n<!-- amauta:half -->\nno close\n")
        skill(self.f["home"] / "skills" / "shared-skill", "shared-skill", "A shared skill")
        skill(codex / ".agents" / "skills" / "shared-skill", "shared-skill", "A shared skill")
        skill(codex / ".agents" / "skills" / "codex-skill", "codex-skill", "A Codex skill")
        self.cfg.codex_home = codex
        self.codex = codex

    def skills(self):
        return {i["id"]: i for g in self.get("/api/skills")["groups"] for i in g["items"]}


class CodexCatalogTest(CodexBase):
    def test_mcp_servers_carry_their_runtimes_and_no_secret(self):
        mcp = self.items("mcp")
        self.assertEqual(mcp["engram"]["runtimes"], ["claude", "codex"])
        self.assertEqual(mcp["codexonly"]["runtimes"], ["codex"])
        self.assertEqual(mcp["remote"]["runtimes"], ["claude"])
        page = self.page("mcp", "codexonly")
        self.assertEqual(self.meta(page)["Runtime"], "Codex")
        self.assertIn(str(self.codex / "config.toml"), json.dumps(page["sections"]))
        self.assertEqual(self.meta(self.page("mcp", "engram"))["Runtime"], "Claude Code, Codex")
        self.assertNotIn("refresh", page, "the refresh probe only runs servers configured for Claude Code")
        dump = json.dumps([self.catalog(), page, self.page("mcp", "engram")])
        for s in SECRETS:
            self.assertNotIn(s, dump)
        self.assertIn("API_TOKEN", json.dumps(page))

    def test_a_hook_in_both_runtimes_is_one_entry_and_a_codex_only_hook_is_listed(self):
        hooks = self.items("hook")
        stops = [i for i in hooks.values() if i["id"].startswith("Stop:")]
        self.assertEqual(len(stops), 2, "the Codex copy of the usage hook joins the Claude entry")
        usage = next(i for i in stops if "usage" in i["title"].lower() or "amauta" in i["title"].lower())
        self.assertEqual(usage["runtimes"], ["claude", "codex"])
        only = [i for i in hooks.values() if i["id"].startswith("SessionStart:") and "codex-only.js" in i["title"]]
        self.assertEqual([i["runtimes"] for i in only], [["codex"]])
        page = self.page("hook", usage["id"])
        self.assertIn(str(self.codex / "hooks.json"), json.dumps(page["sections"]))

    def test_claude_only_kinds_say_so(self):
        for kind, ident in (("agent", "my-agent"), ("command", "do-it"), ("plugin", "plug"), ("outputstyle", "terse")):
            self.assertEqual(self.items(kind)[ident]["runtimes"], ["claude"], kind)
            self.assertEqual(self.meta(self.page(kind, ident))["Runtime"], "Claude Code (Codex has no equivalent)", kind)

    def test_skills_carry_their_runtimes(self):
        sk = self.skills()
        self.assertEqual(sk["shared-skill"]["runtimes"], ["claude", "codex"])
        self.assertEqual(sk["codex-skill"]["runtimes"], ["codex"])
        self.assertEqual(sk["codex-skill"]["label"], "Your Codex skills")

    def test_the_overview_reports_both_runtimes(self):
        rt = self.catalog()["runtimes"]
        self.assertEqual(rt["codex"]["found"], True)
        self.assertEqual(rt["codex"]["home"], str(self.codex))
        self.assertEqual(rt["codex"]["blocks"], ["core", "odd"])
        self.assertEqual((rt["codex"]["hooks"], rt["codex"]["mcp_servers"], rt["codex"]["skills"]), (2, 2, 2))
        self.assertEqual(rt["claude"]["blocks"], ["core"], "a block without its closing marker is not counted")
        self.assertEqual(rt["claude"]["skills"], 1)


class NoCodexHomeTest(HarnessBase):
    def test_without_a_codex_home_everything_is_claude_and_the_overview_says_so(self):
        cat = self.catalog()
        self.assertEqual(cat["runtimes"]["codex"], {"found": False})
        for g in cat["groups"]:
            for i in g["items"]:
                self.assertEqual(i["runtimes"], ["claude"], (g["kind"], i["id"]))

    def test_a_codex_home_that_is_not_a_directory_counts_as_missing(self):
        self.cfg.codex_home = self.root / "nope"
        self.assertEqual(self.catalog()["runtimes"]["codex"], {"found": False})


class CodexTextCatalogTest(CodexBase):
    def test_every_fixed_codex_text_has_a_spanish_entry(self):
        from python.amauta.portal import wikicodex
        from python.tests.test_portal_i18n import catalog, covered
        keys = catalog()
        fixed = [wikicodex.CODEX_LABEL, wikicodex.CLAUDE_ONLY_TEXT, "Your Codex skills", "Claude Code, Codex"]
        self.assertEqual([s for s in fixed if not covered(s, keys)], [])
