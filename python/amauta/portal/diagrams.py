"""Mermaid source generators for the portal. Everything that comes from disk, a graph or a repository is untrusted:
node ids are generated (`n0`, `n1`, ...), never taken from data, and every label goes through `label()`."""
from __future__ import annotations

import os

import re

MAX_ITEMS = 40  # hooks events, servers and ODD tasks per diagram
MAX_GRAPH_NODES = 30
MAX_GRAPH_EDGES = 30
LABEL_LIMIT = 60

# One pass over the ORIGINAL characters, so an entity we emit is never escaped again and text cannot forge one.
_ENTITIES = {c: f"#{ord(c)};" for c in '#"<>`[](){}|;\\&%'}
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f  ]+")


def label(text, limit: int = LABEL_LIMIT) -> str:
    """A double-quoted Mermaid label: one line, truncated, with every syntax character as an entity code."""
    s = _CONTROL.sub(" ", str(text if text is not None else "")).strip()
    s = re.sub(r" {2,}", " ", s)
    if len(s) > limit:
        s = s[: max(limit - 3, 0)].rstrip() + "..."
    return '"' + "".join(_ENTITIES.get(c, c) for c in s) + '"'


def soft(text, limit: int = LABEL_LIMIT) -> str:
    """Like label() but syntax characters become spaces instead of entity codes (mermaid 11 shows some entity codes literally in subgraph
    titles and shaped nodes), so a backtick or bracket in a task title never garbles the drawing."""
    s = "".join(" " if c in _ENTITIES else c for c in str(text if text is not None else ""))
    return label(s, limit)


class _Builder:
    def __init__(self, direction="LR"):
        self.lines = [f"flowchart {direction}"]
        self.n = 0
        self.classes: dict[str, list[str]] = {}

    def node(self, text, cls=None, limit=LABEL_LIMIT) -> str:
        nid = f"n{self.n}"
        self.n += 1
        self.lines.append(f"  {nid}[{label(text, limit)}]")
        if cls:
            self.classes.setdefault(cls, []).append(nid)
        return nid

    def edge(self, a, b, text=None):
        self.lines.append(f"  {a} -->|{label(text, 30)}| {b}" if text else f"  {a} --> {b}")

    def group(self, title, build):
        """A subgraph: `build()` adds its nodes; returns the subgraph id, which edges may use like a node."""
        gid = f"g{self.n}"
        self.n += 1
        self.lines.append(f"  subgraph {gid}[{label(title)}]")
        build()
        self.lines.append("  end")
        return gid

    def render(self, styles=()) -> str:
        self.lines.extend(f"  {s}" for s in styles)
        for cls, ids in self.classes.items():
            self.lines.append(f"  class {','.join(ids)} {cls}")
        return "\n".join(self.lines)


_STYLE = {  # the light portal tokens (diagrams sit on a white card): accent-soft, sidebar, ink
    "root": "classDef root fill:#dcf4f5,stroke:#007277,color:#161f1f",
    "group": "classDef group fill:#eff5f5,stroke:#d5dcdd,color:#161f1f",
    "done": "classDef done fill:#cdeedd,stroke:#2f9e6f,color:#1d1f23",
    "pending": "classDef pending fill:#ffe3c2,stroke:#d9822b,color:#1d1f23",
    "blocked": "classDef blocked fill:#fbd5d5,stroke:#b42318,stroke-width:3px,stroke-dasharray:4 2,color:#1d1f23",
    "start": "classDef start fill:#dbe7ff,stroke:#2457c5,stroke-width:3px,color:#1d1f23",
}


def _styles(b):
    return [_STYLE[c] for c in b.classes if c in _STYLE]


def _tilde(path) -> str:
    """A path under the home directory written with ~ (shorter in a diagram label)."""
    home, text = os.path.expanduser("~"), str(path)
    return "~" + text[len(home):] if home not in ("", "/") and (text == home or text.startswith(home + os.sep)) else text


SESSION_ORDER = ("SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStop", "Stop")
AMAUTA_SERVERS = ("engram", "amauta-memory", "amauta")


def workflow(hs: dict, state_dir) -> str | None:
    """The harness model as one session flow (plan N12e): the runtime fires hook events in session order, one
    dispatcher per event runs amauta's handlers, they write memory.db, the MCP servers serve the agent, the Stop policy
    may block once more, and the portal only reads. Built from the install state; every label is quoted."""
    if not hs.get("installed"):
        return None
    b = _Builder("LR")
    handlers = {}
    own = 0
    for h in hs.get("hooks") or []:
        if h.get("kind") == "amauta":
            handlers.setdefault(str(h.get("event")), []).extend(str(x) for x in h.get("handlers") or [])
        else:
            own += 1
    events = sorted(handlers, key=lambda e: (SESSION_ORDER.index(e) if e in SESSION_ORDER else len(SESSION_ORDER), e))
    runtime = {}
    b.group("Claude Code · Codex", lambda: runtime.setdefault("id", b.node("one session", "root")))
    ids = []

    def event_nodes():
        for ev in events[:MAX_ITEMS]:
            ids.append(b.node(f"{ev}: {', '.join(handlers[ev])}", limit=90))
        if own:
            ids.append(b.node(f"{own} hook of your own" if own == 1 else f"{own} hooks of your own", "group"))

    hooks_group = b.group("Hook events, in session order", event_nodes)
    if ids:
        b.edge(runtime["id"], ids[0], "fires")
        for a, c in zip(ids, ids[1:]):
            b.edge(a, c)
    kernel = {}

    def kernel_nodes():
        kernel["dispatch"] = b.node("dispatcher: one process per event")
        kernel["policy"] = b.node("Stop policy: one combined block, at most two per turn")
        kernel["db"] = b.node(f"memory.db in {_tilde(state_dir)}", limit=80)

    b.group("amauta kernel", kernel_nodes)
    b.edge(hooks_group, kernel["dispatch"], "runs handlers")
    b.edge(kernel["dispatch"], kernel["db"], "telemetry, usage")
    if "Stop" in handlers:
        b.edge(ids[events.index("Stop")] if events.index("Stop") < len(ids) else hooks_group, kernel["policy"], "may block")
    servers = [s for s in hs.get("mcp_servers") or [] if s.get("name") not in AMAUTA_SERVERS]

    def mcp_nodes():
        kernel["engram"] = b.node("MCP engram: memory")
        kernel["mcp"] = b.node("MCP amauta: skills, review, ODD")
        if servers:
            b.node("other MCP servers: " + ", ".join(str(s.get("name")) for s in servers[:MAX_ITEMS]), "group")

    b.group("MCP servers the agent calls", mcp_nodes)
    b.edge(runtime["id"], kernel["engram"], "stdio")
    b.edge(runtime["id"], kernel["mcp"], "stdio")
    b.edge(kernel["engram"], kernel["db"], "reads, writes")
    portal = b.node(f"Portal: reads only · {int(hs.get('skills') or 0)} skills, {int(hs.get('agents') or 0)} agents", "group")
    b.edge(portal, kernel["db"], "reads")
    return b.render(_styles(b))


def _task_name(title: str) -> str:
    m = re.match(r"\W*([A-Z]{1,3}\d+[a-z]*)\b", title)
    return m.group(1) if m else title


MAX_TASKS = 60  # task nodes drawn per diagram; the rest is one "N more" node
GRID_COLUMNS = 6  # task nodes per row inside a phase
_SHAPES = {"done": "([{}])", "pending": "[{}]", "blocked": "{{{{{}}}}}"}  # stadium, rectangle, hexagon
_WORDS = {"done": "✓ done", "pending": "○ pending", "blocked": "! blocked"}


def _task_status(t: dict) -> str:
    return "done" if t.get("done") else "blocked" if t.get("blocked") else "pending"


def odd_progress(name: str, tasks: list) -> str | None:
    """One feature document as a grid: a summary node, then one subgraph per phase heading (or a single "Tasks" group) with the tasks in rows
    of GRID_COLUMNS. No task is connected to a hub: invisible links only build the rows and stack the groups. Status is carried by node
    shape (stadium = done, rectangle = pending, hexagon = blocked), by a word in the label and by a class, never by color alone."""
    if not tasks:
        return None
    done = sum(1 for t in tasks if t.get("done"))
    blocked = sum(1 for t in tasks if _task_status(t) == "blocked")
    b = _Builder("TB")
    head = f"{name}: {done}/{len(tasks)} done" + (f", {blocked} blocked" if blocked else "")
    b.lines.append(f"  s0([{soft(head, 80)}])")
    b.classes["root"] = ["s0"]
    groups: dict = {}
    for t in tasks[:MAX_TASKS]:
        groups.setdefault(t.get("phase") or None, []).append(t)
    rest = tasks[MAX_TASKS:]
    chain = ["s0"]
    for gi, (phase, items) in enumerate(groups.items()):
        b.lines.append(f"  subgraph p{gi}[{soft(phase or 'Tasks', 70)}]")
        b.lines.append("    direction LR")
        nodes = []
        for t in items:
            st = _task_status(t)
            nid = f"n{b.n}"
            b.n += 1
            text = f"{_task_name(str(t.get('title', '')))[:30]} {_WORDS[st]}"
            b.lines.append(f"    {nid}{_SHAPES[st].format(soft(text, 50))}")
            b.classes.setdefault(st, []).append(nid)
            nodes.append(nid)
        if gi == len(groups) - 1 and rest:
            nid = f"n{b.n}"
            b.n += 1
            more = f"{len(rest)} more tasks ({sum(1 for t in rest if t.get('done'))} done)"
            b.lines.append(f"    {nid}[{label(more, 40)}]")
            b.classes.setdefault("group", []).append(nid)
            nodes.append(nid)
        for r in range(0, len(nodes), GRID_COLUMNS):
            row = nodes[r:r + GRID_COLUMNS]
            if len(row) > 1:
                b.lines.append("    " + " ~~~ ".join(row))
        b.lines.append("  end")
        chain.append(f"p{gi}")
    b.lines.append("  " + " ~~~ ".join(chain))
    return b.render(_styles(b))


def graph_neighborhood(g: dict) -> str | None:
    """Neighbors of a graph node (the `graph_query.neighbors` shape), capped to the nearest nodes and edges between them."""
    nodes = (g.get("nodes") or [])[:MAX_GRAPH_NODES]
    if not nodes:
        return None
    b = _Builder("LR")
    start = set(g.get("start") or [])
    ids = {}
    for n in nodes:
        kind = f" ({n['kind']})" if n.get("kind") else ""
        ids[n["id"]] = b.node(f"{n.get('label') or n['id']}{kind}", "start" if n["id"] in start else None, limit=50)
    drawn = 0
    for e in g.get("edges") or []:
        if drawn >= MAX_GRAPH_EDGES:
            break
        if e.get("src") in ids and e.get("dst") in ids:
            b.edge(ids[e["src"]], ids[e["dst"]], e.get("relation"))
            drawn += 1
    if len(g.get("nodes") or []) > MAX_GRAPH_NODES:
        b.node(f"{len(g['nodes']) - MAX_GRAPH_NODES} more nodes not shown", "group")
    return b.render(_styles(b))
