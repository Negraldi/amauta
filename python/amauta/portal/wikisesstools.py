"""The tool sections of a session page: what the session called, readable (T15 W3 A5). Case variants of one tool are one row,
placeholder names are one labelled row, and MCP tools are grouped by server instead of listed with their raw `mcp__server__tool` names."""
from __future__ import annotations

from .wikibase import LINK_CAP, _item, _ref

PLACEHOLDER = "Placeholder entries (not tool calls)"
_ROWS = 400


def _calls(n) -> str:
    return "1 call" if n == 1 else f"{n} calls"


def _plain_tools(rows):
    """[(name, n)] -> items: 'Bash' and 'bash' merge under the most used spelling; *_placeholder names are one row."""
    best: dict = {}  # lower-case name -> [spelling, its count, total]
    placeholders = 0
    for name, n in rows:
        if name.lower().endswith("_placeholder"):
            placeholders += n
            continue
        slot = best.setdefault(name.lower(), [name, n, 0])
        if n > slot[1]:
            slot[0], slot[1] = name, n
        slot[2] += n
    items = [(spelling, total) for spelling, _, total in best.values()]
    if placeholders:
        items.append((PLACEHOLDER, placeholders))
    return sorted(items, key=lambda x: (-x[1], x[0]))


def tool_sections(conn, session_id):
    """(sections, links): Tools, MCP tools, MCP servers, Skills and Subagent types of one session."""
    sections, links = [], []

    def query(col, cond):
        sql = f"SELECT {col} name, count(*) n FROM tool_calls c WHERE c.session_id = ? AND {cond} GROUP BY name ORDER BY n DESC, name"
        sql += f" LIMIT {_ROWS}"
        return conn.execute(sql, (session_id,)).fetchall()

    skills = query("c.skill", "c.skill IS NOT NULL")
    if skills:
        sections.append({"heading": "Skills", "items": [_item(r["name"], _calls(r["n"]), "skill", r["name"]) for r in skills]})
        links += [_ref("skill", r["name"]) for r in skills][:LINK_CAP]
    tools = query("c.tool", "1=1")
    plain = _plain_tools([(r["name"], r["n"]) for r in tools if not r["name"].startswith("mcp__")])
    if plain:
        sections.append({"heading": "Tools", "items": [_item(n, _calls(c), *(() if n == PLACEHOLDER else ("tool", n))) for n, c in plain]})
    mcp = sorted(((r["name"][5:].split("__", 1), r["n"]) for r in tools if r["name"].startswith("mcp__") and "__" in r["name"][5:]),
                 key=lambda x: (x[0][0], -x[1], x[0][1]))
    if mcp:
        sections.append({"heading": "MCP tools", "items": [_item(f"{s} / {t}", _calls(n), "mcptool", f"{s}/{t}") for (s, t), n in mcp]})
    servers = query("c.mcp_server", "c.mcp_server IS NOT NULL")
    if servers:
        sections.append({"heading": "MCP servers", "items": [_item(r["name"], _calls(r["n"]), "mcp", r["name"]) for r in servers]})
        links += [_ref("mcp", r["name"]) for r in servers][:LINK_CAP]
    agents = query("c.subagent_type", "c.subagent_type IS NOT NULL")
    if agents:
        sections.append({"heading": "Subagent types", "items": [_item(r["name"], _calls(r["n"])) for r in agents]})
    return sections, links
