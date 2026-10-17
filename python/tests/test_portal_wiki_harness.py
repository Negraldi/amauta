import json
import re

from python.tests.test_portal_wiki import WikiBase
from python.tests.test_portal_wiki_skills import skill

SECRETS = ("SECRET-ENV", "SECRET-HEADER", "sk-ant-api03-abcdefghijklmnop", "hunter2-secret")


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


class HarnessBase(WikiBase):
    def setUp(self):
        super().setUp()
        home, repo, root = self.f["home"], self.f["repo"], self.root
        write(home / "agents" / "my-agent.md", "---\nname: my-agent\ndescription: >\n  Reviews things.\n  Carefully.\nmodel: sonnet\ntools: Read, Grep, mcp__engram__mem_save\n---\nYou review things.\n\n## Rules\n- be kind\n")
        write(home / "commands" / "do-it.md", "---\ndescription: Does it\nargument-hint: <what>\n---\nDo $ARGUMENTS now.\n")
        write(home / "output-styles" / "terse.md", "---\nname: Terse\ndescription: Short answers\n---\nBe brief.\n")
        write(home / "settings.json", json.dumps({"outputStyle": "Terse", "enabledPlugins": {"plug@mk": True}, "hooks": {
            "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "env PYTHONPATH=/r python3 -P -m amauta.usage hook", "timeout": 10}, {"type": "command", "command": "echo SECRET-USER-HOOK --token hunter2-secret"}]}],
            "SessionStart": [{"matcher": "startup|resume", "hooks": [{"type": "command", "command": "node /r/bin/amauta.js hook review-stop", "timeout": 30}]}]}}))
        write(repo / ".claude" / "settings.json", json.dumps({"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "./check.sh"}]}]}}))
        write(repo / ".claude" / "settings.local.json", json.dumps({"hooks": {"PostToolUse": [{"hooks": [{"type": "command", "command": "./local.sh"}]}]}}))
        write(repo / ".claude" / "agents" / "proj-agent.md", "---\nname: proj-agent\ndescription: Project agent\n---\nBody\n")
        write(repo / ".claude" / "commands" / "proj-cmd.md", "---\ndescription: Project command\n---\nBody\n")
        write(repo / ".mcp.json", json.dumps({"mcpServers": {"projsrv": {"command": "node", "args": ["srv.js", "--api-key", "sk-ant-api03-abcdefghijklmnop"], "env": {"X_TOKEN": "SECRET-ENV"}}}}))
        cj = json.loads(self.f["claude_json"].read_text())
        cj["mcpServers"]["remote"] = {"type": "http", "url": "https://x.example/mcp?token=hunter2-secret", "headers": {"Authorization": "Bearer SECRET-HEADER"}}
        cj["projects"] = {"/work/gamma": {"mcpServers": {"gammasrv": {"command": "python3", "args": ["-P"]}}}}
        self.f["claude_json"].write_text(json.dumps(cj))
        pdir = home / "plugins" / "cache" / "mk" / "plug" / "1.0.0"
        write(pdir / ".claude-plugin" / "plugin.json", json.dumps({"name": "plug", "description": "A test plugin", "version": "1.0.0", "author": {"name": "Ann"}}))
        write(pdir / "hooks" / "hooks.json", json.dumps({"hooks": {"UserPromptSubmit": [{"hooks": [{"type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}/scripts/p.sh\""}]}]}}))
        write(pdir / "agents" / "plug-agent.md", "---\nname: plug-agent\ndescription: Plugin agent\n---\nBody\n")
        write(pdir / "commands" / "plug-cmd.md", "---\ndescription: Plugin command\n---\nBody\n")
        write(pdir / ".mcp.json", json.dumps({"mcpServers": {"plugsrv": {"command": "plugsrv-bin"}}}))
        skill(pdir / "skills" / "plug-skill", "plug-skill", "A plugin skill")

    def catalog(self):
        return self.get("/api/harness/components")

    def items(self, kind):
        return {i["id"]: i for g in self.catalog()["groups"] if g["kind"] == kind for i in g["items"]}

    def hook_id(self, event, needle):
        return next(i for i in self.items("hook") if i.startswith(event + ":") and needle in self.items("hook")[i]["title"])


class CatalogTest(HarnessBase):
    def test_groups_come_in_a_fixed_order_with_labels(self):
        cat = self.catalog()
        self.assertEqual([g["kind"] for g in cat["groups"]][:1], ["hook"])
        kinds = [g["kind"] for g in cat["groups"]]
        self.assertEqual(kinds, [k for k in ("hook", "mcp", "mcptool", "connector", "tool", "agent", "command", "plugin", "outputstyle") if k in kinds])
        self.assertTrue(all(g["label"] and g["items"] for g in cat["groups"]))
        self.assertEqual(cat["total"], sum(len(g["items"]) for g in cat["groups"]))

    def test_every_source_is_discovered(self):
        self.assertTrue({"my-agent", "plug:plug-agent"} <= set(self.items("agent")))
        self.assertIn("repo/proj-agent", self.items("agent"))
        self.assertTrue({"do-it", "repo/proj-cmd", "plug:plug-cmd"} <= set(self.items("command")))
        self.assertEqual(set(self.items("outputstyle")), {"terse"})
        self.assertEqual(set(self.items("plugin")), {"plug"})
        self.assertTrue({"engram", "other", "remote", "projsrv", "gammasrv", "plugsrv"} <= set(self.items("mcp")))

    def test_hooks_from_user_project_local_and_plugin_files(self):
        events = sorted(i.split(":")[0] for i in self.items("hook"))
        self.assertEqual(events.count("Stop"), 2)
        for event in ("PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart"):
            self.assertIn(event, events)


class HookPageTest(HarnessBase):
    def test_amauta_script_gets_a_curated_summary_and_the_event_description(self):
        pg = self.page("hook", self.hook_id("Stop", "amauta usage"))
        self.assertIn("usage database", pg["summary"]["description"])
        self.assertTrue(pg["summary"]["when"])
        m = self.meta(pg)
        self.assertEqual((m["Event"], m["Matcher"], m["Timeout"], m["Hook type"]), ("Stop", "(all)", "10 s", "command"))
        self.assertIn("amauta.usage hook", m["Command"])
        self.assertEqual(pg["summary"]["path"], str(self.f["home"] / "settings.json"))
        self.assertEqual(pg["summary"]["source"], "Your Claude home")

    def test_unknown_commands_are_shown_masked_and_say_there_is_no_summary(self):
        pg = self.page("hook", self.hook_id("Stop", "echo"))
        self.assertIsNone(pg["summary"]["description"])
        self.assertTrue(pg["summary"]["note"])
        self.assertIn("echo SECRET-USER-HOOK", self.meta(pg)["Command"])
        self.assertNotIn("hunter2-secret", json.dumps(pg))
        self.assertNotIn("hunter2-secret", json.dumps(self.catalog()))

    def test_project_and_plugin_hooks_name_their_source(self):
        pre = self.page("hook", self.hook_id("PreToolUse", "check.sh"))
        self.assertEqual(pre["summary"]["source"], "Project repo")
        self.assertEqual(self.meta(pre)["Matcher"], "Bash")
        self.assertTrue(pre["summary"]["path"].endswith("/.claude/settings.json"))
        plug = self.page("hook", self.hook_id("UserPromptSubmit", "p.sh"))
        self.assertEqual(plug["summary"]["source"], "Plugin plug")
        self.assertIn("plugin", {r["kind"] for r in plug["backlinks"]})


class HookTitleTest(HarnessBase):
    def titles(self, hooks):
        path = self.f["home"] / "settings.json"
        data = json.loads(path.read_text())
        data["hooks"] = hooks
        path.write_text(json.dumps(data))
        return sorted(i["title"] for i in self.items("hook").values())

    def test_titles_are_human_event_dot_name_with_the_matcher_when_present(self):
        cmd = "[ -f /home/u/.claude/skills/impeccable/scripts/impeccable-hook.sh ] && bash /home/u/.claude/skills/impeccable/scripts/impeccable-hook.sh"
        got = self.titles({
            "PostToolUse": [{"matcher": "Edit|Write", "hooks": [{"type": "command", "command": cmd}]}],
            "Stop": [{"hooks": [{"type": "command", "command": "env PYTHONPATH=/r python3 -P -m amauta.usage hook"}, {"type": "command", "command": "echo hi there"}]}],
        })
        self.assertTrue({"PostToolUse (Edit|Write) \u00b7 impeccable-hook.sh", "Stop \u00b7 amauta usage", "Stop \u00b7 echo"} <= set(got), got)
        self.assertFalse([t for t in got if ": " in t], got)  # no raw "Event: command prefix" titles

    def test_the_full_masked_command_stays_on_the_page(self):
        self.titles({"PostToolUse": [{"hooks": [{"type": "command", "command": "bash /x/y/run.sh --token hunter2-secret"}]}]})
        ident = next(i for i, v in self.items("hook").items() if i.startswith("PostToolUse:") and v["title"].endswith("run.sh"))
        pg = self.page("hook", ident)
        self.assertEqual(pg["title"], "PostToolUse \u00b7 run.sh")
        self.assertIn("bash /x/y/run.sh", self.meta(pg)["Command"])
        self.assertNotIn("hunter2-secret", json.dumps(pg))


class NumericMetaTest(HarnessBase):
    IDENTIFIERS = {"Version", "version", "Node id"}  # digits that name something: shown verbatim

    def test_every_numeric_meta_value_is_marked_for_digit_grouping(self):
        pages = [self.page(kind, ident) for kind in ("hook", "mcp", "agent", "command", "plugin", "outputstyle") for ident in self.items(kind)]
        pages += [self.page("skill", "work-unit-commits"), self.page("tool", "Bash")]
        loose = [(pg["kind"], pg["id"], m["label"], m["value"]) for pg in pages for m in pg["meta"]
                 if re.fullmatch(r"-?\d+(\.\d+)?", m["value"]) and m["label"] not in self.IDENTIFIERS and m.get("fmt") != "number"]
        self.assertEqual(loose, [])


class McpPageTest(HarnessBase):
    def test_stdio_server_shows_command_args_and_env_names_only(self):
        pg = self.page("mcp", "projsrv")
        m = self.meta(pg)
        self.assertEqual(m["Type"], "stdio")
        self.assertIn("node srv.js --api-key ***", m["Command"])
        self.assertEqual(m["Environment variables (names only)"], "X_TOKEN")
        self.assertEqual(pg["summary"]["source"], "Project repo")
        self.assertTrue(pg["summary"]["description"])

    def test_http_server_masks_url_query_and_shows_header_names(self):
        pg = self.page("mcp", "remote")
        m = self.meta(pg)
        self.assertEqual((m["Type"], m["Header names"]), ("http", "Authorization"))
        self.assertIn("x.example/mcp?token=***", m["URL"])

    def test_no_secret_value_appears_in_any_response(self):
        blob = json.dumps(self.catalog())
        for ident in self.items("mcp"):
            blob += json.dumps(self.page("mcp", ident))
        for kind in ("hook", "agent", "command", "plugin", "outputstyle"):
            for ident in self.items(kind):
                blob += json.dumps(self.page(kind, ident))
        for secret in SECRETS:
            self.assertNotIn(secret, blob.replace("echo SECRET-USER-HOOK", ""), secret)

    def test_usage_page_of_a_used_server_gains_the_configuration_summary(self):
        pg = self.page("mcp", "engram")
        self.assertIn("usage", pg)
        self.assertTrue(pg["summary"]["description"])
        self.assertEqual(self.meta(pg)["Type"], "stdio")
        self.assertEqual(self.meta(pg)["Environment variables (names only)"], "TOKEN")
        self.assertNotIn("SECRET-ENV", json.dumps(pg))

    def test_plugin_server_has_the_plugin_as_backlink(self):
        pg = self.page("mcp", "plugsrv")
        self.assertIn(("plugin", "plug"), [(r["kind"], r["id"]) for r in pg["backlinks"]])


class MarkdownComponentTest(HarnessBase):
    def test_agent_page_has_frontmatter_facts_body_and_links(self):
        pg = self.page("agent", "my-agent")
        self.assertEqual(pg["summary"]["description"], "Reviews things. Carefully.")
        self.assertIn("## Rules", pg["body_md"])
        m = self.meta(pg)
        self.assertEqual((m["Model"], m["Scope"]), ("sonnet", "user"))
        self.assertIn("Read", m["Tools"])
        self.assertEqual(pg["summary"]["path"], str(self.f["home"] / "agents" / "my-agent.md"))

    def test_command_and_output_style_pages(self):
        cmd = self.page("command", "do-it")
        self.assertEqual((cmd["title"], cmd["summary"]["description"], self.meta(cmd)["Argument hint"]), ("/do-it", "Does it", "<what>"))
        self.assertIn("Do $ARGUMENTS", cmd["body_md"])
        style = self.page("outputstyle", "terse")
        self.assertEqual(self.meta(style)["Active"], "yes")
        self.assertEqual(style["summary"]["description"], "Short answers")

    def test_project_and_plugin_variants(self):
        self.assertEqual(self.page("agent", "repo/proj-agent")["summary"]["source"], "Project repo")
        self.assertEqual(self.page("command", "plug:plug-cmd")["summary"]["source"], "Plugin plug")


class PluginPageTest(HarnessBase):
    def test_manifest_facts_and_links_to_what_it_provides(self):
        pg = self.page("plugin", "plug")
        m = self.meta(pg)
        self.assertEqual((m["Version"], m["Enabled"], m["Author"]), ("1.0.0", "yes", "Ann"))
        self.assertEqual(pg["summary"]["description"], "A test plugin")
        links = {(r["kind"], r["id"]) for r in pg["links"]}
        for want in (("agent", "plug:plug-agent"), ("command", "plug:plug-cmd"), ("mcp", "plugsrv"), ("skill", "plug:plug-skill")):
            self.assertIn(want, links)
        self.assertTrue(any(k == "hook" for k, _ in links))

    def test_symlinked_plugin_directories_are_ignored(self):
        outside = self.root / "outside"
        write(outside / ".claude-plugin" / "plugin.json", json.dumps({"name": "evil"}))
        (self.f["home"] / "plugins" / "cache" / "mk" / "evil-link").symlink_to(outside, target_is_directory=True)
        self.assertNotIn("evil", self.items("plugin"))


class RobustnessTest(HarnessBase):
    def test_unknown_ids_and_odd_ids_are_404(self):
        for kind in ("hook", "mcp", "agent", "command", "plugin", "outputstyle"):
            for ident in ("nope", "../../etc/passwd", "a/../b", "x" * 100):
                self.assertEqual(self.status("/api/wiki/page", kind=kind, id=ident), 404, (kind, ident))

    def test_malformed_settings_and_json_files_do_not_break_the_catalog(self):
        (self.f["home"] / "settings.json").write_text("{not json")
        (self.f["repo"] / ".mcp.json").write_text("[1,2,3]")
        (self.f["home"] / "agents" / "bad.md").write_bytes(b"\xff\xfe---\nname")
        self.portal._harness_cache = None
        self.assertGreater(self.catalog()["total"], 0)

    def test_symlinked_files_are_not_followed(self):
        outside = self.root / "secret.md"
        outside.write_text("---\ndescription: LEAK\n---\nLEAK\n")
        (self.f["home"] / "agents" / "linked.md").symlink_to(outside)
        self.portal._harness_cache = None
        self.assertNotIn("linked", self.items("agent"))

    def test_results_are_rebuilt_after_the_cache_is_forgotten(self):
        self.assertNotIn("late", self.items("agent"))
        write(self.f["home"] / "agents" / "late.md", "---\ndescription: Late\n---\nx\n")
        self.portal._harness_cache = None
        self.assertIn("late", self.items("agent"))


class SearchTest(HarnessBase):
    def test_global_search_includes_the_new_kinds(self):
        groups = {g["kind"]: g for g in self.get("/api/wiki/search", q="plug")["groups"]}
        self.assertIn("plugin", groups)
        self.assertIn("agent", groups)
        self.assertIn("command", groups)
        self.assertTrue(all(i["kind"] == "plugin" for i in groups["plugin"]["items"]))
        hooks = {g["kind"]: g for g in self.get("/api/wiki/search", q="amauta usage")["groups"]}
        self.assertIn("hook", hooks)

    def test_wikilinks_can_target_the_new_kinds(self):
        from python.amauta.portal import wiki
        self.assertEqual(wiki._parse_wikilinks("[[agent:my-agent]] [[hook:Stop:abc]] [[plugin:plug|P]]"), [("agent", "my-agent", "my-agent"), ("hook", "Stop:abc", "Stop:abc"), ("plugin", "plug", "P")])
