"""Harness wiki: one page per component of the Claude Code harness (hooks, MCP servers, agents, commands, plugins, output styles and, in
wikitools, built-in tools, MCP tools and connectors), derived on request from the real files. Read-only, bounded, no secrets.

Every entry carries where each fact came from (a file path, "Built into Claude Code" or "Usage only"). Paths are only ever the ones this discovery found:
a request id selects among discovered entries and is never joined into a path. Entries are cached for a couple of seconds, like projects.py.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import time
from pathlib import Path

from . import wikisecret
from .api import NotFound
from .wikibase import _blank, _item, _meta, _ref
from .wikiusage import SKILL_BYTES, parse_frontmatter

TTL = 2.0
MAX_JSON = 8_000_000
MAX_MD = 200
MD_BYTES = 60_000
MAX_PLUGINS = 100
MAX_PLUGIN_DIRS = 5000
MAX_PLUGIN_DEPTH = 6
MAX_HOOKS = 400
MAX_SERVERS = 100
MAX_LINKS = 60
USER_LABEL = "Your Claude home"
BUILTIN_LABEL = "Built into Claude Code"
USAGE_LABEL = "Usage only"
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$")

# kind -> (group label, "What it does" note shown when no description exists). Order is the catalog order.
KINDS = (("hook", "Hooks"), ("mcp", "MCP servers"), ("mcptool", "MCP tools"), ("connector", "Connectors"), ("tool", "Built-in tools"),
         ("agent", "Agents"), ("command", "Commands"), ("plugin", "Plugins"), ("outputstyle", "Output styles"))
NEW_KINDS = tuple(k for k, _ in KINDS if k not in ("mcp", "tool"))

EVENT_WHEN = {
    "SessionStart": "When a session starts, resumes, is cleared or is compacted.",
    "SessionEnd": "When a session ends.",
    "UserPromptSubmit": "Each time you submit a prompt, before Claude sees it.",
    "PreToolUse": "Before Claude runs a tool; it can block or change the call.",
    "PostToolUse": "After a tool call succeeds.",
    "PostToolUseFailure": "After a tool call fails.",
    "PermissionRequest": "When Claude Code asks you for a permission.",
    "Notification": "When Claude Code sends you a notification.",
    "Stop": "When Claude finishes answering.",
    "SubagentStart": "When a subagent starts.",
    "SubagentStop": "When a subagent finishes.",
    "PreCompact": "Before the conversation is compacted.",
    "PostCompact": "After the conversation is compacted.",
}
HOOK_FALLBACK_WHEN = "When Claude Code reaches this hook event."
# Curated summaries of the scripts amauta ships: (substring of the command, short name, what it does).
HOOK_SUMMARIES = (
    ("amauta.telemetry hook", "amauta telemetry", "Records one hook event (event name, tool, project, size) in the local amauta telemetry database. It reads the event on stdin, sends nothing over the network and never blocks Claude."),
    ("amauta.usage hook", "amauta usage", "Imports the finished session's token, tool and skill usage from the Claude Code transcript into the local amauta usage database."),
    ("hook review-stop", "amauta review reminder", "When review mode is on, reminds Claude once per candidate commit to run the amauta review before stopping."),
    ("hook skill-registry", "amauta skill registry", "Refreshes the project's skill registry (.atl/skill-registry.md) when you submit a prompt, so delegated work sees current skills."),
    ("amauta.memory", "amauta memory", "Runs the amauta memory component."),
)
MCP_WHAT = "A Model Context Protocol server: Claude Code starts it or connects to it, and the tools it lists become available to Claude."
MCP_WHEN = "When a session starts, Claude Code connects to every configured server; Claude then calls its tools when a task needs them."
AGENT_WHEN = "When Claude delegates a task to this subagent type, or when you pick it."
COMMAND_WHEN = "When you type this slash command."
STYLE_WHEN = "While this output style is active, for every reply."
PLUGIN_WHAT = "A Claude Code plugin: a bundle that can provide skills, agents, commands, hooks, MCP servers and output styles."


# ---- safe readers -----------------------------------------------------------------------------------------------
def _regular(path: Path) -> bool:
    try:
        st = os.lstat(path)
    except OSError:
        return False
    return stat.S_ISREG(st.st_mode)


def read_json(path: Path) -> dict:
    """A JSON object from a regular (non-symlink) file of bounded size; {} otherwise."""
    try:
        if not _regular(path) or path.stat().st_size > MAX_JSON:
            return {}
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _md_files(folder: Path):
    try:
        names = sorted(n for n in os.listdir(folder) if n.endswith(".md") and NAME.match(n[:-3]))
    except OSError:
        return []
    return [(n[:-3], folder / n) for n in names if _regular(folder / n)][:MAX_MD]


def _read_md(path: Path):
    """(frontmatter, body, truncated) of a markdown component file."""
    try:
        with path.open("rb") as fh:
            raw = fh.read(SKILL_BYTES + 1)
    except OSError:
        return {}, "", False
    front, body = parse_frontmatter(raw[:SKILL_BYTES].decode("utf-8", "replace"))
    return front, body, len(raw) > SKILL_BYTES


def digest(material) -> str:
    """Stable hash of the source material of a component (what an explanation was written from)."""
    return hashlib.sha256(json.dumps(material, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:16]


def _project_label(name):
    return f"Project {name}"


def _plugin_label(name):
    return f"Plugin {name}"


# ---- plugins ------------------------------------------------------------------------------------------------------
def _plugin_dirs(root: Path):
    out, seen = [], 0
    base = len(root.parts)
    for dirpath, dirnames, _ in os.walk(root, followlinks=False):
        seen += 1
        here = Path(dirpath)
        if seen > MAX_PLUGIN_DIRS or len(here.parts) - base > MAX_PLUGIN_DEPTH:
            dirnames[:] = []
            continue
        dirnames[:] = sorted(d for d in dirnames if d not in (".git", "node_modules") and not (here / d).is_symlink())
        if _regular(here / ".claude-plugin" / "plugin.json"):
            out.append(here)
            dirnames[:] = []
        if len(out) >= MAX_PLUGINS:
            break
    return out


def plugins(portal):
    """[{name, dir, manifest, version, enabled}] of installed plugins (the plugin cache), first copy of a name wins."""
    root = portal.cfg.claude_home / "plugins" / "cache"
    enabled = read_json(portal.cfg.claude_home / "settings.json").get("enabledPlugins")
    enabled = enabled if isinstance(enabled, dict) else {}
    out, taken = [], set()
    for d in _plugin_dirs(root) if root.is_dir() and not root.is_symlink() else []:
        manifest = read_json(d / ".claude-plugin" / "plugin.json")
        name = manifest.get("name") if isinstance(manifest.get("name"), str) and NAME.match(manifest.get("name", "")) else d.parent.name
        if name in taken:
            continue
        taken.add(name)
        market = d.relative_to(root).parts[0] if d != root else ""
        flag = next((v for k, v in enabled.items() if isinstance(k, str) and k.split("@")[0] == name and isinstance(v, bool)), None)
        out.append({"name": name, "dir": d, "manifest": manifest, "version": str(manifest.get("version") or "")[:40], "enabled": flag, "market": market})
    return out


# ---- hooks --------------------------------------------------------------------------------------------------------
def _hooks_in(data, source, path, scope):
    hooks = data.get("hooks") if isinstance(data, dict) else None
    out = []
    for event, groups in (hooks.items() if isinstance(hooks, dict) else []):
        for group in groups if isinstance(groups, list) else []:
            if not isinstance(group, dict):
                continue
            matcher = group.get("matcher") if isinstance(group.get("matcher"), str) else ""
            for h in group.get("hooks") if isinstance(group.get("hooks"), list) else []:
                if isinstance(h, dict):
                    out.append({"event": str(event)[:60], "matcher": matcher[:200], "type": str(h.get("type") or "command")[:20], "h": h, "source": source, "path": str(path), "scope": scope})
    return out


def _hook_entry(raw):
    h, event = raw["h"], raw["event"]
    if raw["type"] == "command" or isinstance(h.get("command"), str):
        command = wikisecret.mask_command(h.get("command"))
    elif raw["type"] == "http":
        command = wikisecret.mask_url(h.get("url"))
    else:
        command = str(h.get("prompt") or "")[:300]
    timeout = h.get("timeout") if isinstance(h.get("timeout"), (int, float)) and not isinstance(h.get("timeout"), bool) else None
    known = next(((short, what) for needle, short, what in HOOK_SUMMARIES if needle in command), None)
    short = known[0] if known else (command.split(" ", 1)[0].rsplit("/", 1)[-1] or raw["type"])
    material = {"event": event, "matcher": raw["matcher"], "type": raw["type"], "command": command, "timeout": timeout, "path": raw["path"]}
    ident = f"{event}:{digest(material)[:8]}"
    return {"kind": "hook", "id": ident, "title": f"{event}: {known[0] if known else command[:60] or short}", "description": known[1] if known else None,
            "when": EVENT_WHEN.get(event, HOOK_FALLBACK_WHEN), "source": raw["source"], "path": raw["path"], "material": material,
            "note": None if known else "No curated summary for this command: read the command itself.",
            "meta": _meta(("Event", event), ("Matcher", raw["matcher"] or "(all)"), ("Hook type", raw["type"]), ("Command", command), ("Timeout", f"{timeout:g} s" if timeout is not None else None), ("Scope", raw["scope"])),
            "plugin": raw.get("plugin")}


def _collect_hooks(portal, repos, plugs):
    raws = []
    home = portal.cfg.claude_home
    for name in ("settings.json", "settings.local.json"):
        raws += _hooks_in(read_json(home / name), USER_LABEL, home / name, "user")
    for repo in repos:
        for name in ("settings.json", "settings.local.json"):
            p = Path(repo) / ".claude" / name
            raws += _hooks_in(read_json(p), _project_label(Path(repo).name), p, "project")
    for pl in plugs:
        p = pl["dir"] / "hooks" / "hooks.json"
        raws += [{**r, "plugin": pl["name"]} for r in _hooks_in(read_json(p), _plugin_label(pl["name"]), p, "plugin")]
    out, seen = [], set()
    for raw in raws[:MAX_HOOKS]:
        e = _hook_entry(raw)
        if e["id"] not in seen:
            seen.add(e["id"])
            out.append(e)
    return out


# ---- MCP servers -------------------------------------------------------------------------------------------------
def claude_json_path(portal) -> Path:
    state = read_json(portal.cfg.state_dir / "state.json")
    if isinstance(state.get("claude_json"), str) and state["claude_json"]:
        return Path(state["claude_json"])
    home = portal.cfg.claude_home
    return home.parent / ".claude.json" if home.name == ".claude" else home / ".claude.json"


def _specs(mapping):
    return {str(k)[:100]: v for k, v in mapping.items() if isinstance(v, dict)} if isinstance(mapping, dict) else {}


def raw_servers(portal, repos=None, plugs=None):
    """[(name, source label, scope, path, raw spec)] of every configured MCP server, UNMASKED. For the refresh probe only: never serialize this."""
    repos = portal.repos() if repos is None else repos
    plugs = plugins(portal) if plugs is None else plugs
    out = []
    cj_path = claude_json_path(portal)
    cj = read_json(cj_path)
    for name, spec in _specs(cj.get("mcpServers")).items():
        out.append((name, USER_LABEL, "user", cj_path, spec))
    projects = cj.get("projects") if isinstance(cj.get("projects"), dict) else {}
    for key, entry in list(projects.items())[:200]:
        for name, spec in _specs(entry.get("mcpServers") if isinstance(entry, dict) else None).items():
            out.append((name, _project_label(Path(str(key)).name), "project", cj_path, spec))
    for repo in repos:
        p = Path(repo) / ".mcp.json"
        data = read_json(p)
        for name, spec in _specs(data.get("mcpServers", data)).items():
            out.append((name, _project_label(Path(repo).name), "project", p, spec))
    for pl in plugs:
        for p, data in ((pl["dir"] / ".mcp.json", read_json(pl["dir"] / ".mcp.json")), (pl["dir"] / ".claude-plugin" / "plugin.json", pl["manifest"])):
            mapping = data.get("mcpServers", data if p.name == ".mcp.json" else None)
            for name, spec in _specs(mapping).items():
                out.append((name, _plugin_label(pl["name"]), "plugin", p, spec))
    return out[:MAX_SERVERS * 3]


def server_aliases(name, scope, plugin=None):
    """Names under which Claude Code writes this server's tools: the name itself, its sanitized form and, for plugins, plugin_<plugin>_<name>."""
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", name)
    out = {name, safe}
    if scope == "plugin" and plugin:
        out |= {f"plugin_{plugin}_{name}", f"plugin_{re.sub(r'[^A-Za-z0-9_-]', '_', plugin)}_{safe}"}
    return out


def _collect_servers(portal, repos, plugs):
    plugin_of = lambda label: label[len("Plugin "):] if label.startswith("Plugin ") else None  # noqa: E731
    by_name = {}
    for name, source, scope, path, spec in raw_servers(portal, repos, plugs):
        by_name.setdefault(name, []).append({"source": source, "scope": scope, "path": str(path), "facts": wikisecret.server_facts(spec), "plugin": plugin_of(source)})
    out = []
    for name, configs in sorted(by_name.items())[:MAX_SERVERS]:
        first = configs[0]["facts"]
        aliases = set()
        for c in configs:
            aliases |= server_aliases(name, c["scope"], c["plugin"])
        material = {"name": name, "configs": [{"source": c["source"], "path": c["path"], **c["facts"]} for c in configs]}
        out.append({"kind": "mcp", "id": name, "title": name, "description": MCP_WHAT, "when": MCP_WHEN, "source": configs[0]["source"], "path": configs[0]["path"], "material": material,
                    "configs": configs, "aliases": aliases, "plugin": next((c["plugin"] for c in configs if c["plugin"]), None),
                    "meta": _meta(("Type", first["type"]), ("Command", " ".join(x for x in [first["command"], *first["args"]] if x) or None), ("URL", first["url"]),
                                  ("Environment variables (names only)", ", ".join(first["env_keys"]) or None), ("Header names", ", ".join(first["header_keys"]) or None))})
    return out


# ---- agents, commands, output styles -------------------------------------------------------------------------------
def _md_roots(portal, repos, plugs, sub):
    """[(id prefix, source label, folder, plugin)] in precedence order."""
    roots = [("", USER_LABEL, portal.cfg.claude_home / sub, None)]
    roots += [(f"{Path(r).name}/", _project_label(Path(r).name), Path(r) / ".claude" / sub, None) for r in repos]
    roots += [(f"{pl['name']}:", _plugin_label(pl["name"]), pl["dir"] / sub, pl["name"]) for pl in plugs]
    return roots


def _tool_names(text):
    return [t.strip() for t in re.split(r"[,\s]+", text or "") if t.strip()][:60]


def _collect_md(portal, repos, plugs, sub, kind):
    out, active = [], read_json(portal.cfg.claude_home / "settings.json").get("outputStyle")
    for prefix, source, folder, plugin in _md_roots(portal, repos, plugs, sub):
        if folder.is_symlink():
            continue
        for stem, path in _md_files(folder):
            front, body, truncated = _read_md(path)
            ident = f"{prefix}{stem}"
            name = front.get("name") or stem
            tools = _tool_names(front.get("tools"))
            material = {"kind": kind, "front": front, "body": body[:20000], "path": str(path)}
            meta = [("Model", front.get("model")), ("Tools", ", ".join(tools) if tools else None), ("Scope", "plugin" if plugin else ("project" if prefix else "user")), ("Truncated", "yes" if truncated else None)]
            title, when = ident, {"agent": AGENT_WHEN, "command": COMMAND_WHEN, "outputstyle": STYLE_WHEN}[kind]
            if kind == "command":
                title = "/" + ident
                meta.insert(0, ("Argument hint", front.get("argument-hint")))
            if kind == "outputstyle":
                meta.insert(0, ("Active", "yes" if isinstance(active, str) and active.lower() in (name.lower(), stem.lower()) else "no"))
            out.append({"kind": kind, "id": ident, "title": title, "description": front.get("description") or None, "when": when, "source": source, "path": str(path), "material": material,
                        "body": body, "meta": _meta(*meta), "plugin": plugin, "tools": tools, "active": kind == "outputstyle" and any(m[0] == "Active" and m[1] == "yes" for m in meta)})
    return out


def _collect_plugins(portal, plugs, entries):
    """Plugin entries link to what they provide; `entries` are the already collected components."""
    from . import wikiskills
    skills = [e for e in wikiskills.discover(portal) if e["source"] == "plugin"]
    out = []
    for pl in plugs:
        m = pl["manifest"]
        provides = [(k, e["id"]) for e in entries for k in [e["kind"]] if e.get("plugin") == pl["name"]]
        provides += [("skill", s["id"]) for s in skills if s.get("plugin") == pl["name"]]
        author = m.get("author")
        author = author.get("name") if isinstance(author, dict) else author
        material = {"name": pl["name"], "manifest": {k: m.get(k) for k in ("name", "description", "version", "author", "homepage", "license") if m.get(k) is not None}, "provides": sorted(provides), "path": str(pl["dir"])}
        out.append({"kind": "plugin", "id": pl["name"], "title": pl["name"], "description": str(m.get("description") or "")[:600] or PLUGIN_WHAT, "when": None, "source": _plugin_label(pl["name"]),
                    "path": str(pl["dir"] / ".claude-plugin" / "plugin.json"), "material": material, "provides": provides,
                    "meta": _meta(("Version", pl["version"]), ("Enabled", None if pl["enabled"] is None else ("yes" if pl["enabled"] else "no")), ("Author", str(author)[:100] if isinstance(author, str) else None),
                                  ("Homepage", str(m.get("homepage") or "")[:200] if isinstance(m.get("homepage"), str) else None), ("License", str(m.get("license") or "")[:40] if isinstance(m.get("license"), str) else None))})
    return out


# ---- the index ----------------------------------------------------------------------------------------------------------
def _extra_collectors(portal, base):
    """Hook for wikitools: built-in tools, MCP tools and connectors, which need usage data and the server list."""
    try:
        from . import wikitools
    except ImportError:
        return []
    return wikitools.collect(portal, base)


def index(portal):
    """{(kind, id): entry} for every component, cached for a few seconds."""
    cached = getattr(portal, "_harness_cache", None)
    if cached and time.monotonic() - cached[0] < TTL:
        return cached[1]
    repos = portal.repos()
    plugs = plugins(portal)
    base = []
    base += _collect_hooks(portal, repos, plugs)
    base += _collect_servers(portal, repos, plugs)
    base += _collect_md(portal, repos, plugs, "agents", "agent")
    base += _collect_md(portal, repos, plugs, "commands", "command")
    base += _collect_md(portal, repos, plugs, "output-styles", "outputstyle")
    base += _collect_plugins(portal, plugs, base)
    base += _extra_collectors(portal, base)
    entries = {}
    for e in base:
        entries.setdefault((e["kind"], e["id"]), e)
    for e in entries.values():
        e["links"] = _links(e, entries)
    back = {}
    for e in entries.values():
        for kind, ident in e["links"]:
            back.setdefault((kind, ident), []).append((e["kind"], e["id"]))
    for key, e in entries.items():
        e["backlinks"] = back.get(key, [])
    portal._harness_cache = (time.monotonic(), entries)
    return entries


def forget(portal):
    portal._harness_cache = None


def _links(e, entries):
    out = []
    if e.get("owner"):
        out.append(e["owner"])
    if e["kind"] == "plugin":
        out += e["provides"]
    if e["kind"] == "agent":
        for t in e.get("tools", []):
            out.append(("mcptool", t[5:].replace("__", "/", 1)) if t.startswith("mcp__") and "__" in t[5:] else ("tool", t))
    if e["kind"] in ("mcp", "connector"):
        out += [("mcptool", f"{e['id']}/{t}") for t in e.get("tool_names", [])]
    plugin = e.get("plugin")
    if plugin and e["kind"] != "plugin":
        pass  # the plugin links to its parts; the part reaches the plugin as a backlink
    seen, res = set(), []
    for key in out:
        if key not in seen and (key in entries or key[0] == "skill") and key != (e["kind"], e["id"]):
            seen.add(key)
            res.append(key)
    return res[:MAX_LINKS]


def _ref_of(entries, key):
    if key[0] == "skill":
        return _ref("skill", key[1])
    e = entries.get(key)
    return _ref(key[0], key[1], e["title"]) if e else None


def summary_of(e):
    out = {"description": e.get("description"), "trigger": None, "when": e.get("when"), "source": e["source"], "path": e.get("path"), "builtin": e["source"] == BUILTIN_LABEL, "note": e.get("note")}
    if e.get("i18n"):
        out["i18n"] = e["i18n"]
    return out


def source_section(e):
    """Where each fact came from: one row per config file or source."""
    rows = e.get("configs")
    if rows:
        return {"heading": "Configured in", "items": [_item(c["path"], c["source"]) for c in rows]}
    return {"heading": "Source of these facts", "items": [_item(e.get("path") or e["source"], e["source"])]}


def stdio_config(e):
    """True when the first configuration of a server entry is a local command (the only kind the refresh asks)."""
    first = (e.get("configs") or [{}])[0].get("facts") or {}
    return first.get("type") == "stdio" and bool(first.get("command"))


def page_from(portal, kind, ident):
    entry = index(portal).get((kind, ident))
    if entry is None:
        raise NotFound()
    return build_page(portal, entry)


def build_page(portal, e):
    entries = index(portal)
    pg = _blank(e["kind"], e["id"], e["title"], e.get("body"))
    pg["summary"] = summary_of(e)
    if e["kind"] == "mcp" and stdio_config(e):
        pg["refresh"] = {"server": e["id"]}
    pg["meta"] = e["meta"]
    pg["sections"] = [source_section(e)] + e.get("sections", [])
    pg["links"] = [r for r in (_ref_of(entries, k) for k in e["links"]) if r]
    pg["backlinks"] = [r for r in (_ref_of(entries, k) for k in e["backlinks"]) if r]
    if e.get("usage_col") and e.get("usage_name"):
        _add_usage(portal, pg, e)
    add_explain(portal, pg, e)
    return pg


def add_explain(portal, pg, e):
    from . import wikiexplain  # lazy: wikiexplain imports this module
    if e["kind"] in wikiexplain.ALLOWED:
        pg["explain"] = wikiexplain.page_block(portal, e)


def _add_usage(portal, pg, e):
    """Daily calls and recent sessions for entries that map to a usage column (MCP tools, connectors)."""
    from . import wikiusage  # lazy: wikiusage imports wikibase only, but keeps import order simple
    conn = portal._usage_conn()
    if conn is None:
        return
    try:
        col, name = e["usage_col"], e["usage_name"]
        last = conn.execute(f"SELECT max(c.ts) FROM tool_calls c WHERE {col} = ?", (name,)).fetchone()[0]
        if last is None:
            return
        pg["usage"] = {"daily": wikiusage._daily(conn, col, name, last), "days": wikiusage.DAYS}
        have = {(r["kind"], r["id"]) for r in pg["backlinks"]}
        pg["backlinks"] += [r for r in wikiusage._session_refs(conn, portal, f"{col} = ?", (name,)) if (r["kind"], r["id"]) not in have]
    finally:
        conn.close()


def title_of(kind):
    def title(portal, ident):
        e = index(portal).get((kind, ident))
        return e["title"] if e else None
    return title


def page_builder(kind):
    return lambda portal, ident, q: page_from(portal, kind, ident)


def groups(portal, q=None):
    """The catalog: every component grouped by kind in a fixed order, each with its one-line description and source."""
    entries = index(portal)
    out, total = [], 0
    servers = sum(1 for e in entries.values() if e["kind"] == "mcp" and stdio_config(e))
    for kind, label in KINDS:
        items = [{"kind": kind, "id": e["id"], "title": e["title"], "description": e.get("description"), "source": e["source"], "uses": e.get("uses", 0), **({"i18n": e["i18n"]} if e.get("i18n") else {})}
                 for e in entries.values() if e["kind"] == kind]
        if items:
            items.sort(key=lambda i: (-i["uses"], i["title"].lower()))
            out.append({"kind": kind, "label": label, "items": items})
            total += len(items)
    from . import wikiexplain
    return {"groups": out, "total": total, "refresh": {"servers": servers}, "pending": len(wikiexplain.pending(portal))}


def search(kind):
    def run(portal, text):
        needle = text.lower()
        return [{"kind": kind, "id": e["id"], "title": e["title"], "snippet": (e.get("description") or e["source"])[:160]}
                for e in index(portal).values() if e["kind"] == kind and (needle in e["id"].lower() or needle in e["title"].lower() or needle in (e.get("description") or "").lower())][:50]
    return run


def merged_page(kind, usage_builder):
    """Usage page (when sessions called it) merged with the harness facts (when the component is configured or catalogued)."""
    def build(portal, ident, q):
        entry = index(portal).get((kind, ident))
        try:
            pg = usage_builder(portal, ident, q)
        except NotFound:
            if entry is None:
                raise
            return build_page(portal, entry)
        if kind == "tool" and ident.startswith("mcp__"):
            owner = next((e for e in index(portal).values() if e["kind"] == "mcptool" and e.get("usage_name") == ident), None)
            if owner:
                pg["links"].append(_ref("mcptool", owner["id"], owner["title"]))
        if entry is None:
            return pg
        base = build_page(portal, entry)
        pg["summary"] = base["summary"]
        if "refresh" in base:
            pg["refresh"] = base["refresh"]
        pg["explain"] = base["explain"]
        pg["meta"] = base["meta"] + pg["meta"]
        pg["sections"] = base["sections"] + pg["sections"]
        have = {(r["kind"], r["id"]) for r in pg["links"]}
        pg["links"] += [r for r in base["links"] if (r["kind"], r["id"]) not in have]
        have = {(r["kind"], r["id"]) for r in pg["backlinks"]}
        pg["backlinks"] += [r for r in base["backlinks"] if (r["kind"], r["id"]) not in have]
        return pg
    return build


def merged_title(kind, usage_title):
    def title(portal, ident):
        return usage_title(portal, ident) or title_of(kind)(portal, ident)
    return title


def merged_search(kind, usage_search):
    def run(portal, text):
        rows = usage_search(portal, text)
        have = {r["id"] for r in rows}
        return rows + [r for r in search(kind)(portal, text) if r["id"] not in have]
    return run
