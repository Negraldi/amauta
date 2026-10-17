"""Wiki pages for skills, tools, MCP servers and sessions, built from the usage tables (and, for skills, the installed SKILL.md)."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from . import wikisess
from .api import NotFound, columns, has_table
from .wikibase import LINK_CAP, _blank, _item, _live, _meta, _ref, strip_title_h1

USAGE_COLUMN = {"skill": "c.skill", "tool": "c.tool", "mcp": "c.mcp_server"}
SKILL_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
SKILL_BYTES = 100_000
FRONT_KEYS = 12
FRONT_VALUE = 300
DAYS = 30


# ---- session labels -----------------------------------------------------------------------------------------------
def session_label(conn, portal, session_id):
    r = conn.execute("SELECT count(*) n, max(u.project) project, max(u.model) model, min(u.ts) first_ts FROM usage_messages u WHERE u.session_id = ?", (session_id,)).fetchone()
    return wikisess.label(portal, session_id, r["project"], r["model"], r["n"], r["first_ts"])


def session_title(portal, session_id):
    """The session's label, or None when the usage tables do not know it."""
    conn = portal._usage_conn()
    if conn is None:
        return None
    try:
        return session_label(conn, portal, session_id) if conn.execute("SELECT 1 FROM usage_messages WHERE session_id = ? LIMIT 1", (session_id,)).fetchone() else None
    finally:
        conn.close()


def _session_refs(conn, portal, where, args):
    rows = conn.execute(f"SELECT c.session_id, max(c.ts) last_ts FROM tool_calls c WHERE {where} GROUP BY c.session_id ORDER BY last_ts DESC LIMIT {LINK_CAP}", args).fetchall()
    return [_ref("session", r["session_id"], session_label(conn, portal, r["session_id"])) for r in rows]


# ---- installed SKILL.md -------------------------------------------------------------------------------------------
def parse_frontmatter(text):
    """({key: value}, body). Only a leading `---` block that is closed counts; values may be quoted or folded onto indented lines."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, text
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return {}, text
    meta, key = {}, None
    for raw in lines[1:end]:
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", raw)
        if m and not raw.startswith((" ", "\t")):
            key, val = m.group(1), m.group(2).strip()
            meta[key] = "" if val in (">", "|", ">-", "|-") else val
        elif key and raw.strip():
            meta[key] = (meta[key] + " " + raw.strip()).strip()
    clean = {}
    for k, v in list(meta.items())[:FRONT_KEYS]:
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        clean[k] = v[:FRONT_VALUE]
    return clean, "\n".join(lines[end + 1:]).lstrip("\n")


# ---- usage numbers ------------------------------------------------------------------------------------------------
def _daily(conn, col, ident, last_ts):
    try:
        end = datetime.strptime((last_ts or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        end = datetime.now(timezone.utc).date()
    days = [(end - timedelta(days=i)).isoformat() for i in range(DAYS - 1, -1, -1)]
    counts = {r["day"]: r["n"] for r in conn.execute(
        f"SELECT substr(c.ts, 1, 10) day, count(*) n FROM tool_calls c WHERE {col} = ? AND substr(c.ts, 1, 10) BETWEEN ? AND ? GROUP BY day", (ident, days[0], days[-1]))}
    return [{"day": d, "value": counts.get(d, 0)} for d in days]


def _token_items(conn, col, ident):
    cw = "u.cache_write_5m + u.cache_write_1h"
    r = conn.execute(
        f"SELECT coalesce(sum(u.input),0) input, coalesce(sum(u.output),0) output, coalesce(sum(u.cache_read),0) cache_read, coalesce(sum({cw}),0) cache_write "
        f"FROM usage_messages u WHERE u.session_id IN (SELECT DISTINCT c.session_id FROM tool_calls c WHERE {col} = ?)", (ident,)).fetchone()
    return [_item("Input", r["input"]), _item("Output", r["output"]), _item("Cache read", r["cache_read"]), _item("Cache write", r["cache_write"]),
            _item("Whole-session totals, not caused by this entry")]


def _calling_output(conn, col, ident):
    return conn.execute(f"SELECT coalesce(sum(u.output), 0) FROM usage_messages u WHERE u.message_id IN (SELECT c.message_id FROM tool_calls c WHERE {col} = ?)", (ident,)).fetchone()[0]


BUILTIN_NOTE = "Built into Claude Code (no local file); description unavailable locally."


def _skill_summary(entry):
    """"What it does": description, trigger, source and path of the skill file; built-ins have no file and say so."""
    from . import wikiskills
    if entry is None:
        return {"description": None, "trigger": None, "source": "Built into Claude Code", "path": None, "builtin": True, "note": BUILTIN_NOTE}
    return {"description": entry["description"], "trigger": entry["trigger"], "source": wikiskills.label(entry), "path": entry["path"], "builtin": False, "note": None}


# ---- skill / tool / mcp page --------------------------------------------------------------------------------------
def usage_page(kind):
    col = USAGE_COLUMN[kind]

    def build(portal, ident, q):
        from . import wikiskills  # lazy: wikiskills imports this module for parse_frontmatter
        skill = wikiskills.read(portal, ident) if kind == "skill" else None
        conn = portal._usage_conn()
        try:
            t = conn.execute(f"SELECT count(*) n, count(DISTINCT c.session_id) sessions, min(c.ts) first_ts, max(c.ts) last_ts FROM tool_calls c WHERE {col} = ?", (ident,)).fetchone() if conn is not None else None
            used = bool(t and t["n"])
            if not used and skill is None:
                raise NotFound()
            pg = _blank(kind, ident, ident)
            entry, front, body, truncated = skill if skill else (None, {}, None, False)
            if kind == "skill":
                pg["summary"] = _skill_summary(entry)
            front = {k: v for k, v in front.items() if k not in ("name", "description")}  # the summary block already shows both
            pg["meta"] = _meta(*([("Source", wikiskills.label(entry) if entry else "Built into Claude Code")] if kind == "skill" else []), ("Calls", t["n"] if used else 0), ("Sessions", t["sessions"] if used else 0),
                               ("First used", t["first_ts"] if used else None), ("Last used", t["last_ts"] if used else None),
                               ("Output tokens of the calling messages", _calling_output(conn, col, ident) if used else None), *front.items(), ("Truncated", "yes" if truncated else None))
            if skill:
                pg["body_md"] = strip_title_h1(body, entry["name"])
            if used:
                pg["usage"] = {"daily": _daily(conn, col, ident, t["last_ts"]), "days": DAYS}
                pg["backlinks"] = _session_refs(conn, portal, f"{col} = ?", (ident,))
                pg["sections"].append({"heading": "Tokens in the sessions that used it", "items": _token_items(conn, col, ident)})
            else:
                pg["usage"] = {"daily": [], "days": DAYS}
            if used and kind == "mcp":
                tools = conn.execute("SELECT c.tool name, count(*) n FROM tool_calls c WHERE c.mcp_server = ? GROUP BY c.tool ORDER BY n DESC, name LIMIT 100", (ident,)).fetchall()
                pg["links"] = [_ref("tool", r["name"]) for r in tools]
                pg["sections"].insert(0, {"heading": "Tools of this server", "items": [_item(r["name"], f"{r['n']} calls", "tool", r["name"]) for r in tools]})
            if used and kind == "tool":
                server = conn.execute("SELECT c.mcp_server FROM tool_calls c WHERE c.tool = ? AND c.mcp_server IS NOT NULL LIMIT 1", (ident,)).fetchone()
                if server:
                    pg["links"] = [_ref("mcp", server[0])]
            if kind == "skill":
                from . import skillhist  # lazy: skillhist imports this module for SKILL_NAME
                pg["impact"] = skillhist.block(portal, ident)
            return pg
        finally:
            if conn is not None:
                conn.close()
    return build


def usage_title(kind):
    col = USAGE_COLUMN[kind]

    def title(portal, ident):
        from . import wikiskills
        if kind == "skill" and wikiskills.find(portal, ident) is not None:
            return ident
        conn = portal._usage_conn()
        if conn is None:
            return None
        try:
            return ident if conn.execute(f"SELECT 1 FROM tool_calls c WHERE {col} = ? LIMIT 1", (ident,)).fetchone() else None
        finally:
            conn.close()
    return title


# ---- session page -------------------------------------------------------------------------------------------------
def session_memories(portal, session_id):
    """Memories saved during this session (the hooks use the same session id)."""
    source, conn = portal._memory_conn({})
    if conn is None:
        return []
    try:
        if not has_table(conn, "observations") or "session_id" not in columns(conn, "observations"):
            return []
        rows = conn.execute(f"SELECT o.id, o.title FROM observations o WHERE o.session_id = ? AND {_live(conn)} ORDER BY o.updated_at DESC LIMIT {LINK_CAP}", (session_id,)).fetchall()
        return [_ref("memory", r["id"], r["title"]) for r in rows]
    finally:
        conn.close()


def session_page(portal, ident, q):
    conn = portal._usage_conn()
    if conn is None:
        raise NotFound()
    try:
        cw = "u.cache_write_5m + u.cache_write_1h"
        t = conn.execute(
            f"SELECT count(*) messages, max(u.project) project, min(u.ts) first_ts, max(u.ts) last_ts, max(u.model) model, sum(u.input) input, sum(u.output) output, "
            f"sum(u.cache_read) cache_read, sum({cw}) cache_write FROM usage_messages u WHERE u.session_id = ?", (ident,)).fetchone()
        if not t["messages"]:
            raise NotFound()
        info = wikisess.session_info(portal, ident)
        pg = _blank("session", ident, wikisess.label(portal, ident, t["project"], t["model"], t["messages"], t["first_ts"]))
        models = conn.execute("SELECT coalesce(u.model, 'unknown') model, count(*) n FROM usage_messages u WHERE u.session_id = ? GROUP BY model ORDER BY n DESC, model LIMIT 10", (ident,)).fetchall()
        pg["meta"] = _meta(("Project", t["project"]), ("Repository", wikisess.repo_name(info.get("cwd")) or None), ("Working directory", info.get("cwd")),
                           ("Started", t["first_ts"]), ("Ended", t["last_ts"]), ("Messages", t["messages"]), ("Models", ", ".join(f"{r['model']} ({r['n']})" for r in models)),
                           ("Input tokens", t["input"]), ("Output tokens", t["output"]), ("Cache read tokens", t["cache_read"]), ("Cache write tokens", t["cache_write"]))
        for heading, kind, col, cond in (("Skills", "skill", "c.skill", "c.skill IS NOT NULL"), ("Tools", "tool", "c.tool", "1=1"),
                                         ("MCP servers", "mcp", "c.mcp_server", "c.mcp_server IS NOT NULL"), ("Subagent types", None, "c.subagent_type", "c.subagent_type IS NOT NULL")):
            rows = conn.execute(f"SELECT {col} name, count(*) n FROM tool_calls c WHERE c.session_id = ? AND {cond} GROUP BY name ORDER BY n DESC, name LIMIT 100", (ident,)).fetchall()
            if rows:
                pg["sections"].append({"heading": heading, "items": [_item(r["name"], f"{r['n']} calls", kind, r["name"] if kind else None) for r in rows]})
                if kind in ("skill", "mcp"):
                    pg["links"] += [_ref(kind, r["name"]) for r in rows][:LINK_CAP]
        saved = session_memories(portal, ident)
        if saved:
            pg["sections"].append({"heading": "Memories saved in this session", "items": [_item(r["title"], None, "memory", r["id"]) for r in saved]})
            pg["links"] += saved
        return pg
    finally:
        conn.close()
