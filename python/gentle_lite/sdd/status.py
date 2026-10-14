"""Read-only SDD status over an OpenSpec tree: the `gentle-ai.sdd-status` v2 projection (openspec store only).

Layout read: <root>/openspec/changes/<change>/{proposal.md, specs/**/*.md, design.md, tasks.md, apply-progress*, verify-report*}.
Nothing here writes to disk. The engram and hybrid stores are deliberately not supported and are reported as blocked.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

SCHEMA = "gentle-ai.sdd-status"
VERSION = 2
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
CHECKBOX = re.compile(r"^\s*[-*]\s+\[([ xX])\]")
BACKTICK = re.compile(r"`([^`\n]+)`(\s*\(read-only\))?", re.IGNORECASE)
STORE = re.compile(r"^\s*(?:artifact_store|store)\s*:\s*['\"]?([A-Za-z]+)", re.MULTILINE)
MAX_READ = 2_000_000

INSTRUCTIONS = {
    "apply": [
        "Read tasks, spec and design (and apply-progress when present) from artifactPaths before editing.",
        "Edit only files under actionContext.allowedEditRoots; stop and report an unsafe path instead of editing it.",
        "Mark each task [x] in tasks.md only after its outcome and checks were observed, then record progress in apply-progress.md.",
    ],
    "verify": [
        "Verification is optional and diagnostic: compare the implementation with the specs, design and tasks.",
        "Write findings to verify-report.md; a report is a locator fact, not a verdict, and never gates archive.",
    ],
    "archive": [
        "Merge each delta spec into openspec/specs/<domain>/spec.md by requirement name, preserving unrelated requirements byte for byte.",
        "Move the change folder under openspec/changes/archive/ and keep the unfinished task list as it is.",
    ],
}


class StatusError(Exception):
    pass


def _read(path: Path) -> str:
    try:
        with open(path, "rb") as f:
            return f.read(MAX_READ).decode("utf-8", "replace")
    except OSError:
        return ""


def _files(base: Path, pattern: str) -> list[str]:
    return sorted(str(p) for p in base.glob(pattern) if p.is_file())


def _declared_store(planning_home: Path) -> str:
    m = STORE.search(_read(planning_home / "config.yaml"))
    store = m.group(1).lower() if m else "openspec"
    return store if store in ("openspec", "engram", "hybrid", "none") else "openspec"


def _active_changes(planning_home: Path) -> list[str]:
    root = planning_home / "changes"
    if not root.is_dir():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir() and not p.is_symlink() and p.name != "archive" and NAME.match(p.name))


def _outside_roots(tasks_text: str, workspace: Path, roots: list[Path]) -> list[str]:
    """Backticked path-like tokens in unchecked checkbox lines that fall outside every allowed root (conservative prose scan)."""
    found: list[str] = []
    for line in tasks_text.splitlines():
        m = CHECKBOX.match(line)
        if not m or m.group(1) != " ":
            continue
        for tok in BACKTICK.finditer(line):
            raw, read_only = tok.group(1), tok.group(2)
            if read_only or " " in raw or not (raw.startswith(("/", "~/", "../")) and "/" in raw):
                continue
            target = Path(os.path.normpath(os.path.join(workspace, os.path.expanduser(raw))))
            if not any(target == r or r in target.parents for r in roots) and str(target) not in found:
                found.append(str(target))
    return found


def _dep(blocked: bool, done: bool) -> str:
    return "all_done" if done else ("blocked" if blocked else "ready")


def compute(root, change: str | None = None, instructions: bool = False) -> dict:
    workspace = Path(root).resolve()
    planning_home = workspace / "openspec"
    store = _declared_store(planning_home)
    active = _active_changes(planning_home)
    blocked: list[str] = []
    if change is not None:
        change = change.strip()
        if not NAME.match(change) or change not in active:
            raise StatusError(f"change {change!r} not found under openspec/changes (active: {', '.join(active) or 'none'})")
        selected = change
        next_override = None
    elif not active:
        selected, next_override = None, "sdd-new"
        blocked.append("No active OpenSpec changes found under openspec/changes.")
    elif len(active) > 1:
        selected, next_override = None, "select-change"
        blocked.append(f"Multiple active changes found: {', '.join(active)}. Select one.")
    else:
        selected, next_override = active[0], None
    if store in ("engram", "hybrid"):
        blocked.append(f"artifact store '{store}' is not supported by gentle-lite (openspec only); declare artifact_store: openspec in openspec/config.yaml.")

    base = planning_home / "changes" / selected if selected else None
    paths = {"proposal": [], "specs": [], "design": [], "tasks": [], "applyProgress": [], "verifyReport": []}
    tasks_text = ""
    if base is not None:
        for key, name in (("proposal", "proposal.md"), ("design", "design.md"), ("tasks", "tasks.md")):
            if (base / name).is_file():
                paths[key] = [str(base / name)]
        paths["specs"] = _files(base, "specs/**/*.md")
        paths["applyProgress"] = sorted(str(p) for p in base.glob("apply-progress*") if p.exists())
        paths["verifyReport"] = sorted(str(p) for p in base.glob("verify-report*") if p.exists())
        tasks_text = _read(base / "tasks.md") if paths["tasks"] else ""

    boxes = [m.group(1) for m in (CHECKBOX.match(l) for l in tasks_text.splitlines()) if m]
    total, completed = len(boxes), sum(1 for b in boxes if b in "xX")
    progress = {"total": total, "completed": completed, "pending": total - completed, "allComplete": total > 0 and completed == total}
    artifacts = {k: ("done" if v else "missing") for k, v in paths.items()}
    if paths["tasks"] and total == 0:
        artifacts["tasks"] = "partial"
    has = {k: bool(v) for k, v in paths.items()}

    roots = [workspace]
    outside = _outside_roots(tasks_text, workspace, roots) if has["tasks"] else []
    if outside:
        blocked.append("blocked(edit_authority_missing): tasks.md targets paths outside the authorized edit roots: " + ", ".join(outside) +
                       ". Exits: edit tasks.md so every work unit stays inside the workspace, or mark a read-only input with (read-only) on its line.")

    planning_ready = has["specs"] and has["design"]
    apply_dep = "blocked" if (not (planning_ready and has["tasks"]) or outside) else ("all_done" if progress["allComplete"] else "ready")
    dependencies = {
        "proposal": _dep(False, has["proposal"]),
        "specs": _dep(not has["proposal"], has["specs"]),
        "design": _dep(not has["proposal"], has["design"]),
        "tasks": _dep(not planning_ready, has["tasks"] and total > 0),
        "apply": apply_dep,
        "verify": _dep(not has["tasks"], has["verifyReport"]),
        "archive": _dep(not has["tasks"], False),
    }
    if blocked:
        nxt = "resolve-blockers" if store in ("engram", "hybrid") else (next_override or "resolve-blockers")
    elif not has["proposal"]:
        nxt = "propose"
    elif not has["specs"]:
        nxt = "spec"
    elif not has["design"]:
        nxt = "design"
    elif not has["tasks"] or total == 0:
        nxt = "tasks"
    elif progress["allComplete"]:
        nxt = "archive"
    else:
        nxt = "apply"

    out = {
        "schemaName": SCHEMA, "schemaVersion": VERSION, "changeName": selected, "artifactStore": store,
        "planningHome": {"mode": "repo-local", "path": str(planning_home)},
        "changeRoot": str(base) if base else None,
        "artifactPaths": paths, "contextFiles": {k: list(v) for k, v in paths.items()},
        "artifacts": artifacts, "taskProgress": progress, "dependencies": dependencies, "applyState": apply_dep,
        "actionContext": {"mode": "repo-local", "workspaceRoot": str(workspace), "allowedEditRoots": [str(r) for r in roots]},
        "relationships": {"dependsOn": [], "supersedes": [], "amends": [], "conflictsWith": [], "sameDomainActiveChanges": [c for c in active if c != selected]},
    }
    if instructions:
        out["phaseInstructions"] = {k: list(v) for k, v in INSTRUCTIONS.items()}
    out.update({"nextRecommended": nxt, "blockedReasons": blocked, "notes": []})
    return out


def render_markdown(s: dict, heading: str = "SDD Status") -> str:
    lines = [f"## {heading}: {s['changeName'] or 'unresolved'}", "", f"schema: {s['schemaName']} v{s['schemaVersion']}", f"store: {s['artifactStore']}",
             f"planning_home: {s['planningHome']['path']}", f"next: {s['nextRecommended']}", "", "### Summary",
             f"- apply: {s['dependencies']['apply']}", f"- verify: {s['dependencies']['verify']}", f"- archive: {s['dependencies']['archive']}",
             f"- tasks: {s['taskProgress']['completed']}/{s['taskProgress']['total']}"]
    if s["blockedReasons"]:
        lines += ["", "### Blocked Reasons", *[f"- {r}" for r in s["blockedReasons"]]]
    lines += ["", "```json", json.dumps(s, indent=2), "```", ""]
    return "\n".join(lines)


def render_dispatcher(s: dict) -> str:
    deps = [f"- {k}: {v}" for k, v in s["dependencies"].items()]
    head = [f"## Native SDD Dispatcher: {s['changeName'] or 'unresolved'}", "", "### Dependencies", *deps, "", f"next_recommended: {s['nextRecommended']}"]
    if s["blockedReasons"]:
        head += ["", "### Blocked Reasons", *[f"- {r}" for r in s["blockedReasons"]]]
    return "\n".join(head + ["", "```json", json.dumps(s, indent=2), "```", ""])
