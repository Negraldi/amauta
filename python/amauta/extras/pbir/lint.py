"""DAX and model rules as review prompts (warnings, never errors): a static pattern cannot prove a measure wrong.

DAX001 division without DIVIDE (not a division by a numeric constant, which cannot be zero); DAX002 CALCULATE inside
an iterator (context transition is sometimes required: check behavior before changing it); DAX003 FILTER(ALL(...))
where a filter argument may do; MOD001 bidirectional relationship; MOD002 many-to-many relationship; MOD003 a column
whose name suggests personal data (cedula, email, phone ...).
"""

import re

from ...privacy.columns import name_categories

PERSONAL = {"cedula", "ruc", "passport", "dni", "person_name", "email", "phone", "address", "account", "card"}
# A '/' that is not a comment and not followed by a numeric constant ("/ 100" is never a division by zero).
_DIVISION = re.compile(r"(?<![/*])/(?![/*])(?!\s*\d+(?:\.\d+)?(?![\w.\[]))")
_ITERATOR_CALCULATE = re.compile(r"\b(SUMX|AVERAGEX|MINX|MAXX|COUNTX|RANKX|FILTER)\s*\((?:[^()]|\([^()]*\))*\bCALCULATE\s*\(", re.I)
_FILTER_ALL = re.compile(r"\bFILTER\s*\(\s*ALL\s*\(", re.I)
_COMMENTS = re.compile(r"//[^\n]*|/\*.*?\*/|\"(?:[^\"]|\"\")*\"", re.S)


def _w(rule, obj, message):
    return {"rule": rule, "severity": "warning", "object": obj, "message": message}


def lint(m):
    out = []
    for t in m["tables"]:
        for x in t["measures"]:
            obj, expr = f"{t['name']}[{x['name']}]", _COMMENTS.sub("", x["expression"])
            if _DIVISION.search(expr):
                out.append(_w("DAX001", obj, "division with '/': DIVIDE() returns BLANK instead of an error on zero"))
            if _ITERATOR_CALCULATE.search(expr):
                out.append(_w("DAX002", obj, "CALCULATE inside an iterator causes a context transition per row; keep it only if intended"))
            if _FILTER_ALL.search(expr):
                out.append(_w("DAX003", obj, "FILTER(ALL(...)) scans the whole table; a CALCULATE filter argument may do"))
        for c in t["columns"]:
            if name_categories(c["name"]) & PERSONAL:
                msg = "the name suggests personal data: hide it, mask it or keep it out of the model"
                out.append(_w("MOD003", f"{t['name']}[{c['name']}]", msg))
    for r in m["relationships"]:
        obj = f"{r.get('fromTable')}[{r.get('fromColumn')}] -> {r.get('toTable')}[{r.get('toColumn')}]"
        if r.get("crossFilteringBehavior") == "bothDirections":
            out.append(_w("MOD001", obj, "bidirectional filtering can make totals ambiguous; prefer single direction"))
        if r.get("fromCardinality") == "many" and r.get("toCardinality") == "many":
            out.append(_w("MOD002", obj, "many-to-many relationship: check the grain on both sides"))
    return out
