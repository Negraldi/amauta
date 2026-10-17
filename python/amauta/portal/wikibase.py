"""Small helpers shared by the wiki page builders: reference/meta/item constructors, LIKE escaping, title de-duplication."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from .api import columns

LINK_CAP = 20
_FEATURE_PREFIX = re.compile(r"^feature:\s*", re.I)


def _like(text):
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _iso(ts):
    return (ts or "")[:19] + "Z" if ts else ""


def _mtime(path):
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ref(kind, ident, title=None):
    return {"kind": kind, "id": str(ident), "title": str(title if title is not None else ident)}


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _meta(*pairs):
    """[{label, value, fmt?}]: `fmt: "number"` marks real numbers so the UI groups digits (ids and versions stay verbatim)."""
    return [{"label": k, "value": str(v), **({"fmt": "number"} if _is_number(v) else {})} for k, v in pairs if v not in (None, "")]


def _item(label, value=None, kind=None, ident=None):
    out = {"label": str(label), "value": None if value is None else str(value), "kind": kind, "id": None if ident is None else str(ident)}
    if _is_number(value):
        out["fmt"] = "number"
    return out


def _blank(kind, ident, title, body=None):
    return {"kind": kind, "id": str(ident), "title": str(title), "body_md": body, "meta": [], "links": [], "backlinks": [], "sections": [], "missing": []}


def _live(conn):
    return "o.deleted_at IS NULL" if "deleted_at" in columns(conn, "observations") else "1=1"


def strip_title_h1(body, title):
    """Drop a leading `# ` heading that repeats the page title (case-insensitive, ignoring a "Feature:" prefix); the page already shows the title."""
    if not body:
        return body
    m = re.match(r"\s*# +(.+?)[ \t]*(?:\r?\n|$)", body)
    norm = lambda t: re.sub(r"[-_\s]+", " ", _FEATURE_PREFIX.sub("", str(t).strip())).strip().lower()  # noqa: E731
    if m and norm(m.group(1)) == norm(title):
        return body[m.end():].lstrip("\r\n")
    return body
