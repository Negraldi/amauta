"""Harness architecture as an archify diagram. The install state the Harness page already reads becomes typed JSON (grid layout, generated ids,
every label sanitized and capped), is checked here against the structure archify's schema requires, then rendered by the vendored archify CLI
(node, argument list, no shell, temp dir, no network, hard timeout) into one self-contained HTML page that the portal serves from its own
route under a separate, sandboxing CSP. The rendered page is cached in memory by the hash of its input. Without node or the CLI there is no
render and callers fall back to the Mermaid text diagram."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path

MAX_EVENTS = 8
LIFECYCLE = ("SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "SubagentStop", "Stop", "PreCompact", "SessionEnd")
MAX_SERVERS = 8
RENDER_TIMEOUT = 40
MAX_HTML = 8 * 1024 * 1024
CACHE_SIZE = 6
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
ID_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_-]*$")
TYPES = {"frontend", "backend", "database", "cloud", "security", "messagebus", "external"}
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f  ]+")
_CACHE: OrderedDict = OrderedDict()
_LOCK = threading.Lock()


def clean(text, limit: int) -> str:
    """One line of printable text, capped. JSON carries it as data; archify escapes it when drawing."""
    s = re.sub(r"\s+", " ", _CONTROL.sub(" ", str(text if text is not None else ""))).strip()
    return s[: limit - 1].rstrip() + "…" if len(s) > limit else s


def build(hs: dict, stores: list | None = None, boundaries: bool = True) -> dict | None:
    """Architecture IR (schema_version 1, grid layout) from `Portal.harness()` data; None when amauta is not installed."""
    if not hs.get("installed"):
        return None
    by_event: dict[str, dict[str, int]] = {}
    for h in hs.get("hooks") or []:
        kinds = by_event.setdefault(clean(h.get("event"), 40), {})
        k = clean(h.get("kind"), 20)
        kinds[k] = kinds.get(k, 0) + 1
    events = sorted(by_event, key=lambda e: (LIFECYCLE.index(e) if e in LIFECYCLE else len(LIFECYCLE), e))  # lifecycle order, unknown events last
    servers = hs.get("mcp_servers") or []
    shown_e, shown_s = events[:MAX_EVENTS], servers[:MAX_SERVERS]
    n_e = len(shown_e) + (1 if len(events) > MAX_EVENTS else 0)
    n_s = len(shown_s) + (1 if len(servers) > MAX_SERVERS else 0)
    # The hub sits in the middle column; the hook group (row 0) and the server group (row 2) are centered on it so their one line each is straight.
    # Left of the hub: installed assets. Right of it: state stores. Every neighbouring pair on the hub's row is adjacent, so no line crosses a node.
    mid = max(n_e // 2, n_s // 2, 2)
    cols = max(mid + 3, mid + n_e - n_e // 2, mid + n_s - n_s // 2)
    comps, conns, bounds = [], [], []

    def add(kind, label, sub, row, col, tag=None):
        cid = f"c{len(comps)}"
        c = {"id": cid, "type": kind, "label": clean(label, 20) or "-", "row": row, "col": col, "size": [150, 64]}
        if sub:
            c["sublabel"] = clean(sub, 26)
        if tag:
            c["tag"] = clean(tag, 12)
        comps.append(c)
        return cid

    def group(ids, label, kind, anchor, **line):
        """One labelled boundary around `ids` and one line from the hub to the anchor member; without boundaries every member keeps its own line."""
        if not ids:
            return
        targets = [anchor] if boundaries else ids
        for cid in targets:
            conns.append({"id": f"k-{cid}", "from": core, "to": cid, **line})
        bounds.append({"kind": kind, "label": label, "wraps": ids})

    head = " ".join(x for x in ("amauta", clean(hs.get("version"), 16)) if x)
    sub = " · ".join(x for x in (f"persona {clean(hs['persona'], 16)}" if hs.get("persona") else "", f"RDD {clean(hs['rdd_mode'], 12)}" if hs.get("rdd_mode") else "") if x)
    core = add("backend", head, sub, 1, mid)

    hook_ids = []
    start = mid - n_e // 2
    for i, ev in enumerate(shown_e):
        kinds = ", ".join(k if c == 1 else f"{k} x{c}" for k, c in sorted(by_event[ev].items()))
        hook_ids.append(add("messagebus", ev, kinds, 0, start + i, "hook"))
    if len(events) > MAX_EVENTS:
        hook_ids.append(add("messagebus", f"{len(events) - MAX_EVENTS} more events", "", 0, start + len(shown_e)))
    if hook_ids:
        group(hook_ids, "Claude Code hooks (settings.json)", "region", hook_ids[n_e // 2])

    agents = add("frontend", f"{int(hs.get('agents') or 0)} agents", "installed by amauta", 1, mid - 2)
    skills = add("frontend", f"{int(hs.get('skills') or 0)} skills", "installed by amauta", 1, mid - 1)
    group([agents, skills], "installed assets", "region", skills, fromSide="left")

    store_ids = [add("database", st.get("label"), st.get("detail"), 1, mid + 1 + j) for j, st in enumerate((stores or [])[:2])]
    if store_ids:
        group(store_ids, "state dir", "security-group", store_ids[0], variant="dashed")

    srv_ids = []
    start = mid - n_s // 2
    for i, s in enumerate(shown_s):
        srv_ids.append(add("external", s.get("name"), s.get("type"), 2, start + i, "MCP"))
    if len(servers) > MAX_SERVERS:
        srv_ids.append(add("external", f"{len(servers) - MAX_SERVERS} more servers", "", 2, start + len(shown_s)))
    if srv_ids:
        group(srv_ids, "MCP servers (.claude.json)", "region", srv_ids[n_s // 2])

    for c in conns:
        for k in [k for k, v in c.items() if v is None]:
            del c[k]
    ir = {"schema_version": 1, "diagram_type": "architecture",
          "meta": {"title": "amauta harness", "output": "harness.html", "quality_profile": "standard"},
          "layout": {"mode": "grid", "cols": cols, "cellW": 170, "gapX": 40, "gapY": 90}, "components": comps, "boundaries": bounds if boundaries else [], "connections": conns}
    return ir


def check(ir) -> list[str]:
    """Structural problems against what architecture.schema.json requires (stdlib subset: required keys, id pattern, enums, references)."""
    errs = []
    if not isinstance(ir, dict):
        return ["not an object"]
    if ir.get("schema_version") != 1 or ir.get("diagram_type") != "architecture":
        errs.append("schema_version/diagram_type")
    meta = ir.get("meta")
    if not isinstance(meta, dict) or not meta.get("title") or not isinstance(meta.get("output"), str) or not meta["output"].endswith(".html"):
        errs.append("meta")
    comps = ir.get("components")
    if not isinstance(comps, list) or not comps:
        return errs + ["components"]
    ids = set()
    for c in comps:
        if not isinstance(c, dict) or not ID_RE.match(str(c.get("id", ""))) or c.get("id") in ids:
            errs.append(f"component id {c.get('id') if isinstance(c, dict) else c!r}")
            continue
        ids.add(c["id"])
        if c.get("type") not in TYPES:
            errs.append(f"{c['id']}: type")
        if not isinstance(c.get("label"), str) or not c["label"]:
            errs.append(f"{c['id']}: label")
        if "row" in c and not (isinstance(c["row"], int) and c["row"] >= 0 and isinstance(c.get("col"), int) and c["col"] >= 0):
            errs.append(f"{c['id']}: row/col")
    for b in ir.get("boundaries") or []:
        if b.get("kind") not in ("region", "security-group") or not b.get("label") or not b.get("wraps") or not set(b["wraps"]) <= ids:
            errs.append(f"boundary {b.get('label')!r}")
    for c in ir.get("connections") or []:
        if c.get("from") not in ids or c.get("to") not in ids:
            errs.append(f"connection {c.get('id')!r}")
    return errs


def input_hash(ir) -> str:
    return hashlib.sha256(json.dumps(ir, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def find_cli(*roots) -> Path | None:
    """The archify CLI: the repository's vendored copy first, then the installed skill of each given Claude home."""
    repo = Path(__file__).resolve().parents[3] / "assets" / "skills" / "archify" / "bin" / "archify.mjs"
    for p in (repo, *(Path(r) / "skills" / "archify" / "bin" / "archify.mjs" for r in roots if r)):
        if p.is_file():
            return p
    return None


def _run(node, cli, args, cwd):
    env = {"PATH": os.environ.get("PATH", ""), "HOME": str(cwd), "ARCHIFY_UPDATE_CHECK_DISABLED": "1"}
    return subprocess.run([node, str(cli), *args], cwd=cwd, env=env, capture_output=True, text=True, timeout=RENDER_TIMEOUT, stdin=subprocess.DEVNULL)


def _why(proc) -> str:
    """The first lines of archify's own error (its --json `error` field, else stderr), capped."""
    try:
        text = json.loads(proc.stdout).get("error") or ""
    except (ValueError, AttributeError):
        text = ""
    return clean(text or proc.stderr or proc.stdout, 240)


def render(ir, cli, node=None) -> tuple[str | None, str]:
    """(hash, "") on success with the page cached, or (None, reason). Never raises."""
    key = input_hash(ir)
    with _LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return key, ""
    problems = check(ir)
    if problems:
        return None, "invalid diagram: " + "; ".join(problems[:3])
    node = node or shutil.which("node")
    if not node or cli is None:
        return None, "node or the archify CLI is not available"
    try:
        with tempfile.TemporaryDirectory(prefix="amauta-archify-") as tmp:
            src, out = Path(tmp, "in.json"), Path(tmp, "out.html")
            src.write_text(json.dumps(ir))
            v = _run(node, cli, ["validate", "architecture", "in.json", "--json"], tmp)
            if v.returncode != 0:
                return None, "archify validation failed: " + _why(v)
            r = _run(node, cli, ["render", "architecture", "in.json", "out.html"], tmp)
            if r.returncode != 0 or not out.is_file():
                return None, "archify render failed: " + _why(r)
            if out.stat().st_size > MAX_HTML:
                return None, "rendered page too large"
            html = out.read_bytes()
    except (OSError, subprocess.SubprocessError) as e:
        return None, f"archify could not run: {type(e).__name__}"
    with _LOCK:
        _CACHE[key] = html
        while len(_CACHE) > CACHE_SIZE:
            _CACHE.popitem(last=False)
    return key, ""


def cached(key) -> bytes | None:
    if not isinstance(key, str) or not HASH_RE.match(key):
        return None
    with _LOCK:
        return _CACHE.get(key)
