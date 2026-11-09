"""Cascading rename of a column or measure in a PBIR report: every field reference to `table[old]` in the visuals
(projections, filters, sorts) becomes `table[new]`, with its queryRef and nativeQueryRef. Structural, not text
replacement: titles and other literals that happen to contain the name are left alone. `plan` writes nothing;
`apply` rewrites only the visual.json files that change. Rename the field in the semantic model separately.
"""

import json
import os
import tempfile
from pathlib import Path

from .layout import _pages


def _is_ref(node, table, old):
    if not isinstance(node, dict) or node.get("Property") != old:
        return False
    return ((node.get("Expression") or {}).get("SourceRef") or {}).get("Entity") == table


def _rename(node, table, old, new):
    """Rename in place; returns the number of values changed."""
    n = 0
    if isinstance(node, dict):
        ref = None
        for kind in ("Column", "Measure", "Aggregation", "HierarchyLevel"):
            f = node.get("field", {}).get(kind) if isinstance(node.get("field"), dict) else None
            if _is_ref(f, table, old):
                ref = f
        if _is_ref(node, table, old):
            node["Property"], n = new, n + 1
        if ref is not None:
            if node.get("queryRef") == f"{table}.{old}":
                node["queryRef"], n = f"{table}.{new}", n + 1
            if node.get("nativeQueryRef") == old:
                node["nativeQueryRef"], n = new, n + 1
        for value in node.values():
            n += _rename(value, table, old, new)
    elif isinstance(node, list):
        for value in node:
            n += _rename(value, table, old, new)
    return n


def _visuals(report):
    for page in _pages(report):
        yield from sorted((page / "visuals").glob("*/visual.json"))


def plan(report, table, old, new):
    out = []
    for f in _visuals(report):
        data = json.loads(f.read_text(encoding="utf-8-sig"))
        count = _rename(data, table, old, new)
        if count:
            out.append({"page": f.parent.parent.parent.name, "visual": f.parent.name, "file": str(f), "count": count})
    return out


def apply(report, table, old, new):
    changed = plan(report, table, old, new)
    for c in changed:
        f = Path(c["file"])
        data = json.loads(f.read_text(encoding="utf-8-sig"))
        _rename(data, table, old, new)
        fd, tmp = tempfile.mkstemp(dir=f.parent, prefix=".visual-", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(data, out, indent=2, ensure_ascii=False)
            out.write("\n")
        os.replace(tmp, f)
    return changed
