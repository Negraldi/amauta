"""PBIR tools from the agent archive intake (odd/tasks/agent-archive-intake.md): `refs` finds report field references
the model does not have, `theme` writes a Power BI report theme from colors or the profile's brand, and DAX001 leaves
a division by a numeric constant alone. Every fixture is synthetic.
"""

import io
import json
import os
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from python.amauta.extras.pbir import lint, model, refs, theme
from python.amauta.extras.pbir.__main__ import main
from python.tests.test_pbir import Base, bim, visual


def field(kind, table, prop):
    return {kind: {"Expression": {"SourceRef": {"Entity": table}}, "Property": prop}}


class RefsTest(Base):
    def setUp(self):
        super().setUp()
        self.model = self.write("M.SemanticModel/model.bim", bim())

    def with_filters(self, visuals, page_filters=(), report_filters=()):
        r = self.report(visuals)
        page = r / "definition" / "pages" / "p1" / "page.json"
        meta = json.loads(page.read_text())
        meta["filterConfig"] = {"filters": [{"name": f"f{i}", "field": f} for i, f in enumerate(page_filters)]}
        page.write_text(json.dumps(meta))
        self.write("R.Report/definition/report.json",
                   {"filterConfig": {"filters": [{"name": "r0", "field": f} for f in report_filters]}})
        return r

    def test_missing_tables_and_fields_by_place(self):
        v = visual("a", 0, 0, 100, 100, fields=[("Column", "Sales", "Amount"), ("Measure", "Sales", "Old Total"),
                                                ("Column", "Gone", "X")])
        v["visual"]["query"]["sortDefinition"] = {"sort": [{"field": field("Column", "Sales", "Missing"), "direction": "Descending"}]}
        v["filterConfig"] = {"filters": [{"name": "v0", "field": field("Column", "Customers", "Segment")}]}
        r = self.with_filters([v], page_filters=[field("Column", "Customers", "Region")],
                              report_filters=[field("Measure", "Sales", "Ghost")])
        found = {(f["where"], f["place"], f["ref"], f["problem"]) for f in refs.audit(r, model.load(self.model))}
        self.assertEqual(found, {
            ("Overview/a", "field", "Sales[Old Total]", "no such field"),
            ("Overview/a", "field", "Gone[X]", "no such table"),
            ("Overview/a", "sort", "Sales[Missing]", "no such field"),
            ("Overview/a", "filter", "Customers[Segment]", "no such field"),
            ("report", "filter", "Sales[Ghost]", "no such field"),
        })

    def test_aggregations_and_measures_resolve_and_a_clean_report_has_none(self):
        v = visual("a", 0, 0, 100, 100, fields=[("Measure", "Sales", "Total")])
        v["visual"]["query"]["queryState"]["Values"]["projections"].append(
            {"field": {"Aggregation": {"Expression": field("Column", "Sales", "Amount"), "Function": 0}}, "queryRef": "Sum(Sales.Amount)"})
        r = self.report([v])
        self.assertEqual(refs.audit(r, model.load(self.model)), [])

    def test_cli_exit_codes(self):
        r = self.report([visual("a", 0, 0, 100, 100, fields=[("Column", "Sales", "Nope")])])
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(main(["refs", str(r), str(self.model)]), 1)
        self.assertIn("Overview/a: field Sales[Nope]: no such field", out.getvalue())
        clean = self.root / "clean"
        self.root, old = clean, self.root
        r2 = self.report([visual("a", 0, 0, 100, 100, fields=[("Column", "Sales", "Amount")])])
        self.root = old
        with redirect_stdout(io.StringIO()):
            self.assertEqual(main(["refs", str(r2), str(self.model)]), 0)


class ThemeTest(Base):
    def test_build_validates_colors_and_names(self):
        t = theme.build("Plain", ["#112233", "#AABBCC"], background="#ffffff", foreground="#222222")
        self.assertEqual(t, {"name": "Plain", "dataColors": ["#112233", "#AABBCC"], "background": "#ffffff",
                             "foreground": "#222222", "tableAccent": "#112233"})
        for bad in (["red"], ["#12345"], [], ["#112233"] * 65):
            with self.assertRaises(ValueError, msg=bad):
                theme.build("x", bad)
        with self.assertRaises(ValueError):
            theme.build("", ["#112233"])
        with self.assertRaises(ValueError):
            theme.build("x", ["#112233"], background="url(x)")

    def test_low_contrast_is_reported(self):
        self.assertLess(theme.contrast("#777777", "#888888"), 4.5)
        self.assertAlmostEqual(theme.contrast("#000000", "#ffffff"), 21.0, places=1)
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(main(["theme", "--name", "Gray", "--colors", "#112233", "--background", "#777777",
                                   "--foreground", "#888888", "--out", str(self.root / "gray.json")]), 0)
        self.assertIn("warning: foreground on background has contrast 1.", out.getvalue())

    def test_brand_file_colors(self):
        brand = self.write("brand.md", "# Brand\n\nTheme a.json\n- name: a\n- data colors: #102030, #405060\n- background: #FFFFFF\n")
        self.assertEqual(theme.brand_colors(brand), ["#102030", "#405060"])
        empty = self.write("empty.md", "# Brand\n\nNeutral. One accent color for emphasis.\n")
        with self.assertRaises(ValueError):
            theme.brand_colors(empty)

    def test_cli_writes_once_and_needs_force_to_replace(self):
        out = self.root / "themes" / "plain.json"
        with redirect_stdout(io.StringIO()):
            self.assertEqual(main(["theme", "--name", "Plain", "--colors", "#112233,#445566", "--out", str(out)]), 0)
        self.assertEqual(json.loads(out.read_text())["dataColors"], ["#112233", "#445566"])
        err = io.StringIO()
        with redirect_stderr(err):
            self.assertEqual(main(["theme", "--name", "Other", "--colors", "#000000", "--out", str(out)]), 2)
        self.assertIn("exists", err.getvalue())
        self.assertEqual(json.loads(out.read_text())["name"], "Plain")
        with redirect_stdout(io.StringIO()):
            self.assertEqual(main(["theme", "--name", "Other", "--colors", "#000000", "--out", str(out), "--force"]), 0)
        self.assertEqual(json.loads(out.read_text())["name"], "Other")
        with redirect_stderr(io.StringIO()):
            self.assertEqual(main(["theme", "--name", "x", "--colors", "#000000", "--out", str(self.root / "t.txt")]), 2)

    def test_cli_from_brand_and_profile(self):
        brand = self.write("brand.md", "- data colors: #102030, #405060\n")
        out = self.root / "a.json"
        with redirect_stdout(io.StringIO()):
            self.assertEqual(main(["theme", "--name", "A", "--brand", str(brand), "--out", str(out)]), 0)
        self.assertEqual(json.loads(out.read_text())["dataColors"], ["#102030", "#405060"])
        resolved = {"profile": "org", "files": {"brand.md": {"layer": "org", "path": str(brand)}}}
        with mock.patch.object(theme.profiles, "resolve", return_value=resolved), \
                mock.patch.dict(os.environ, {"AMAUTA_STATE_DIR": str(self.root / "state")}), redirect_stdout(io.StringIO()):
            self.assertEqual(main(["theme", "--name", "B", "--profile", "--out", str(self.root / "b.json")]), 0)
        self.assertEqual(json.loads((self.root / "b.json").read_text())["name"], "B")


class ConstantDivisionTest(unittest.TestCase):
    def test_division_by_a_number_is_not_flagged(self):
        m = model.parse_bim(bim(measures=[{"name": "Pct", "expression": "[Total] / 100"},
                                          {"name": "Half", "expression": "SUM(Sales[Amount]) / 2.5 * 3"},
                                          {"name": "Ratio", "expression": "[Total] / [Count]"},
                                          {"name": "Scaled", "expression": "[Total] / 1000[x]"}]))
        flagged = {f["object"] for f in lint.lint(m) if f["rule"] == "DAX001"}
        self.assertEqual(flagged, {"Sales[Ratio]", "Sales[Scaled]"})


if __name__ == "__main__":
    unittest.main()
