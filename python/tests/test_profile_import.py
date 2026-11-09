"""Profile import and harvest (plan D13, ADR 0007): both produce a draft in the state directory with a REVIEW.md, never
an installed profile; `accept` installs a draft only when the privacy guard finds nothing. Fixtures are synthetic.
"""

import json
import tempfile
import unittest
from pathlib import Path

from python.amauta.privacy import profile_import as imp
from python.amauta.privacy import profiles
from python.tests import detector_fixtures as fx

THEME = {"name": "Fictional Corp", "dataColors": ["#123456", "#abcdef", "#00ff00"], "background": "#ffffff", "foreground": "#222222"}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.state = self.root / "state"

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text if isinstance(text, str) else json.dumps(text), encoding="utf-8")
        return p


class ImportTest(Base):
    def archive(self):
        a = self.root / "archive"
        self.write("archive/rules/00-sql-safety.md", "# SQL safety\n\nRead-only queries; no NOLOCK by default.\n")
        self.write("archive/rules/01-team.md", "# Team\n\nWrite to ops@example.org for access.\n")
        self.write("archive/skills/bi/SKILL.md", "---\nname: bi\n---\n\n# BI\n\nReports start from a contract.\n")
        self.write("archive/skills/bi/references/design_system.md", "# Design system\n\nCards on top, detail below.\n")
        self.write("archive/skills/bi/references/dax_statements_guide.md", "# DAX\n\nTotal Sales = SUM(Sales[Amount])\n")
        self.write("archive/skills/bi/templates/Corp_Theme.json", THEME)
        self.write("archive/skills/bi/templates/card.dax", "Card = \"<div>\" & [Total] & \"</div>\"\n")
        self.write("archive/skills/bi/scripts/tool.py", "print('x')\n")
        return a

    def test_import_builds_a_draft_by_file_kind_with_a_review(self):
        d = imp.import_archive(self.state, "corp", self.archive())
        self.assertEqual(d, self.state / "profiles" / "corp.draft")
        self.assertIn("Read-only queries", (d / "conventions.md").read_text())
        self.assertIn("Reports start from a contract", (d / "conventions.md").read_text())
        self.assertIn("Cards on top", (d / "brand.md").read_text())
        self.assertIn("#123456", (d / "brand.md").read_text(), "the theme palette")
        self.assertIn("Total Sales", (d / "glossary.md").read_text())
        self.assertTrue((d / "assets" / "templates" / "Corp_Theme.json").is_file())
        self.assertTrue((d / "assets" / "templates" / "card.dax").is_file())
        review = (d / "REVIEW.md").read_text()
        self.assertIn("skills/bi/scripts/tool.py: skipped (code)", review)
        self.assertIn("rules/01-team.md -> conventions.md", review)
        self.assertRegex(review, r"conventions\.md:\d+: email")
        self.assertNotIn("ops@example.org", review, "findings never echo the value")
        self.assertFalse((self.state / "profiles" / "corp").exists(), "only a draft")

    def test_accept_refuses_while_the_guard_finds_something_and_installs_once_clean(self):
        d = imp.import_archive(self.state, "corp", self.archive())
        with self.assertRaises(ValueError):
            imp.accept(self.state, "corp")
        conv = d / "conventions.md"
        conv.write_text(conv.read_text().replace("ops@example.org", "the access team"))
        imp.accept(self.state, "corp")
        self.assertTrue((self.state / "profiles" / "corp" / "brand.md").is_file())
        self.assertFalse(d.exists())
        self.assertFalse((self.state / "profiles" / "corp" / "REVIEW.md").exists())
        self.assertEqual(profiles.check(self.state, "corp"), [])


class HarvestTest(Base):
    def test_harvest_reads_themes_measures_and_convention_documents(self):
        self.write("work/report/Theme.json", THEME)
        self.write("work/model/M.SemanticModel/model.bim", {"model": {"tables": [{"name": "Sales", "measures": [
            {"name": "Total", "expression": "SUM(Sales[Amount])"}]}]}})
        self.write("work/CONTRIBUTING.md", "# Contributing\n\nTables are singular nouns.\n")
        self.write("work/data/clientes.csv", f"cedula\n{fx.cedula(1)}\n")
        d = imp.harvest(self.state, "corp", [self.root / "work"])
        self.assertIn("#abcdef", (d / "brand.md").read_text())
        self.assertIn("Sales[Total]", (d / "glossary.md").read_text())
        self.assertIn("SUM(Sales[Amount])", (d / "glossary.md").read_text())
        self.assertIn("Tables are singular nouns", (d / "conventions.md").read_text())
        self.assertNotIn(fx.cedula(1), "".join(p.read_text() for p in d.rglob("*.md")), "data files are never read")
        self.assertIn("Theme.json -> brand.md", (d / "REVIEW.md").read_text())


if __name__ == "__main__":
    unittest.main()
