"""The guide (odd/tasks/portal-guide.md): Markdown pages shipped with the portal, served only by a known slug, in the
portal's language (English when a page has no translation)."""

import tempfile
import unittest
from pathlib import Path

from python.amauta.portal import guide
from python.amauta.portal.api import Portal
from python.amauta.portal.config import Config


class GuideTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.portal = Portal(Config(state_dir=root / "state", claude_home=root / "home"))

    def test_the_index_lists_the_pages_in_order_with_their_titles(self):
        status, data = self.portal.get("/api/guide", {"lang": "es"})
        self.assertEqual(status, 200)
        slugs = [p["slug"] for p in data["pages"]]
        self.assertEqual(slugs, list(guide.SLUGS))
        self.assertEqual(slugs[0], "overview")
        self.assertTrue(all(p["title"] for p in data["pages"]))

    def test_a_page_comes_in_the_asked_language(self):
        en = self.portal.get("/api/guide/page", {"slug": "kernel", "lang": "en"})[1]
        es = self.portal.get("/api/guide/page", {"slug": "kernel", "lang": "es"})[1]
        self.assertEqual((en["lang"], es["lang"]), ("en", "es"))
        self.assertNotEqual(en["markdown"], es["markdown"])
        self.assertEqual(self.portal.get("/api/guide/page", {"slug": "kernel", "lang": "fr"})[1]["lang"], "en", "English otherwise")

    def test_only_known_pages_are_served(self):
        for slug in ("../../etc/passwd", "nope", "", "KERNEL"):
            status, _ = self.portal.get("/api/guide/page", {"slug": slug, "lang": "en"})
            self.assertEqual(status, 404, slug)


if __name__ == "__main__":
    unittest.main()
