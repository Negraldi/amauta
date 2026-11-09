"""Field references a PBIR report makes that its semantic model does not have: a renamed or deleted column or measure
leaves visuals, filters and sorts pointing at nothing, and Power BI shows a broken visual. Read-only: it reports, it
never repairs (removing a filter changes what a page shows; that is a decision for the author).

Reads report.json, every page.json and every visual.json. A reference is a `{"Expression": {"SourceRef": {"Entity":
table}}, "Property": name}` node; its place is `filter` under a filterConfig, `sort` under a sortDefinition, otherwise
`field`. A reference by a query alias (`SourceRef.Source`) has no table name and is skipped.
"""

import json
from pathlib import Path

from .layout import _pages

_PLACES = (("filterConfig", "filter"), ("sortDefinition", "sort"))


def _walk(node, place, out):
    if isinstance(node, dict):
        entity = ((node.get("Expression") or {}).get("SourceRef") or {}).get("Entity") if isinstance(node.get("Expression"), dict) else None
        if isinstance(entity, str) and isinstance(node.get("Property"), str):
            out.append((place, entity, node["Property"]))
        for key, value in node.items():
            _walk(value, dict(_PLACES).get(key, place), out)
    elif isinstance(node, list):
        for value in node:
            _walk(value, place, out)
    return out


def _read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def _sources(report):
    """(where, json) for the report, each page and each visual."""
    root = Path(report)
    for f in (root / "definition" / "report.json", root / "report.json"):
        if f.is_file():
            yield "report", _read(f)
            break
    for page in _pages(report):
        meta = _read(page / "page.json")
        name = meta.get("displayName", page.name)
        yield name, meta
        for f in sorted((page / "visuals").glob("*/visual.json")):
            v = _read(f)
            yield f"{name}/{v.get('name', f.parent.name)}", v


def audit(report, m):
    fields = {t["name"]: {o["name"] for o in t["columns"] + t["measures"]} for t in m["tables"]}
    findings, seen = [], set()
    for where, data in _sources(report):
        for place, table, prop in _walk(data, "field", []):
            problem = "no such table" if table not in fields else "no such field" if prop not in fields[table] else None
            key = (where, place, table, prop)
            if problem and key not in seen:
                seen.add(key)
                findings.append({"where": where, "place": place, "ref": f"{table}[{prop}]", "problem": problem})
    return findings
