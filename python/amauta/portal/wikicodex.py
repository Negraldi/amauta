"""Harness wiki, Codex side: read-only discovery of what the installer writes for Codex (src/install/codex.js) and the
runtime marker of every catalog entry ("claude", "codex" or both).

Sources: `<codex home>/config.toml` `[mcp_servers.*]` tables (names and the same non-secret facts as the Claude side:
command, masked args, env and header NAMES, never a value), `<codex home>/hooks.json` (same schema as settings.json),
the amauta marker blocks of `AGENTS.md` and the skill directories of the Codex skills dir. The Codex home is the one
the portal was given (Config.codex_home) or the installer's rule for it (settingstargets.codex_targets), so a sandboxed
portal never reads the real ~/.codex. No Codex home directory: nothing is added and every entry is Claude Code's.
"""
from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

from .settingstargets import codex_targets

CODEX_LABEL = "Your Codex home"
CLAUDE_ONLY = ("agent", "command", "plugin", "outputstyle")
NAMES = {"claude": "Claude Code", "codex": "Codex"}
CLAUDE_ONLY_TEXT = "Claude Code (Codex has no equivalent)"
MAX_TOML = 1_000_000
MAX_SKILLS = 500
_OPEN = re.compile(r"^<!-- amauta:(\S+) -->$")
_RUNTIME_FLAG = re.compile(r"\s--runtime codex(?=\s|$)")


def targets(portal):
    """(codex home, codex skills dir) or None. The skills dir an install recorded wins when it was for this home."""
    found = codex_targets(portal.cfg)
    if found is None:
        return None
    home, skills = found
    try:
        state = json.loads((portal.cfg.state_dir / "codex-state.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = None
    if isinstance(state, dict) and state.get("codex_home") == str(home) and isinstance(state.get("codex_skills_dir"), str):
        skills = Path(state["codex_skills_dir"])
    return home, skills


def toml_servers(home: Path) -> dict:
    """{name: spec} from the `[mcp_servers.*]` tables, as raw dicts (never serialized: callers keep only server_facts)."""
    try:
        with (home / "config.toml").open("rb") as fh:
            data = tomllib.loads(fh.read(MAX_TOML).decode("utf-8", "replace"))
    except (OSError, tomllib.TOMLDecodeError):
        return {}
    servers = data.get("mcp_servers")
    return {str(k)[:100]: v for k, v in servers.items() if isinstance(v, dict)} if isinstance(servers, dict) else {}


def claude_shaped(spec: dict) -> dict:
    """A Codex server table in the shape wikisecret.server_facts reads (Codex names its headers `http_headers`)."""
    return {"command": spec.get("command"), "args": spec.get("args"), "env": spec.get("env"), "url": spec.get("url"),
            "headers": spec.get("http_headers")}


def blocks(path: Path) -> list:
    """Ids of the amauta marker blocks of an instruction file that have both markers, in file order."""
    try:
        lines = [x.strip() for x in path.read_text(encoding="utf-8", errors="replace").splitlines()]
    except OSError:
        return []
    out = []
    for i, line in enumerate(lines):
        m = _OPEN.match(line)
        if m and m.group(1) not in out and f"<!-- /amauta:{m.group(1)} -->" in lines[i + 1:]:
            out.append(m.group(1))
    return out


def skill_names(folder) -> set:
    """Names of the children of a skills dir that hold a SKILL.md (links included: the Codex dir is mostly links)."""
    try:
        return {d.name for d in sorted(Path(folder).iterdir())[:MAX_SKILLS] if (d / "SKILL.md").is_file()}
    except OSError:
        return set()


def _hook_count(data) -> int:
    hooks = data.get("hooks") if isinstance(data, dict) else None
    groups = [g for v in (hooks.values() if isinstance(hooks, dict) else []) if isinstance(v, list) for g in v if isinstance(g, dict)]
    return sum(len(g["hooks"]) for g in groups if isinstance(g.get("hooks"), list))


def overview(portal) -> dict:
    """Install state per runtime for the Harness overview: blocks, hooks, MCP servers and skills, as counts and ids."""
    from .wikiharness import claude_json_path, read_json
    home, state_dir = portal.cfg.claude_home, portal.cfg.state_dir
    claude_state = read_json(state_dir / "state.json")
    claude = {"found": home.is_dir(), "home": str(home), "installed": bool(claude_state), "version": claude_state.get("version"),
              "blocks": blocks(home / "CLAUDE.md"), "hooks": _hook_count(read_json(home / "settings.json")),
              "mcp_servers": len(read_json(claude_json_path(portal)).get("mcpServers") or {}), "skills": len(skill_names(home / "skills"))}
    found = targets(portal)
    if found is None:
        return {"claude": claude, "codex": {"found": False}}
    chome, skills = found
    cstate = read_json(state_dir / "codex-state.json")
    codex = {"found": True, "home": str(chome), "skills_dir": str(skills), "installed": bool(cstate), "version": cstate.get("version"),
             "blocks": blocks(chome / "AGENTS.md"), "hooks": _hook_count(read_json(chome / "hooks.json")),
             "mcp_servers": len(toml_servers(chome)), "skills": len(skill_names(skills))}
    return {"claude": claude, "codex": codex}


def _hook_key(e):
    m = e["material"]
    return (m["event"], m["matcher"], m["type"], _RUNTIME_FLAG.sub("", m["command"] or ""))


def _merge_hooks(portal, home, base):
    from . import wikiharness as wh
    path = home / "hooks.json"
    claude = {_hook_key(e): e for e in base if e["kind"] == "hook" and e.get("plugin") is None}
    out = []
    for raw in wh._hooks_in(wh.read_json(path), CODEX_LABEL, path, "user")[:wh.MAX_HOOKS]:
        e = wh._hook_entry(raw)
        twin = claude.get(_hook_key(e))
        if twin is not None:
            twin["runtimes"] = ["claude", "codex"]
            rows = twin.setdefault("configs", [{"source": twin["source"], "path": twin["path"]}])
            rows.append({"source": CODEX_LABEL, "path": str(path)})
        elif all(x["id"] != e["id"] for x in out):
            out.append({**e, "runtimes": ["codex"]})
    return out


def _merge_servers(home, base):
    from . import wikiharness as wh
    from . import wikisecret
    path = str(home / "config.toml")
    by_id = {e["id"]: e for e in base if e["kind"] == "mcp"}
    out = []
    for name, spec in sorted(toml_servers(home).items())[:wh.MAX_SERVERS]:
        row = {"source": CODEX_LABEL, "scope": "user", "path": path, "facts": wikisecret.server_facts(claude_shaped(spec)), "plugin": None}
        e = by_id.get(name)
        if e is not None:
            e["configs"].append(row)
            e["material"]["configs"].append({"source": CODEX_LABEL, "path": path, **row["facts"]})
            e["runtimes"] = ["claude", "codex"] if "claude" in e.get("runtimes", ["claude"]) else ["codex"]
            continue
        f = row["facts"]
        command = " ".join(x for x in [f["command"], *f["args"]] if x) or None
        out.append({"kind": "mcp", "id": name, "title": name, "generic": True, "source": CODEX_LABEL,
                    "path": path, "material": {"name": name, "configs": [{"source": CODEX_LABEL, "path": path, **f}]}, "configs": [row],
                    "aliases": wh.server_aliases(name, "user"), "plugin": None, "runtimes": ["codex"], "codex_only": True,
                    "meta": wh._meta(("Type", f["type"]), ("Command", command), ("URL", f["url"]),
                                     ("Environment variables (names only)", ", ".join(f["env_keys"]) or None),
                                     ("Header names", ", ".join(f["header_keys"]) or None))})
    return out


def merge(portal, base):
    """Codex hooks and MCP servers join their Claude twin (one entry, both runtimes) or become Codex-only entries."""
    found = targets(portal)
    if found is None:
        return base
    home = found[0]
    return base + _merge_hooks(portal, home, base) + _merge_servers(home, base)


def runtimes_of(e, entries) -> list:
    """The runtimes that have this component; MCP tools follow the server that reports them."""
    if e.get("runtimes"):
        return e["runtimes"]
    owner = entries.get(tuple(e["owner"])) if e.get("owner") else None
    return owner.get("runtimes", ["claude"]) if owner else ["claude"]


def runtime_meta(e, entries) -> list:
    """The "Runtime" row of a detail page, as plain text."""
    from .wikibase import _meta
    if e["kind"] in CLAUDE_ONLY:
        return _meta(("Runtime", CLAUDE_ONLY_TEXT))
    return _meta(("Runtime", ", ".join(NAMES[r] for r in runtimes_of(e, entries))))
