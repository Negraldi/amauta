"""PBIR tools for the powerbi-report skill (plan D9b): DAX and model lint as warnings, model diff and data dictionary,
layout audit and a structural cascading rename. Every fixture is synthetic; the tools only read unless asked to apply.
"""

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from python.amauta.extras.pbir import layout, lint, model, rename
from python.amauta.extras.pbir.__main__ import main


def bim(measures=None, relationships=None, extra_columns=()):
    return {"model": {
        "tables": [
            {"name": "Sales", "columns": [{"name": "Amount", "dataType": "decimal"}, {"name": "Date", "dataType": "dateTime"},
                                         {"name": "CustomerKey", "dataType": "string"}, *extra_columns],
             "measures": measures if measures is not None else [
                 {"name": "Total", "expression": "SUM(Sales[Amount])", "formatString": "#,0"},
                 {"name": "Ratio", "expression": "[Total] / [Count]"},
                 {"name": "Avg", "expression": "AVERAGEX(Sales, CALCULATE([Total]))"},
                 {"name": "AllSales", "expression": "CALCULATE([Total], FILTER(ALL(Sales), Sales[Amount] > 0))"},
                 {"name": "Count", "expression": "COUNTROWS(Sales)"}]},
            {"name": "Customers", "columns": [{"name": "CustomerKey", "dataType": "string"}, {"name": "cedula", "dataType": "string"},
                                             {"name": "Region", "dataType": "string"}]},
        ],
        "relationships": relationships if relationships is not None else [
            {"fromTable": "Sales", "fromColumn": "CustomerKey", "toTable": "Customers", "toColumn": "CustomerKey",
             "crossFilteringBehavior": "bothDirections"}],
    }}


def visual(name, x, y, w, h, fields=(), kind="clusteredColumnChart", title=None):
    projections = [{"field": {kind_: {"Expression": {"SourceRef": {"Entity": t}}, "Property": p}}, "queryRef": f"{t}.{p}", "nativeQueryRef": p}
                   for kind_, t, p in fields]
    v = {"name": name, "position": {"x": x, "y": y, "width": w, "height": h},
         "visual": {"visualType": kind, "query": {"queryState": {"Values": {"projections": projections}}}}}
    if title:
        v["visual"]["objects"] = {"title": [{"properties": {"text": {"expr": {"Literal": {"Value": f"'{title}'"}}}}}]}
    return v


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def write(self, rel, data):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, indent=2) if not isinstance(data, str) else data, encoding="utf-8")
        return p

    def report(self, visuals, width=1280, height=720):
        page = self.root / "R.Report" / "definition" / "pages" / "p1"
        self.write(page.relative_to(self.root) / "page.json", {"name": "p1", "displayName": "Overview", "width": width, "height": height})
        for v in visuals:
            self.write(page.relative_to(self.root) / "visuals" / v["name"] / "visual.json", v)
        return self.root / "R.Report"


class ModelTest(Base):
    def test_loads_model_bim_and_tmdl(self):
        m = model.load(self.write("M.SemanticModel/model.bim", bim()))
        self.assertEqual([t["name"] for t in m["tables"]], ["Sales", "Customers"])
        tmdl = self.root / "T.SemanticModel" / "definition" / "tables"
        tmdl.mkdir(parents=True)
        (tmdl / "Sales.tmdl").write_text("table Sales\n\n\tmeasure Total = SUM(Sales[Amount])\n\t\tformatString: #,0\n\n"
                                         "\tmeasure 'Multi Line' =\n\t\t\tVAR x = 1\n\t\t\tRETURN x\n\n\tcolumn Amount\n\t\tdataType: decimal\n")
        t = model.load(self.root / "T.SemanticModel")
        sales = t["tables"][0]
        self.assertEqual([m["name"] for m in sales["measures"]], ["Total", "Multi Line"])
        self.assertIn("RETURN x", sales["measures"][1]["expression"])
        self.assertEqual([c["name"] for c in sales["columns"]], ["Amount"])

    def test_diff_and_dictionary(self):
        old = bim()
        new = bim(measures=[{"name": "Total", "expression": "SUM(Sales[Amount]) + 0"}, {"name": "Margin", "expression": "[Total] * 0.1"}],
                  extra_columns=[{"name": "Channel", "dataType": "string"}])
        d = model.diff(model.parse_bim(old), model.parse_bim(new))
        self.assertEqual(d["measures"]["added"], ["Sales[Margin]"])
        self.assertEqual(d["measures"]["changed"], ["Sales[Total]"])
        self.assertIn("Sales[Ratio]", d["measures"]["removed"])
        self.assertEqual(d["columns"]["added"], ["Sales[Channel]"])
        md = model.dictionary(model.parse_bim(old))
        self.assertIn("| Sales | Total | measure |", md)
        self.assertIn("SUM(Sales[Amount])", md)


class LintTest(Base):
    def test_rules_are_warnings_with_reasons(self):
        found = {(f["rule"], f["object"]) for f in lint.lint(model.parse_bim(bim()))}
        self.assertIn(("DAX001", "Sales[Ratio]"), found, "division without DIVIDE")
        self.assertIn(("DAX002", "Sales[Avg]"), found, "CALCULATE inside an iterator: a review prompt")
        self.assertIn(("DAX003", "Sales[AllSales]"), found, "FILTER(ALL(...))")
        self.assertIn(("MOD001", "Sales[CustomerKey] -> Customers[CustomerKey]"), found, "bidirectional")
        self.assertIn(("MOD003", "Customers[cedula]"), found, "a personal-data column")
        self.assertNotIn(("DAX001", "Sales[Total]"), found)
        self.assertTrue(all(f["severity"] == "warning" for f in lint.lint(model.parse_bim(bim()))))


class LayoutTest(Base):
    def test_overlaps_out_of_canvas_and_tiny_visuals(self):
        r = self.report([visual("a", 0, 0, 400, 300), visual("b", 350, 250, 400, 300), visual("c", 1100, 600, 300, 200),
                         visual("d", 10, 650, 20, 20), visual("g", 0, 0, 800, 600, kind="group")])
        kinds = {(f["kind"], tuple(f["visuals"])) for f in layout.audit(r)}
        self.assertIn(("overlap", ("a", "b")), kinds)
        self.assertIn(("outside", ("c",)), kinds)
        self.assertIn(("tiny", ("d",)), kinds)
        self.assertFalse(any("g" in v for _, v in kinds), "a group is a container, not an overlap")


class RenameTest(Base):
    def test_structural_rename_is_planned_then_applied_and_leaves_text_alone(self):
        r = self.report([visual("a", 0, 0, 100, 100, fields=[("Column", "Sales", "Amount"), ("Measure", "Sales", "Total")], title="Amount by month"),
                         visual("b", 200, 0, 100, 100, fields=[("Column", "Customers", "Amount")])])
        plan = rename.plan(r, "Sales", "Amount", "Net Amount")
        self.assertEqual([(c["visual"], c["count"]) for c in plan], [("a", 3)], "Property, queryRef and nativeQueryRef")
        before = (r / "definition/pages/p1/visuals/a/visual.json").read_text()
        self.assertEqual((r / "definition/pages/p1/visuals/a/visual.json").read_text(), before, "a plan writes nothing")
        rename.apply(r, "Sales", "Amount", "Net Amount")
        a = json.loads((r / "definition/pages/p1/visuals/a/visual.json").read_text())
        proj = a["visual"]["query"]["queryState"]["Values"]["projections"][0]
        self.assertEqual(proj["field"]["Column"]["Property"], "Net Amount")
        self.assertEqual(proj["queryRef"], "Sales.Net Amount")
        self.assertIn("Amount by month", json.dumps(a), "a title is text, not a reference")
        b = json.loads((r / "definition/pages/p1/visuals/b/visual.json").read_text())
        self.assertEqual(b["visual"]["query"]["queryState"]["Values"]["projections"][0]["field"]["Column"]["Property"], "Amount", "another table")


class CliTest(Base):
    def test_commands_print_reports_and_rename_needs_apply(self):
        m = self.write("M.SemanticModel/model.bim", bim())
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(main(["lint", str(m)]), 0, "warnings never fail")
        self.assertIn("DAX001", out.getvalue())
        r = self.report([visual("a", 0, 0, 100, 100, fields=[("Column", "Sales", "Amount")])])
        with redirect_stdout(io.StringIO()):
            self.assertEqual(main(["rename", str(r), "--table", "Sales", "--from", "Amount", "--to", "Net"]), 0)
        self.assertIn('"Amount"', (r / "definition/pages/p1/visuals/a/visual.json").read_text(), "dry run by default")
        with redirect_stdout(io.StringIO()):
            self.assertEqual(main(["rename", str(r), "--table", "Sales", "--from", "Amount", "--to", "Net", "--apply"]), 0)
        self.assertIn('"Net"', (r / "definition/pages/p1/visuals/a/visual.json").read_text())


if __name__ == "__main__":
    unittest.main()
