"""Semantic model files to one shape: {"tables": [{name, columns: [{name, dataType}], measures: [{name, expression,
formatString}]}], "relationships": [{fromTable, fromColumn, toTable, toColumn, crossFilteringBehavior, cardinality}]}.

Reads `model.bim` (TMSL JSON) fully and TMDL table files (`definition/tables/*.tmdl`) for tables, columns and measures.
Also: the diff of two models and a Markdown data dictionary.
"""

import json
import re
from pathlib import Path


def parse_bim(data):
    m = data.get("model", data)
    tables = [{"name": t.get("name", ""),
               "columns": [{"name": c.get("name", ""), "dataType": c.get("dataType", "")} for c in t.get("columns", [])],
               "measures": [{"name": x.get("name", ""), "expression": _text(x.get("expression")), "formatString": x.get("formatString", "")}
                            for x in t.get("measures", [])]}
              for t in m.get("tables", [])]
    return {"tables": tables, "relationships": list(m.get("relationships", []))}


def _text(expr):
    return "\n".join(expr) if isinstance(expr, list) else (expr or "")


_NAME = r"(?:'((?:[^']|'')+)'|(\S+))"


def _name(m):
    return (m.group(1) or "").replace("''", "'") or m.group(2)


def parse_tmdl_table(text):
    """One TMDL table file: its columns and measures (single- or multi-line expressions); other objects are skipped."""
    table, columns, measures, current = None, [], [], None
    for line in text.splitlines():
        depth = len(line) - len(line.lstrip("\t"))
        body = line.strip()
        if not body:
            continue
        if depth == 0 and (m := re.match(rf"table {_NAME}", body)):
            table, current = _name(m), None
        elif depth == 1 and (m := re.match(rf"measure {_NAME}\s*=\s*(.*)$", body)):
            current = {"name": _name(m), "expression": m.group(3).strip(), "formatString": ""}
            measures.append(current)
        elif depth == 1 and (m := re.match(rf"column {_NAME}", body)):
            current = {"name": _name(m), "dataType": ""}
            columns.append(current)
        elif depth == 1:
            current = None
        elif current is not None and depth >= 2:
            key = re.match(r"(formatString|dataType):\s*(.*)$", body)
            if key and depth == 2:
                current[key.group(1)] = key.group(2)
            elif "expression" in current:
                current["expression"] = (current["expression"] + "\n" + body).strip()
    return {"name": table or "", "columns": columns, "measures": measures}


def load(path):
    """A model.bim file, a *.SemanticModel folder (model.bim or definition/tables/*.tmdl), or a TMDL tables folder."""
    p = Path(path)
    if p.is_file():
        data = json.loads(p.read_text(encoding="utf-8-sig"))
        if not isinstance(data, dict):
            raise ValueError(f"{p}: expected a JSON object")
        return parse_bim(data)
    if (p / "model.bim").is_file():
        return load(p / "model.bim")
    tables_dir = next((d for d in (p / "definition" / "tables", p / "tables", p) if d.is_dir() and any(d.glob("*.tmdl"))), None)
    if tables_dir is None:
        raise FileNotFoundError(f"no model.bim or TMDL tables under {p}")
    return {"tables": [parse_tmdl_table(f.read_text(encoding="utf-8-sig")) for f in sorted(tables_dir.glob("*.tmdl"))],
            "relationships": []}


def _objects(m, kind):
    return {f"{t['name']}[{o['name']}]": o for t in m["tables"] for o in t[kind]}


def diff(old, new):
    out = {}
    for kind, field in (("columns", "dataType"), ("measures", "expression")):
        a, b = _objects(old, kind), _objects(new, kind)
        out[kind] = {"added": sorted(set(b) - set(a)), "removed": sorted(set(a) - set(b)),
                     "changed": sorted(k for k in set(a) & set(b) if a[k].get(field, "").strip() != b[k].get(field, "").strip())}
    ta, tb = {t["name"] for t in old["tables"]}, {t["name"] for t in new["tables"]}
    out["tables"] = {"added": sorted(tb - ta), "removed": sorted(ta - tb)}
    return out


def dictionary(m, title="Data dictionary"):
    rows = ["| Table | Name | Kind | Type or expression |", "| --- | --- | --- | --- |"]
    def one_line(expr):
        return " ".join(expr.split()).replace("|", "\\|")

    for t in m["tables"]:
        rows += [f"| {t['name']} | {c['name']} | column | {c.get('dataType', '')} |" for c in t["columns"]]
        rows += [f"| {t['name']} | {x['name']} | measure | `{one_line(x['expression'])}` |" for x in t["measures"]]
    return f"# {title}\n\n" + "\n".join(rows) + "\n"
