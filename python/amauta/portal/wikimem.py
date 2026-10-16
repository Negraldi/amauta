"""Memory page extras that the store does not record and the wiki therefore derives: revision history (when a revisions table exists), the topic_key
hierarchy, plain-text mentions of other memories, and graph nodes named in the text. Everything is capped; names that are too short never match."""
from __future__ import annotations

import difflib
import re

from .api import columns, has_table
from .wikibase import LINK_CAP, _live, _like, _ref

HISTORY_TABLES = ("observation_revisions", "observation_versions", "observation_history")
REVISIONS_SHOWN = 50
DIFFS_SHOWN = 10
DIFF_LINES = 200
DIFF_INPUT_LINES = 2000
LINE_CHARS = 300
CONTEXT = 2
MIN_MENTION = 12
MENTION_CAP = 10
CANDIDATES = 3000
MIN_LABEL = 6
LABELS = 5000
NODE_CAP = 8
SCAN_CHARS = 20000
NOTE = "This store keeps the latest revision only: saving the same topic_key again overwrites the previous text, so there is no earlier text to list or compare."


# ---- revision history -------------------------------------------------------------------------------------------
def _clip(lines):
    return [ln[:LINE_CHARS] for ln in lines[:DIFF_INPUT_LINES]]


def line_diff(old, new):
    """[{op, text}] with op ' ' (context), '-', '+' or '=' (a gap of unchanged lines); unchanged runs are folded to CONTEXT lines on each side."""
    a, b = _clip(str(old).splitlines()), _clip(str(new).splitlines())
    out = []
    ops = difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()
    for n, (tag, i1, i2, j1, j2) in enumerate(ops):
        if tag == "equal":
            seg = a[i1:i2]
            head = 0 if n == 0 else CONTEXT
            tail = 0 if n == len(ops) - 1 else CONTEXT
            if len(seg) > head + tail + 1:
                out += [{"op": " ", "text": t} for t in seg[:head]]
                out.append({"op": "=", "text": f"{len(seg) - head - tail} unchanged lines"})
                out += [{"op": " ", "text": t} for t in seg[len(seg) - tail:]]
            else:
                out += [{"op": " ", "text": t} for t in seg]
        else:
            out += [{"op": "-", "text": t} for t in a[i1:i2]] + [{"op": "+", "text": t} for t in b[j1:j2]]
    return out[:DIFF_LINES]


def _history_table(conn):
    for name in HISTORY_TABLES:
        if has_table(conn, name) and {"observation_id", "content"} <= set(columns(conn, name)):
            return name
    return None


def history(conn, d):
    table = _history_table(conn)
    if table is None:
        return {"available": False, "note": NOTE, "revisions": [], "diffs": []}
    cols = set(columns(conn, table))
    when = "created_at" if "created_at" in cols else ("updated_at" if "updated_at" in cols else None)
    title = "title" if "title" in cols else None
    rows = conn.execute(f'SELECT {title or "NULL"} AS title, content, {when or "NULL"} AS at FROM "{table}" WHERE observation_id = ? ORDER BY rowid DESC LIMIT 500', (d["id"],)).fetchall()[::-1]
    base = max(0, conn.execute(f'SELECT count(*) FROM "{table}" WHERE observation_id = ?', (d["id"],)).fetchone()[0] - len(rows))
    revs = [{"revision": base + i + 1, "title": r["title"], "updated_at": r["at"]} for i, r in enumerate(rows)]
    pairs = [(revs[i]["revision"], revs[i + 1]["revision"], rows[i]["content"] or "", rows[i + 1]["content"] or "") for i in range(len(rows) - 1)]
    if rows:
        pairs.append((revs[-1]["revision"], "current", rows[-1]["content"] or "", d.get("content") or ""))
    diffs = [{"from": f, "to": t, "lines": line_diff(a, b)} for f, t, a, b in pairs[-DIFFS_SHOWN:]]
    return {"available": True, "note": f"{len(rows)} earlier revision(s) are stored for this memory.", "revisions": revs[-REVISIONS_SHOWN:], "diffs": diffs}


# ---- topic hierarchy ----------------------------------------------------------------------------------------------
def _project_filter(d):
    return (" AND o.project = ?", [d["project"]]) if d.get("project") else ("", [])


def hierarchy(conn, d):
    """(parents, children): the nearest existing ancestor topic (a/b for a/b/c) and the topics below this one."""
    topic = d.get("topic_key")
    if not topic:
        return [], []
    cond, extra = _project_filter(d)
    live = _live(conn)
    parents = []
    parts = topic.split("/")
    for n in range(len(parts) - 1, 0, -1):
        row = conn.execute(f"SELECT o.id, o.title FROM observations o WHERE o.topic_key = ? AND o.id != ? AND {live}{cond} ORDER BY o.updated_at DESC, o.id DESC LIMIT 1", ["/".join(parts[:n]), d["id"], *extra]).fetchone()
        if row:
            parents = [_ref("memory", row["id"], row["title"])]
            break
    rows = conn.execute(f"SELECT o.id, o.title FROM observations o WHERE o.topic_key LIKE ? ESCAPE '\\' AND o.id != ? AND {live}{cond} ORDER BY o.topic_key LIMIT {LINK_CAP}", [_like(topic + "/"), d["id"], *extra]).fetchall()
    return parents, [_ref("memory", r["id"], r["title"]) for r in rows]


def siblings(conn, d):
    """Direct siblings: topics that share the parent prefix and add exactly one segment."""
    topic = d.get("topic_key")
    if not topic or "/" not in topic:
        return []
    prefix = topic.rsplit("/", 1)[0] + "/"
    cond, extra = _project_filter(d)
    rows = conn.execute(f"SELECT o.id, o.title, o.topic_key FROM observations o WHERE o.topic_key LIKE ? ESCAPE '\\' AND o.id != ? AND {_live(conn)}{cond} ORDER BY o.topic_key LIMIT 200", [_like(prefix), d["id"], *extra]).fetchall()
    return [_ref("memory", r["id"], r["title"]) for r in rows if "/" not in r["topic_key"][len(prefix):]][:LINK_CAP]


# ---- plain-text mentions ------------------------------------------------------------------------------------------
def _key_pattern(key):
    return re.compile(r"(?<![\w/.-])" + re.escape(key) + r"(?![\w/-])")


def _title_pattern(title):
    return re.compile(r"(?<!\w)" + re.escape(title) + r"(?!\w)", re.I)


def _patterns(title, key):
    out = []
    if key and len(key) >= MIN_MENTION:
        out.append(_key_pattern(key))
    if title and len(title.strip()) >= MIN_MENTION:
        out.append(_title_pattern(title.strip()))
    return out


def mentions(conn, d):
    """(mentioned, mentioned_by): other memories whose topic_key or title (>= 12 chars, whole words) occurs in this text, and the reverse."""
    live = _live(conn)
    text = d.get("content") or ""
    out_refs, seen = [], set()
    for r in conn.execute(f"SELECT o.id, o.title, o.topic_key FROM observations o WHERE o.id != ? AND {live} ORDER BY o.updated_at DESC LIMIT {CANDIDATES}", (d["id"],)):
        if len(out_refs) >= MENTION_CAP:
            break
        if r["id"] in seen or (r["title"] or "").strip().lower() == (d.get("title") or "").strip().lower():
            continue
        if any(p.search(text) for p in _patterns(r["title"], r["topic_key"])):
            seen.add(r["id"])
            out_refs.append(_ref("memory", r["id"], r["title"]))
    mine = _patterns(d.get("title"), d.get("topic_key"))
    back = []
    needles = [n for n in (d.get("topic_key"), (d.get("title") or "").strip()) if n and len(n) >= MIN_MENTION]
    if needles:
        cond = " OR ".join("o.content LIKE ? ESCAPE '\\'" for _ in needles)
        for r in conn.execute(f"SELECT o.id, o.title, o.content FROM observations o WHERE ({cond}) AND o.id != ? AND {live} ORDER BY o.updated_at DESC LIMIT 200", [*(_like(n) for n in needles), d["id"]]):
            if len(back) >= MENTION_CAP:
                break
            if any(p.search(r["content"] or "") for p in mine):
                back.append(_ref("memory", r["id"], r["title"]))
    return out_refs, back


# ---- graph nodes named in the text --------------------------------------------------------------------------------
_TOKEN = re.compile(r"\w[\w.]*\w|\w")
_SINGLE = re.compile(r"^\w[\w.]*\w$")


def related_nodes(portal, text):
    """Graph nodes (of the configured repos) whose label occurs in `text` as a whole word, case-sensitive, longest labels first."""
    conn = portal._graph_conn()
    if conn is None:
        return []
    names = {str(r.resolve()): r.name for r in portal.cfg.repos}
    try:
        rows = conn.execute("SELECT repo, id, label FROM graph_nodes WHERE length(label) >= ? ORDER BY length(label) DESC LIMIT ?", (MIN_LABEL, LABELS)).fetchall()
    finally:
        conn.close()
    scan = (text or "")[:SCAN_CHARS]
    tokens = set(_TOKEN.findall(scan))
    out, seen = [], set()
    for r in rows:
        label = r["label"]
        if r["repo"] not in names or label in seen:
            continue
        hit = label in tokens if _SINGLE.match(label) else (label in scan and re.search(r"(?<!\w)" + re.escape(label) + r"(?!\w)", scan))
        if hit:
            seen.add(label)
            out.append(_ref("node", f"{names[r['repo']]}::{r['id']}", label))
            if len(out) >= NODE_CAP:
                break
    return out
