import json

from python.amauta.portal import wikiharness
from python.tests.test_portal_i18n import catalog, covered
from python.tests.test_portal_wiki_harness import HarnessBase


class HarnessTextCatalogTest(HarnessBase):
    """Every fixed English text the harness pages send has a Spanish entry in the `srv` catalog of i18n.js."""

    def setUp(self):
        super().setUp()
        self.keys = catalog()

    def test_constants(self):
        fixed = [label for _, label in wikiharness.KINDS] + list(wikiharness.EVENT_WHEN.values()) + [
            wikiharness.HOOK_FALLBACK_WHEN, wikiharness.MCP_WHAT, wikiharness.MCP_WHEN, wikiharness.AGENT_WHEN, wikiharness.COMMAND_WHEN, wikiharness.STYLE_WHEN, wikiharness.PLUGIN_WHAT,
            wikiharness.USER_LABEL, wikiharness.BUILTIN_LABEL, wikiharness.USAGE_LABEL] + [what for _, _, what in wikiharness.HOOK_SUMMARIES]
        self.assertEqual([s for s in fixed if not covered(s, self.keys)], [])

    def test_labels_headings_notes_and_source_names_of_every_page(self):
        missing = set()
        pages = [self.page(k, i) for k in ("hook", "mcp", "agent", "command", "plugin", "outputstyle") for i in self.items(k)]
        pages += [self.page("mcp", "engram")]
        for pg in pages:
            texts = [m["label"] for m in pg["meta"]] + [s["heading"] for s in pg["sections"]] + [pg["summary"]["source"]]
            texts += [x for x in (pg["summary"]["note"], pg["summary"]["when"]) if x]
            for s in pg["sections"]:
                texts += [it["value"] for it in s["items"] if it.get("value") and s["heading"] in ("Configured in", "Source of these facts")]
            missing |= {t for t in texts if not covered(t, self.keys)}
            if pg["kind"] == "hook" and pg["summary"]["description"]:
                self.assertTrue(covered(pg["summary"]["description"], self.keys), pg["summary"]["description"])
        self.assertEqual(sorted(missing), [])
        json.dumps(pages)
