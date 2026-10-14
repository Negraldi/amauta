"""Hand-rolled MCP server (newline-delimited JSON-RPC 2.0 over stdio) with engram-compatible tools.

Deliberately simpler than engram: no conflict detection or judgment machinery.
"""
from __future__ import annotations

import json
import sys

from .. import __version__
from . import store as mstore

SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"]

_S = {"type": "string"}
_I = {"type": "integer"}


def _tool(name, description, properties, required=()):
    return {
        "name": name,
        "description": description,
        "inputSchema": {"type": "object", "properties": properties, "required": list(required)},
    }


TOOLS = [
    _tool("mem_save", "Save an observation (decision, bugfix, discovery, convention). Same project+scope+topic_key updates the existing one.",
          {"title": _S, "content": _S, "type": _S, "topic_key": _S, "scope": _S, "project": _S, "session_id": _S}, ["title", "content"]),
    _tool("mem_update", "Update fields of an observation by id.",
          {"id": _I, "title": _S, "content": _S, "type": _S, "topic_key": _S}, ["id"]),
    _tool("mem_search", "Full-text search over saved observations.",
          {"query": _S, "project": _S, "type": _S, "limit": _I}, ["query"]),
    _tool("mem_context", "Recent observations and session summaries for a project.", {"project": _S, "limit": _I}),
    _tool("mem_get_observation", "Full content of one observation by id.", {"id": _I}, ["id"]),
    _tool("mem_session_start", "Register a session.", {"id": _S, "project": _S, "directory": _S}, ["id"]),
    _tool("mem_session_end", "Mark a session as ended, optionally with a summary.", {"id": _S, "summary": _S}, ["id"]),
    _tool("mem_session_summary", "Save the end-of-session summary.", {"content": _S, "project": _S, "session_id": _S}, ["content"]),
    _tool("mem_save_prompt", "Save a user prompt for later context.", {"content": _S, "project": _S, "session_id": _S}, ["content"]),
    _tool("graph_query", "Query the graphify code graph mirrored in memory.db (repo must have been synced). action: neighbors (node, depth), path (node -> target), search (node = text).",
          {"repo": _S, "action": _S, "node": _S, "target": _S, "depth": _I}, ["repo", "action"]),
    _tool("mem_current_project", "Detect the current project name from a directory (default: server cwd).", {"cwd": _S}),
]
_BY_NAME = {t["name"]: t for t in TOOLS}


class ToolError(Exception):
    pass


def _check(tool, args):
    if not isinstance(args, dict):
        raise ToolError("arguments must be an object")
    schema = tool["inputSchema"]
    for key in schema["required"]:
        if args.get(key) in (None, ""):
            raise ToolError(f"{key} is required")
    kinds = {"string": str, "integer": int}
    for key, spec in schema["properties"].items():
        value = args.get(key)
        if value is not None and (not isinstance(value, kinds[spec["type"]]) or isinstance(value, bool)):
            raise ToolError(f"{key} must be a {spec['type']}")
    return args


def _line(o, snippet=None):
    tail = f" [{o['topic_key']}]" if o.get("topic_key") else ""
    base = f"#{o['id']} ({o.get('type', '?')}) {o['title']}{tail} - {o.get('updated_at', '')}"
    return f"{base}\n    {snippet}" if snippet else base


def _run(store, name, a):
    if name == "mem_save":
        r = store.save(a["title"], a["content"], a.get("type") or "note", a.get("topic_key"),
                       a.get("scope") or "project", a.get("project"), a.get("session_id"))
        return f"Saved #{r['id']}" if r["action"] == "created" else f"Observation #{r['id']} updated (revision {r['revision']})"
    if name == "mem_update":
        try:
            r = store.update(a["id"], a.get("title"), a.get("content"), a.get("type"), a.get("topic_key"))
        except KeyError as e:
            raise ToolError(str(e.args[0])) from None
        return f"Observation #{r['id']} updated (revision {r['revision']})"
    if name == "mem_search":
        hits = store.search(a["query"], a.get("project"), a.get("type"), a.get("limit") or 10)
        if not hits:
            return "No results."
        return "\n".join(_line(h, " ".join((h["snippet"] or "").split())) for h in hits)
    if name == "mem_context":
        c = store.context(a.get("project"), a.get("limit") or 20)
        parts = [f"Project: {c['project']}"]
        if c["sessions"]:
            parts.append("Recent session summaries:")
            parts += [f"- {s['started_at']} {s['id']}: {' '.join((s['summary'] or '').split())[:300]}" for s in c["sessions"]]
        parts.append("Recent observations:" if c["observations"] else "No observations yet.")
        parts += [_line(o, " ".join(o["snippet"].split()) if o["type"] == "session_summary" else None) for o in c["observations"]]
        return "\n".join(parts)
    if name == "mem_get_observation":
        o = store.get(a["id"])
        if o is None:
            raise ToolError(f"observation {a['id']} not found")
        head = f"#{o['id']} ({o['type']}, {o['project']}, scope {o['scope']}) {o['title']}\n"
        meta = f"topic_key: {o['topic_key'] or '-'} | revision {o['revision']} | created {o['created_at']} | updated {o['updated_at']}\n\n"
        return head + meta + o["content"]
    if name == "mem_session_start":
        r = store.session_start(a["id"], a.get("project"), a.get("directory"))
        return f"Session {r['id']} started (project {r['project']})"
    if name == "mem_session_end":
        store.session_end(a["id"], a.get("summary"))
        return f"Session {a['id']} ended"
    if name == "mem_session_summary":
        r = store.session_summary(a["content"], a.get("project"), a.get("session_id"))
        return f"Session summary saved as #{r['id']}"
    if name == "mem_save_prompt":
        r = store.save_prompt(a["content"], a.get("project"), a.get("session_id"))
        return f"Prompt saved (#{r['id']})"
    if name == "mem_current_project":
        return mstore.detect_project(a.get("cwd"))
    if name == "graph_query":
        return _graph(store, a)
    raise ToolError(f"unhandled tool {name}")


def _graph(store, a):
    from ..graph import query  # lazy: only graph users pay for the import

    action, node = a["action"], a.get("node")
    if action not in ("neighbors", "path", "search") or (action != "search" and not node) or (action == "path" and not a.get("target")):
        raise ToolError("action must be neighbors (needs node), path (needs node and target) or search")
    try:
        if action == "neighbors":
            out = query.neighbors(store.conn, a["repo"], node, a.get("depth") or 1)
        elif action == "path":
            out = query.path(store.conn, a["repo"], node, a["target"])
        else:
            out = query.search_nodes(store.conn, a["repo"], node or "")
    except query.QueryError as e:
        raise ToolError(str(e)) from None
    return json.dumps(out, ensure_ascii=False)


def _result(i, msg):
    return {"jsonrpc": "2.0", "id": i, "result": msg}


def _error(i, code, message):
    return {"jsonrpc": "2.0", "id": i, "error": {"code": code, "message": message}}


def handle(store, msg):
    """Return the JSON-RPC response for one request, or None for notifications."""
    if not isinstance(msg, dict) or not isinstance(msg.get("method"), str):
        return _error(msg.get("id") if isinstance(msg, dict) else None, -32600, "invalid request")
    i, method, params = msg.get("id"), msg["method"], msg.get("params") or {}
    if "id" not in msg:
        return None
    if method == "initialize":
        wanted = params.get("protocolVersion")
        return _result(i, {
            "protocolVersion": wanted if wanted in SUPPORTED else SUPPORTED[0],
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "gentle-lite-memory", "version": __version__},
        })
    if method == "ping":
        return _result(i, {})
    if method == "tools/list":
        return _result(i, {"tools": TOOLS})
    if method == "tools/call":
        tool = _BY_NAME.get(params.get("name"))
        if tool is None:
            return _error(i, -32602, f"unknown tool: {params.get('name')}")
        try:
            text = _run(store, tool["name"], _check(tool, params.get("arguments", {})))
            return _result(i, {"content": [{"type": "text", "text": text}]})
        except ToolError as e:
            return _result(i, {"isError": True, "content": [{"type": "text", "text": str(e)}]})
        except Exception as e:  # keep the server alive on unexpected failures
            return _result(i, {"isError": True, "content": [{"type": "text", "text": f"error: {e}"}]})
    return _error(i, -32601, f"method not found: {method}")


def serve(store, stdin=None, stdout=None):
    stdin, stdout = stdin or sys.stdin, stdout or sys.stdout
    for line in stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            reply = _error(None, -32700, "parse error")
        else:
            reply = handle(store, msg)
        if reply is not None:
            stdout.write(json.dumps(reply, ensure_ascii=False) + "\n")
            stdout.flush()
