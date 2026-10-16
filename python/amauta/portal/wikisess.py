"""Human labels for sessions. The usage tables keep only a project name taken from the last directory of the cwd, so the label is
completed from the session's own transcript (read-only, first bytes only): the git root of its cwd and its first user prompt."""
from __future__ import annotations

import json
import re
from pathlib import Path

SESSION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
READ_BYTES = 65536
SNIPPET = 60
SEP = " · "


def _prompt_text(message):
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, list):
        content = " ".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str))
    return " ".join(content.split()) if isinstance(content, str) else ""


def _transcript(portal, session_id):
    if not SESSION_ID.match(session_id) or ".." in session_id:
        return None
    root = portal.cfg.claude_home / "projects"
    if not root.is_dir():
        return None
    for folder in sorted(root.iterdir()):
        path = folder / f"{session_id}.jsonl"
        if folder.is_dir() and not folder.is_symlink() and path.is_file() and not path.is_symlink():
            return path
    return None


def session_info(portal, session_id):
    """{"cwd", "prompt"} found in the first bytes of the transcript; {} when the session id is not a plain id or has no transcript."""
    path = _transcript(portal, str(session_id))
    if path is None:
        return {}
    try:
        with path.open("rb") as fh:
            head = fh.read(READ_BYTES).decode("utf-8", "replace")
    except OSError:
        return {}
    info = {}
    for raw in head.splitlines()[:-1] if len(head) >= READ_BYTES else head.splitlines():  # the last line of a full read may be cut
        try:
            line = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(line, dict):
            continue
        if "cwd" not in info and isinstance(line.get("cwd"), str) and line["cwd"]:
            info["cwd"] = line["cwd"][:1024]
        if "prompt" not in info and line.get("type") == "user" and not line.get("isMeta"):
            text = _prompt_text(line.get("message"))
            if text and not text.startswith("<"):
                info["prompt"] = text[:SNIPPET] + ("..." if len(text) > SNIPPET else "")
        if "cwd" in info and "prompt" in info:
            break
    return info


def repo_name(cwd):
    """Basename of the nearest ancestor holding a .git entry (the cwd itself when none does)."""
    if not cwd:
        return ""
    here = Path(cwd)
    for d in [here, *here.parents][:24]:
        try:
            if (d / ".git").exists():
                return d.name or str(d)
        except OSError:
            break
    return here.name


def label(portal, session_id, project, model, messages, first_ts):
    info = session_info(portal, session_id)
    repo = repo_name(info.get("cwd")) or project or "unknown project"
    n = int(messages or 0)
    middle = info.get("prompt") or f"{model or 'unknown model'}, {n} message{'' if n == 1 else 's'}"
    return SEP.join(p for p in (repo, middle, (first_ts or "")[:10]) if p)
