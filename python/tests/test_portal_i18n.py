import json
import re
import unittest
from pathlib import Path

from python.amauta.portal import projects, skillhist, skillimpact, wikilint, wikimem, wikiskills, wikiusage
from python.tests.test_portal_server import ServerBase
from python.tests.test_portal_wiki import WikiBase

STATIC = Path(__file__).resolve().parents[1] / "amauta" / "portal" / "static"


def catalog():
    """The keys of the `srv` dictionary in i18n.js: the exact English text the server sends (with {x} for variable parts)."""
    text = (STATIC / "i18n.js").read_text()
    body = text[text.index("const srv = {"):]
    body = body[:body.index("\n  };")]
    return {json.loads(m.group(1)) for m in re.finditer(r'^\s*("(?:[^"\\]|\\.)*"):', body, re.M)}


NUMERIC = {"n", "m", "done", "total", "days", "nodes", "edges"}


def covered(text, keys):
    """True when the catalog has this exact text or a {placeholder} template that matches all of it (the same rule i18n.js applies)."""
    if text in keys:
        return True
    for key in keys:
        if "{" in key:
            pattern = re.escape(key)
            pattern = re.sub(r"\\\{(\w+)\\\}", lambda m: r"\d+" if m.group(1) in NUMERIC else ".+?", pattern)
            if re.fullmatch(pattern, text, re.S):
                return True
    return False


class ServedTest(ServerBase):
    def test_i18n_is_served_and_listed_before_the_app(self):
        status, h, body = self.request("GET", "/static/i18n.js")
        self.assertEqual(status, 200)
        self.assertIn("javascript", h["content-type"])
        self.assertIn(b"AmautaI18n", body)
        index = self.request("GET", "/")[2].decode()
        self.assertLess(index.index("/static/i18n.js"), index.index("/static/app.js"))


class CatalogCoversServerTextTest(unittest.TestCase):
    """The client translates the English chrome text the server sends; these fixed strings must have an entry."""

    def test_constants_the_pages_show(self):
        keys = catalog()
        fixed = [wikimem.NOTE, wikiusage.BUILTIN_NOTE, skillimpact.NOTE, projects.GRAPH_HOWTO, *skillimpact.SECTIONS.values(), *[label for _, label in wikiskills.SOURCES]]
        missing = [s for s in fixed if s not in keys]
        self.assertEqual(missing, [], "server strings without a Spanish entry in i18n.js")

    def test_the_skill_source_labels(self):
        keys = catalog()
        for label in ("Installed by amauta", "Your skills", "Built into Claude Code", "Plugin {name}", "Project {name}"):
            self.assertIn(label, keys)


class LintCategoriesTest(WikiBase):
    def test_every_lint_title_note_and_detail_has_an_entry(self):
        keys = catalog()
        body = self.portal.get("/api/wiki/lint", {})[1]
        self.assertTrue(body["categories"])
        for cat in body["categories"]:
            self.assertTrue(covered(cat["title"], keys), cat["id"])
            self.assertTrue(covered(cat["note"], keys), (cat["id"], cat["note"]))
            for item in cat["items"]:
                if item.get("detail"):
                    self.assertTrue(covered(item["detail"], keys), (cat["id"], item["detail"]))


class StaticTextInSourceTest(unittest.TestCase):
    """Meta labels and section headings written as literals in the page builders are all in the catalog."""

    def test_meta_labels_and_headings(self):
        keys = catalog()
        wanted = set()
        for name in ("wiki.py", "wikiproject.py", "wikiusage.py"):
            src = (Path(__file__).resolve().parents[1] / "amauta" / "portal" / name).read_text()
            for line in src.splitlines():
                if "_meta(" in line:
                    wanted |= set(re.findall(r'\(\s*"([A-Z][A-Za-z ]+)",', line))
            wanted |= set(re.findall(r'"heading":\s*"([^"{]+)"', src))
        wanted |= {"Skills", "Tools", "MCP servers", "Subagent types"}  # headings passed through a loop in wikiusage.page
        self.assertTrue(len(wanted) > 25, wanted)
        self.assertEqual(sorted(w for w in wanted if w not in keys), [], "labels or headings without a Spanish entry")


if __name__ == "__main__":
    unittest.main()
