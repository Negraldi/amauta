"""Skill catalog: every skill the portal can describe, grouped by where it comes from. Read-only and bounded.

Sources: installed by amauta (state.json managed files under the Claude skills dir), the user's own skills there, plugin skills
(`~/.claude/plugins/**/skills/*/SKILL.md`), project skills (`<project>/.claude/skills/*/SKILL.md` of known projects) and built-ins:
names seen in usage data with no local file. Only paths found by this discovery are ever read, never a path built from a request.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from .wikiusage import SKILL_BYTES, SKILL_NAME, parse_frontmatter

MAX_PER_ROOT = 200
MAX_PLUGIN_SKILLS = 500
MAX_PLUGIN_DIRS = 20000
MAX_PLUGIN_DEPTH = 9
HEAD_BYTES = 8192
SOURCES = (("installed", "Installed by amauta"), ("user", "Your skills"), ("plugin", "Plugins"), ("project", "Project"), ("builtin", "Built into Claude Code"))
_TRIGGER = re.compile(r"\bTrigger:\s*", re.I)
_VERSION = re.compile(r"^v?\d[\w.+-]*$")


def split_trigger(description):
    """(description, trigger). "Trigger: X. Rest" and "Rest. Trigger: X" both work; no marker means no trigger."""
    text = " ".join(str(description or "").split())
    m = _TRIGGER.search(text)
    if not m:
        return text, None
    before, after = text[:m.start()].strip(), text[m.end():].strip()
    if before:
        return before, after or None
    sentence = re.match(r"(.+?[.!?])(?:\s+|$)(.*)$", after)
    return (sentence.group(2).strip(), sentence.group(1).rstrip(".!?").strip()) if sentence else ("", after or None)


def _readable(path: Path) -> bool:
    try:
        return path.is_file() and not path.is_symlink() and not path.parent.is_symlink()
    except OSError:
        return False


def _entry(source, ident, name, path, **extra):
    try:
        with path.open("rb") as fh:
            front, _ = parse_frontmatter(fh.read(HEAD_BYTES).decode("utf-8", "replace"))
    except OSError:
        return None
    description, trigger = split_trigger(front.get("description"))
    return {"id": ident, "name": name, "source": source, "description": description or None, "trigger": trigger, "path": str(path), **extra}


def _skill_dirs(root: Path):
    """Direct children of `root` that hold a SKILL.md (plain names only, no symlinks, bounded)."""
    try:
        names = sorted(d.name for d in root.iterdir() if SKILL_NAME.match(d.name) and not d.is_symlink() and d.is_dir())
    except OSError:
        return []
    return [(n, root / n / "SKILL.md") for n in names if _readable(root / n / "SKILL.md")][:MAX_PER_ROOT]


def _managed(portal):
    try:
        data = json.loads((portal.cfg.state_dir / "state.json").read_text())
        files = data.get("managed_files") if isinstance(data, dict) else None
    except (OSError, ValueError):
        return set()
    return {m.group(1) for rel in (files or {}) if (m := re.fullmatch(r"skills/([^/]+)/SKILL\.md", rel))}


def _plugin_name(parts):
    """Plugin owning .../<plugin>[/<version>]/skills: the nearest ancestor that is not a version directory."""
    for p in reversed(parts):
        if not _VERSION.match(p):
            return p
    return "plugin"


def _plugin_files(root: Path):
    out, seen_dirs = [], 0
    base = len(root.parts)
    for dirpath, dirnames, _ in os.walk(root, followlinks=False):
        seen_dirs += 1
        here = Path(dirpath)
        if seen_dirs > MAX_PLUGIN_DIRS or len(here.parts) - base > MAX_PLUGIN_DEPTH:
            dirnames[:] = []
            continue
        dirnames[:] = sorted(d for d in dirnames if d not in (".git", "node_modules") and not (here / d).is_symlink())
        if here.name == "skills":
            plugin = _plugin_name(here.parent.relative_to(root).parts)
            for d in dirnames:
                f = here / d / "SKILL.md"
                if SKILL_NAME.match(d) and _readable(f):
                    out.append((plugin, d, f))
            dirnames[:] = []
        if len(out) >= MAX_PLUGIN_SKILLS:
            break
    return out


def discover(portal):
    """Entries for every skill file found, in group order. Ids: `name`, `plugin:name`, `project/name`."""
    from . import wikiharness  # lazy: wikiharness imports this module
    found, managed = [], _managed(portal)
    for name, path in _skill_dirs(portal.cfg.claude_home / "skills"):
        found.append(_entry("installed" if name in managed else "user", name, name, path))
    taken, off = set(), None
    for plugin, name, path in _plugin_files(portal.cfg.claude_home / "plugins"):  # cache comes before marketplaces: the first copy wins
        ident = f"{plugin}:{name}"
        if ident not in taken:
            taken.add(ident)
            off = wikiharness.disabled_plugins(portal) if off is None else off
            found.append(_entry("plugin", ident, name, path, plugin=plugin, **({"disabled": True} if plugin in off else {})))
    for repo in portal.repos():
        for name, path in _skill_dirs(Path(repo) / ".claude" / "skills"):
            found.append(_entry("project", f"{Path(repo).name}/{name}", name, path, project=Path(repo).name))
    return [e for e in found if e]


def find(portal, ident):
    """The discovered entry for an id, or None. The id only selects among discovered files."""
    if not isinstance(ident, str) or not ident or ".." in ident or "\\" in ident:
        return None
    return next((e for e in discover(portal) if e["id"] == ident), None)


def label(entry):
    kind = entry["source"]
    return {"installed": "Installed by amauta", "user": "Your skills", "plugin": f"Plugin {entry.get('plugin')}", "project": f"Project {entry.get('project')}"}.get(kind, "Built into Claude Code")


def read(portal, ident):
    """(entry, frontmatter, body, truncated) of a skill that has a local file, else None."""
    entry = find(portal, ident)
    if entry is None:
        return None
    try:
        with Path(entry["path"]).open("rb") as fh:
            raw = fh.read(SKILL_BYTES + 1)
    except OSError:
        return None
    front, body = parse_frontmatter(raw[:SKILL_BYTES].decode("utf-8", "replace"))
    return entry, front, body, len(raw) > SKILL_BYTES


def usage_by_name(portal):
    conn = portal._usage_conn()
    if conn is None:
        return {}
    try:
        return {r["name"]: dict(r) for r in conn.execute(
            "SELECT c.skill name, count(*) uses, count(DISTINCT c.session_id) sessions, max(c.ts) last_used FROM tool_calls c WHERE c.skill IS NOT NULL GROUP BY c.skill")}
    finally:
        conn.close()


def catalog(portal, q=None):
    usage, entries = usage_by_name(portal), discover(portal)
    known = {e["id"] for e in entries}
    entries += [{"id": n, "name": n, "source": "builtin", "description": None, "trigger": None, "path": None} for n in sorted(usage) if n not in known]
    groups = []
    for key, text in SOURCES:
        items = []
        for e in (x for x in entries if x["source"] == key):
            u = usage.get(e["id"]) or {}
            items.append({**e, "label": label(e), "uses": u.get("uses", 0), "sessions": u.get("sessions", 0), "last_used": u.get("last_used")})
        if items:
            items.sort(key=lambda i: (-i["uses"], i["id"]))
            groups.append({"source": key, "label": text, "items": items})
    return {"groups": groups, "total": sum(len(g["items"]) for g in groups)}
