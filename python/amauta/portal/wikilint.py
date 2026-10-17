"""Wiki lint: conservative, capped checks that point at pages worth a second look. Nothing here asserts a fault: duplicate and superseded
candidates are labelled "review". Read-only; memories come from the own store, never the engram database."""
from __future__ import annotations

import bisect
import difflib
import re
from datetime import datetime, timedelta, timezone

from .api import _int, has_table
from . import wiki, wikiexplain, wikifeature, wikiharness, wikimem, wikiusage
from .wikibase import _live, _ref

SCAN_CAP = 1500        # memories examined
CONTENT_CAP = 20000    # characters of one memory examined
ITEM_CAP = 50          # items listed per category
MEMBER_CAP = 6
BUCKET_CAP = 30
NEAR_RATIO = 0.95
SUPERSEDE_RATIO = 0.7
MIN_TITLE = 8
MENTION_HITS = 20
ID_LIMIT = 8

_NORM = re.compile(r"[^a-z0-9]+")
_TASK_ID = re.compile(r"^([A-Za-z]{1,3}\d+[a-z]?)\b")
_RANGE = re.compile(r"\b([A-Za-z]{1,3})(\d+)\s*[-–]\s*(?:\1)?(\d+)\b")
_DONE = re.compile(r"^- \[[xX]\] (.+)$")


def _norm(title):
    return _NORM.sub(" ", (title or "").lower()).strip()


def _category(cid, title, note, items, count=None):
    count = len(items) if count is None else count
    return {"id": cid, "title": title, "note": note, "count": count, "items": items[:ITEM_CAP], "truncated": count > ITEM_CAP}


def _mem_item(row, detail, **extra):
    return {"kind": "memory", "id": str(row["id"]), "title": row["title"] or f"#{row['id']}", "detail": detail, **extra}


def _load(conn):
    if conn is None or not has_table(conn, "observations"):
        return [], False
    rows = conn.execute(f"SELECT o.id, o.title, o.type, o.project, o.topic_key, o.content, o.updated_at FROM observations o WHERE {_live(conn)} "
                        f"ORDER BY o.updated_at DESC, o.id DESC LIMIT {SCAN_CAP + 1}").fetchall()
    out = [{**dict(r), "content": (r["content"] or "")[:CONTENT_CAP]} for r in rows[:SCAN_CAP]]
    return out, len(rows) > SCAN_CAP


class _Resolver:
    """Which page a [[wikilink]] points at, using the scanned memories for memory targets and the wiki's own existence checks for the rest."""

    def __init__(self, portal, rows, capped=False):
        self.portal, self.cache, self.capped = portal, {}, capped
        self.by_id = {str(r["id"]): r["id"] for r in rows}
        self.by_topic, self.by_title = {}, {}
        for r in rows:  # rows are newest first: keep the first (newest) hit
            if r["topic_key"]:
                self.by_topic.setdefault(r["topic_key"], r["id"])
            self.by_title.setdefault((r["title"] or "").lower(), r["id"])

    def find(self, kind, ident):
        """Memory id for a memory target, True for another existing page, None when missing."""
        if kind == "memory":
            hit = self.by_id.get(ident) or self.by_topic.get(ident) or self.by_title.get(ident.lower())
            if hit or not self.capped:
                return hit  # when the scan was capped, a miss may be an older memory: ask the store
        key = (kind, ident)
        if key not in self.cache:
            try:
                self.cache[key] = bool(wiki._TITLES[kind](self.portal, ident))
            except Exception:  # a failing existence check must not break the whole page
                self.cache[key] = False
        return True if self.cache[key] else None


# ---- orphans --------------------------------------------------------------------------------------------------
def _connections(rows, resolver):
    """Ids of memories with at least one wiki connection: a resolved wikilink either way, the topic hierarchy, or a plain-text mention."""
    linked = set()

    def join(a, b):
        if a != b:
            linked.update((a, b))

    for r in rows:
        for kind, ident, _ in wiki._parse_wikilinks(r["content"]):
            hit = resolver.find(kind, ident)
            if hit is True:
                linked.add(r["id"])
            elif hit:
                join(r["id"], hit)
    by_topic, by_parent = {}, {}
    for r in rows:
        t = r["topic_key"]
        if t:
            by_topic.setdefault((r["project"], t), []).append(r["id"])
            if "/" in t:
                by_parent.setdefault((r["project"], t.rsplit("/", 1)[0]), []).append((t, r["id"]))
    for r in rows:
        parts = (r["topic_key"] or "").split("/")
        for n in range(1, len(parts)):
            for other in by_topic.get((r["project"], "/".join(parts[:n])), ()):
                join(r["id"], other)
    for (_, parent), members in by_parent.items():
        direct = [i for t, i in members if "/" not in t[len(parent) + 1:]]
        for i in direct[1:]:
            join(direct[0], i)
    _mention_links(rows, join)
    return linked


def _mention_links(rows, join):
    """Whole-word mentions of another memory's topic_key or title (>= 12 chars); one substring search per needle over the joined corpus."""
    corpus, starts, pos = [], [], 0
    for r in rows:
        starts.append(pos)
        text = r["content"].lower()
        corpus.append(text)
        pos += len(text) + 1
    blob = "\x00".join(corpus)
    for r in rows:
        pairs = []
        if r["topic_key"] and len(r["topic_key"]) >= wikimem.MIN_MENTION:
            pairs.append((r["topic_key"].lower(), wikimem._key_pattern(r["topic_key"])))
        title = (r["title"] or "").strip()
        if len(title) >= wikimem.MIN_MENTION:
            pairs.append((title.lower(), wikimem._title_pattern(title)))
        for needle, pattern in pairs:
            at, hits = blob.find(needle), 0
            while at != -1 and hits < MENTION_HITS:
                i = bisect.bisect_right(starts, at) - 1
                other = rows[i]
                if other["id"] != r["id"] and pattern.search(other["content"]):
                    join(r["id"], other["id"])
                hits += 1
                at = blob.find(needle, at + 1)


def _orphans(rows, resolver):
    linked = _connections(rows, resolver)
    items = [_mem_item(r, "No links to or from other pages") for r in rows if r["id"] not in linked]
    return _category("orphans", "Orphan memories",
                     "No wikilinks, topic neighbours or mentions connect these to another page (links to sessions or graph nodes are not counted). Not a fault: link them or leave them.", items)


# ---- duplicates and superseded notes ---------------------------------------------------------------------------
def _digits(text):
    return re.findall(r"\d+", text)


def _duplicates(rows):
    parent = {r["id"]: r["id"] for r in rows}

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    exact, buckets = {}, {}
    for r in rows:
        n = _norm(r["title"])
        if len(n) < MIN_TITLE:
            continue
        exact.setdefault((r["project"], n), []).append(r)
        buckets.setdefault((r["project"], n[:10]), []).append((n, r))
    for members in exact.values():
        for r in members[1:]:
            if not (r["topic_key"] and r["topic_key"] == members[0]["topic_key"]):
                parent[root(r["id"])] = root(members[0]["id"])
    for members in buckets.values():
        members = members[:BUCKET_CAP]
        for a in range(len(members)):
            for b in range(a + 1, len(members)):
                (na, ra), (nb, rb) = members[a], members[b]
                if na != nb and abs(len(na) - len(nb)) <= 3 and _digits(na) == _digits(nb) and difflib.SequenceMatcher(None, na, nb).ratio() >= NEAR_RATIO:
                    parent[root(ra["id"])] = root(rb["id"])
    groups = {}
    for r in rows:
        groups.setdefault(root(r["id"]), []).append(r)
    items = []
    for members in groups.values():
        keys = {m["topic_key"] or f"#{m['id']}" for m in members}
        if len(members) < 2 or len(keys) < 2:
            continue  # one topic_key is one topic, not a duplicate
        first = members[0]
        items.append(_mem_item(first, f"{len(members)} notes with the same or near-identical title under different topic keys: review whether they should be merged",
                               members=[{"kind": "memory", "id": str(m["id"]), "title": m["title"] or f"#{m['id']}", "topic_key": m["topic_key"]} for m in members[:MEMBER_CAP]]))
    return _category("duplicates", "Possible duplicates",
                     "Same title (ignoring case and punctuation) saved under different topic keys. A candidate list to review, not a claim that either note is wrong.", items)


def _superseded(rows):
    groups = {}
    for r in rows:
        if r["topic_key"] and "/" in r["topic_key"]:
            groups.setdefault((r["project"], r["type"], r["topic_key"].rsplit("/", 1)[0]), []).append(r)
    items = []
    for members in groups.values():
        members = sorted(members, key=lambda m: (m["updated_at"] or "", m["id"]), reverse=True)[:BUCKET_CAP]
        for i, old in enumerate(members):
            for new in members[:i]:
                if (new["updated_at"] or "") > (old["updated_at"] or "") and new["topic_key"] != old["topic_key"] \
                        and difflib.SequenceMatcher(None, _norm(old["title"]), _norm(new["title"])).ratio() >= SUPERSEDE_RATIO:
                    items.append(_mem_item(old, f"A newer note under the same topic prefix may replace it: #{new['id']} \"{(new['title'] or '')[:80]}\" ({new['topic_key']}). Review, not a verdict."))
                    break
    return _category("superseded", "Possibly superseded notes",
                     "Same type and topic prefix, a similar title and a newer save. The older note might be outdated: review it.", items)


# ---- installed skills never used -----------------------------------------------------------------------------------
def _unused_skills(portal, days):
    note = f"Installed skills with no load in the last {days} days. A skill can be right but rarely needed: this is a prompt to review, not to delete."
    root = portal.cfg.claude_home / "skills"
    try:
        names = sorted(p.name for p in root.iterdir() if wikiusage.SKILL_NAME.match(p.name) and (p / "SKILL.md").is_file())
    except OSError:
        names = []
    conn = portal._usage_conn()
    if conn is None or not names:
        return _category("unused_skills", "Installed skills never used", note + " (no usage data to compare against)" if names else note, [])
    since = (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()
    try:
        used = {r[0] for r in conn.execute("SELECT DISTINCT skill FROM tool_calls WHERE skill IS NOT NULL AND substr(ts, 1, 10) >= ?", (since,))}
    finally:
        conn.close()
    items = [{**_ref("skill", n), "detail": f"Installed, not loaded in the last {days} days"} for n in names if n not in used]
    return _category("unused_skills", "Installed skills never used", note, items)


# ---- ODD features: checked tasks without commit evidence ------------------------------------------------------------
def _range_ids(line):
    out = set()
    for m in _RANGE.finditer(line):
        lo, hi = int(m.group(2)), int(m.group(3))
        if lo <= hi <= lo + 50:
            out.update(f"{m.group(1)}{n}" for n in range(lo, hi + 1))
    return out


def _unevidenced(text):
    """(checked_count, [labels]) of checked tasks whose line, or another line naming their id, carries a commit hash."""
    lines = text.splitlines()
    checked, missing = 0, []
    for i, line in enumerate(lines):
        m = _DONE.match(line.rstrip())
        if not m:
            continue
        checked += 1
        if wikifeature.extract_hashes(line):
            continue
        tid = (_TASK_ID.match(m.group(1)) or [None, None])[1]
        found = False
        if tid:
            word = re.compile(r"(?<![\w])" + re.escape(tid) + r"(?![\w])")
            for j, other in enumerate(lines):
                if j != i and wikifeature.extract_hashes(other) and (word.search(other) or tid in _range_ids(other)):
                    found = True
                    break
        if not found:
            missing.append(tid or m.group(1)[:40])
    return checked, missing


def _features(portal):
    items = []
    for repo, f in wiki._feature_docs(portal):
        try:
            text = f.read_text(errors="replace")[:wiki.MAX_TEXT]
        except OSError:
            continue
        checked, missing = _unevidenced(text)
        if missing:
            shown = ", ".join(missing[:ID_LIMIT]) + (f" and {len(missing) - ID_LIMIT} more" if len(missing) > ID_LIMIT else "")
            items.append({**_ref("feature", f.stem), "detail": f"{len(missing)} of {checked} checked tasks have no commit hash in their evidence: {shown}"})
    return _category("features_no_commits", "ODD tasks checked without a commit",
                     "Checked tasks whose line (or a progress line naming the task id) shows no commit hash. Some tasks legitimately have none (design, inline work).", items)


# ---- wikilinks to missing pages --------------------------------------------------------------------------------------
def _target(kind, ident):
    return ident if kind == "memory" else f"{kind}:{ident}"


def _missing_links(portal, rows, resolver):
    sources = [("memory", str(r["id"]), r["title"] or f"#{r['id']}", r["content"]) for r in rows]
    for repo, f in wiki._feature_docs(portal):
        try:
            sources.append(("feature", f.stem, f.stem, f.read_text(errors="replace")[:wiki.MAX_TEXT]))
        except OSError:
            continue
    items = []
    for kind, ident, title, text in sources:
        gone = [_target(k, i) for k, i, _ in wiki._parse_wikilinks(text) if not resolver.find(k, i)]
        if gone:
            more = f" and {len(gone) - 5} more" if len(gone) > 5 else ""
            items.append({"kind": kind, "id": ident, "title": title, "detail": "Links to missing pages: " + ", ".join(f"[[{g}]]" for g in gone[:5]) + more})
    return _category("missing_links", "Wikilinks to missing pages",
                     "A [[link]] whose target is not a memory, skill, tool, MCP server, session, ODD feature or graph node. The renderer shows these as plain muted text.", items)


# ---- explanation notes whose component changed -----------------------------------------------------------------------
STALE_NOTE = "The component changed after this explanation was written: request a new one."
GONE_NOTE = "The component no longer exists: the note can be deleted."


def _stale_notes(portal):
    index = wikiharness.index(portal)
    items = []
    for n in wikiexplain.notes(portal):
        e = index.get((n["kind"], n["id"]))
        if e is None:
            items.append({"kind": n["kind"], "id": n["id"], "title": n["id"], "detail": GONE_NOTE})
        elif wikiharness.digest(e["material"]) != n["source_hash"]:
            items.append({**_ref(n["kind"], n["id"], e["title"]), "detail": STALE_NOTE})
    return _category("stale_notes", "Stale explanations",
                     "Explanations written for a harness component from its files. Flagged when the component changed afterwards or no longer exists: ask for a new one or delete the note.", items)


# ---- entry point -------------------------------------------------------------------------------------------------
def lint(portal, q):
    days = _int(q, "days", 30, 1, 3650)
    source, conn = portal._memory_conn({})
    try:
        rows, capped = _load(conn)
    finally:
        if conn is not None:
            conn.close()
    resolver = _Resolver(portal, rows, capped)
    cats = [_orphans(rows, resolver), _duplicates(rows), _superseded(rows), _unused_skills(portal, days), _features(portal), _missing_links(portal, rows, resolver), _stale_notes(portal)]
    return {"window_days": days, "scanned": {"memories": len(rows), "capped": capped}, "categories": cats}
