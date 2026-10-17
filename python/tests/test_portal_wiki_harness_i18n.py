import json
import unittest

from python.amauta.portal import wikiharness, wikiprobe, wikitools
from python.tests.test_portal_i18n import catalog, covered
from python.tests.test_portal_wiki_tools import ToolsBase


class HarnessTextCatalogTest(ToolsBase):
    """Every fixed English text the harness pages send has a Spanish entry in the `srv` catalog of i18n.js."""

    def setUp(self):
        super().setUp()
        self.keys = catalog()

    def test_constants(self):
        fixed = [label for _, label in wikiharness.KINDS] + list(wikiharness.EVENT_WHEN.values()) + [
            wikiharness.HOOK_FALLBACK_WHEN, wikiharness.MCP_WHAT, wikiharness.MCP_WHEN, wikiharness.AGENT_WHEN, wikiharness.COMMAND_WHEN, wikiharness.STYLE_WHEN, wikiharness.PLUGIN_WHAT,
            wikiharness.USER_LABEL, wikiharness.BUILTIN_LABEL, wikiharness.USAGE_LABEL, wikiharness.PLUGIN_DISABLED,
            wikitools.SERVER_LABEL, wikitools.CONNECTOR_WHAT, wikitools.CONNECTOR_WHEN, wikitools.MCPTOOL_WHEN, wikitools.USAGE_ONLY_NOTE, wikitools.TOOL_USAGE_NOTE] + [what for _, _, what in wikiharness.HOOK_SUMMARIES]
        self.assertEqual([s for s in fixed if not covered(s, self.keys)], [])

    def test_labels_headings_notes_and_source_names_of_every_page(self):
        missing = set()
        pages = [self.page(k, i) for k in ("hook", "mcp", "agent", "command", "plugin", "outputstyle", "mcptool", "connector", "tool") for i in self.items(k)]
        pages += [self.page("mcp", "engram")]
        for pg in pages:
            texts = [m["label"] for m in pg["meta"]] + [s["heading"] for s in pg["sections"]] + [pg["summary"]["source"]]
            texts += [x for x in (pg["summary"]["note"], None if pg["summary"].get("i18n") else pg["summary"]["when"]) if x]  # curated tools carry their own Spanish text
            for s in pg["sections"]:
                texts += [it["value"] for it in s["items"] if it.get("value") and s["heading"] in ("Configured in", "Source of these facts", "Reported by the server")]
            missing |= {t for t in texts if not covered(t, self.keys)}
            if pg["kind"] in ("connector",) and pg["summary"]["description"]:
                texts.append(pg["summary"]["description"])
            if pg["kind"] == "hook" and pg["summary"]["description"]:
                self.assertTrue(covered(pg["summary"]["description"], self.keys), pg["summary"]["description"])
        self.assertEqual(sorted(missing), [])
        json.dumps(pages)


class ProbeMessagesTest(unittest.TestCase):
    def test_every_fixed_message_of_the_refresh_has_a_spanish_entry(self):
        import re
        from pathlib import Path
        src = (Path(wikiprobe.__file__)).read_text()
        messages = set(re.findall(r'_Fail\(\s*"([^"]+)"', src)) | set(re.findall(r'ProbeError\(\s*"([^"]+)"', src))
        self.assertGreaterEqual(len(messages), 12, messages)
        keys = catalog()
        self.assertEqual(sorted(m for m in messages if not covered(m, keys)), [])
