"""Human labels for sessions. The usage tables keep only a project name taken from the last directory of the cwd, so the label is
completed from the session's own transcript (read-only, first bytes only): its cwd (named by sessname.project_of) and its
first user prompt."""
from __future__ import annotations

import json
import re

SESSION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
READ_BYTES = 65536
SNIPPET = 60
SEP = " · "
CACHED = 50_000


def _prompt_text(message):
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, list):
        content = " ".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str))
    return " ".join(content.split()) if isinstance(content, str) else ""


def _transcript(portal, session_id):
    if not SESSION_ID.match(session_id) or ".." in session_id:
        return None
    from . import sesswhere  # sesswhere reads this module for the transcript head
    return sesswhere.claude_transcript(portal, session_id)


def session_info(portal, session_id):
    """{"cwd", "prompt"} found in the first bytes of the transcript; {} when the session id is not a plain id or has no transcript."""
    path = _transcript(portal, str(session_id))
    if path is None:
        return {}
    done = getattr(portal, "_session_info", None)
    if done is None:
        done = portal._session_info = {}
    if str(session_id) in done:  # a transcript's cwd and first prompt never change once both are written
        return dict(done[str(session_id)])
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
            if len(done) < CACHED:
                done[str(session_id)] = dict(info)
            break
    return info


def label(portal, session_id, project, model, messages, first_ts, dated=True):
    """"project · first prompt (or model, count) · start date"; the feed leaves the date out (`dated=False`): its day heading says it."""
    from . import sessname  # sessname reads projects, which reads this module
    info = session_info(portal, session_id)
    repo = sessname.session_project(portal, session_id, project)
    n = int(messages or 0)
    middle = info.get("prompt") or f"{model or 'unknown model'}, {n} message{'' if n == 1 else 's'}"
    return SEP.join(p for p in (repo, middle, (first_ts or "")[:10] if dated else "") if p)


def what(n):
    """The recent-changes line of a session; one message is singular (the client translates both forms). The row's kind
    label already says it is a session."""
    return "1 message" if n == 1 else f"{n} messages"


def feed_what(n, title):
    """what(n), or nothing when the title already carries the count (a session without a first prompt)."""
    return "" if what(n) in title else what(n)
