"""Explanation queue for harness components, and its command line.

The portal never calls a model. A person (or a Claude Code session running the `amauta-wiki-explain` skill) does the writing:

  1. The portal's "Request explanation" button appends {kind, id, requested_at, source_hash} to `<state>/wiki/requests.jsonl` (deduplicated, capped).
  2. `python3 -P -m amauta.portal.wikiexplain list` prints the pending requests with the component's source material as JSON.
  3. `... write --kind K --id I --file note.md` stores `<state>/wiki/notes/<kind>/<slug>.md` (frontmatter: source_hash, written_at) and removes the request.
  4. The component page renders the note under "Explanation"; wiki lint flags notes whose source_hash no longer matches the component.

Everything stays inside `<state>/wiki`: kinds come from a fixed list, ids must name a discovered component, the file name is a slug of the id plus a hash
when the id has separators, no directory or file may be a link, and every write is atomic.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .. import paths
from . import wikiharness
from .wikiusage import parse_frontmatter

ALLOWED = ("hook", "mcp", "mcptool", "connector", "tool", "agent", "command", "plugin", "outputstyle")
MAX_ID = 200
MAX_REQUESTS = 500
MAX_FILE = 400_000
MAX_NOTE = 20_000
MAX_NOTES = 600
_PLAIN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


class ExplainError(Exception):
    def __init__(self, message, status=400, code="explain.invalid"):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code

    def body(self):
        return {"error": self.message, "code": self.code}


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _plain_dir(path: Path, create=False) -> Path:
    try:
        if os.path.lexists(path):
            if not stat.S_ISDIR(os.lstat(path).st_mode):
                raise ExplainError("the wiki directory is not a plain directory", 400, "explain.dir")
        elif create:
            path.mkdir(parents=True, exist_ok=True)
    except OSError:
        raise ExplainError("could not create the wiki directory", 500, "explain.write") from None
    return path


def wiki_dir(state_dir, create=False) -> Path:
    return _plain_dir(Path(state_dir) / "wiki", create)


def check_target(kind, ident):
    if kind not in ALLOWED:
        raise ExplainError("kind must be one of: " + ", ".join(ALLOWED), 400, "explain.kind")
    if not isinstance(ident, str) or not ident or len(ident) > MAX_ID or "\n" in ident or "\x00" in ident:
        raise ExplainError(f"id must be 1-{MAX_ID} characters", 400, "explain.id")


def _entry(portal, kind, ident):
    return wikiharness.index(portal).get((kind, ident))


def current_hash(portal, kind, ident):
    e = _entry(portal, kind, ident)
    return wikiharness.digest(e["material"]) if e else None


def _slug(ident):
    if _PLAIN.match(ident):
        return ident
    return (re.sub(r"[^A-Za-z0-9._-]", "_", ident).strip("._-")[:60] or "x") + "-" + hashlib.sha1(ident.encode()).hexdigest()[:8]


# ---- requests -----------------------------------------------------------------------------------------------------
class _Locked:
    """Cross-process lock for the queue (the portal and the CLI both write it)."""

    def __init__(self, d):
        self.path = d / ".requests.lock"

    def __enter__(self):
        self.fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        fcntl.flock(self.fd, fcntl.LOCK_EX)
        return self

    def __exit__(self, *exc):
        fcntl.flock(self.fd, fcntl.LOCK_UN)
        os.close(self.fd)


def _requests_path(state_dir) -> Path:
    return Path(state_dir) / "wiki" / "requests.jsonl"


def _parse_requests(text):
    out, seen = [], set()
    for line in text.splitlines():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if not (isinstance(r, dict) and r.get("kind") in ALLOWED and isinstance(r.get("id"), str) and 0 < len(r["id"]) <= MAX_ID
                and isinstance(r.get("requested_at"), str) and isinstance(r.get("source_hash"), str)):
            continue
        key = (r["kind"], r["id"])
        if key not in seen:
            seen.add(key)
            out.append({"kind": r["kind"], "id": r["id"], "requested_at": r["requested_at"][:30], "source_hash": r["source_hash"][:64]})
    return out[:MAX_REQUESTS]


def _read_requests(state_dir):
    p = _requests_path(state_dir)
    try:
        if not stat.S_ISREG(os.lstat(p).st_mode):
            return []
        with p.open("rb") as fh:
            return _parse_requests(fh.read(MAX_FILE).decode("utf-8", "replace"))
    except OSError:
        return []


def pending(portal):
    return _read_requests(portal.cfg.state_dir)


def request(portal, body) -> dict:
    if not isinstance(body, dict) or set(body) != {"kind", "id"}:
        raise ExplainError("body must be an object with exactly kind and id", 400, "explain.shape")
    kind, ident = body["kind"], body["id"]
    check_target(kind, ident)
    entry = _entry(portal, kind, ident)
    if entry is None:
        raise ExplainError("no such component", 404, "explain.unknown")
    d = wiki_dir(portal.cfg.state_dir, create=True)
    path = _requests_path(portal.cfg.state_dir)
    with _Locked(d):
        if os.path.lexists(path) and not stat.S_ISREG(os.lstat(path).st_mode):
            raise ExplainError("the request queue is a link or not a regular file", 400, "explain.dir")
        queue = _read_requests(portal.cfg.state_dir)
        mine = next((r for r in queue if (r["kind"], r["id"]) == (kind, ident)), None)
        if mine:
            return {**mine, "already": True}
        if len(queue) >= MAX_REQUESTS or (path.exists() and path.stat().st_size > MAX_FILE):
            raise ExplainError("too many pending explanation requests: ask Claude to process them first", 409, "explain.full")
        rec = {"kind": kind, "id": ident, "requested_at": _now(), "source_hash": wikiharness.digest(entry["material"])}
        try:
            fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except OSError:
            raise ExplainError("could not write the request", 500, "explain.write") from None
    return {**rec, "already": False}


def _drop_request(state_dir, kind, ident):
    path = _requests_path(state_dir)
    rest = [r for r in _read_requests(state_dir) if (r["kind"], r["id"]) != (kind, ident)]
    if len(rest) == len(_read_requests(state_dir)):
        return
    d = path.parent
    fd, tmp = tempfile.mkstemp(prefix=".requests-", suffix=".tmp", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rest))
        os.replace(tmp, path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise ExplainError("could not update the request queue", 500, "explain.write") from None


# ---- notes ---------------------------------------------------------------------------------------------------------
def _note_path(state_dir, kind, ident, create=False) -> Path:
    d = _plain_dir(wiki_dir(state_dir, create) / "notes", create)
    return _plain_dir(d / kind, create) / f"{_slug(ident)}.md"


def _read_note(path: Path):
    """(frontmatter, body) of a regular note file, or None."""
    try:
        if not stat.S_ISREG(os.lstat(path).st_mode) or path.stat().st_size > MAX_NOTE + 2000:
            return None
        return parse_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return None


def note(portal, kind, ident):
    """{body_md, written_at, stale} for a component's note, or None."""
    if kind not in ALLOWED or not isinstance(ident, str) or len(ident) > MAX_ID:
        return None
    try:
        read = _read_note(_note_path(portal.cfg.state_dir, kind, ident))
    except ExplainError:
        return None
    if read is None or read[0].get("id") != ident:
        return None
    front, body = read
    return {"body_md": body, "written_at": front.get("written_at"), "stale": front.get("source_hash") != current_hash(portal, kind, ident)}


def notes(portal):
    """[{kind, id, source_hash}] of every note on disk (bounded), for the lint."""
    out = []
    root = Path(portal.cfg.state_dir) / "wiki" / "notes"
    try:
        if not stat.S_ISDIR(os.lstat(root).st_mode):
            return out
    except OSError:
        return out
    for kind in ALLOWED:
        folder = root / kind
        try:
            if not stat.S_ISDIR(os.lstat(folder).st_mode):
                continue
            names = sorted(n for n in os.listdir(folder) if n.endswith(".md"))
        except OSError:
            continue
        for name in names:
            read = _read_note(folder / name)
            if read and isinstance(read[0].get("id"), str):
                out.append({"kind": kind, "id": read[0]["id"], "source_hash": read[0].get("source_hash")})
            if len(out) >= MAX_NOTES:
                return out
    return out


def page_block(portal, entry):
    """The `explain` block of a component page: the pending request (if any) and the stored note (if any)."""
    kind, ident = entry["kind"], entry["id"]
    mine = next((r for r in pending(portal) if (r["kind"], r["id"]) == (kind, ident)), None)
    return {"pending": {"requested_at": mine["requested_at"]} if mine else None, "note": note(portal, kind, ident)}


def write_note(portal, kind, ident, text) -> Path:
    check_target(kind, ident)
    entry = _entry(portal, kind, ident)
    if entry is None:
        raise ExplainError("no such component", 404, "explain.unknown")
    body = str(text).replace("\r\n", "\n").strip()
    if not body or "\x00" in body:
        raise ExplainError("the note is empty or contains a NUL byte", 400, "explain.note")
    if len(body) > MAX_NOTE:
        raise ExplainError(f"the note is longer than {MAX_NOTE} characters", 413, "explain.note")
    state = portal.cfg.state_dir
    d = wiki_dir(state, create=True)
    target = _note_path(state, kind, ident, create=True)
    if os.path.lexists(target) and not stat.S_ISREG(os.lstat(target).st_mode):
        raise ExplainError("that note file is a link or not a regular file", 400, "explain.dir")
    content = f"---\nkind: {kind}\nid: {ident}\nsource_hash: {wikiharness.digest(entry['material'])}\nwritten_at: {_now()}\n---\n{body}\n"
    with _Locked(d):
        fd, tmp = tempfile.mkstemp(prefix=".note-", suffix=".tmp", dir=target.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(content)
            os.replace(tmp, target)
        except OSError:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise ExplainError("could not write the note", 500, "explain.write") from None
        _drop_request(state, kind, ident)
    return target


# ---- command line ------------------------------------------------------------------------------------------------
def _portal(args):
    from .api import Portal
    from .config import Config
    return Portal(Config(state_dir=paths.state_dir(), claude_home=args.claude_home or paths.claude_home(), repos=args.repo))


def _list(args) -> int:
    portal = _portal(args)
    items = []
    for r in pending(portal):
        e = _entry(portal, r["kind"], r["id"])
        item = {**r, "title": e["title"] if e else None, "current_hash": wikiharness.digest(e["material"]) if e else None, "exists": e is not None}
        if e:
            item["summary"] = {"description": e.get("description"), "when": e.get("when"), "source": e["source"], "path": e.get("path")}
            item["source"] = e["material"]
        items.append(item)
    json.dump({"count": len(items), "pending": items}, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


def _read_text(spec):
    if spec == "-":
        return sys.stdin.read(MAX_NOTE * 4 + 1)
    p = Path(spec)
    try:
        if not stat.S_ISREG(os.stat(p).st_mode):
            raise ExplainError("the note file is not a regular file", 400, "explain.note")
        with p.open("rb") as fh:
            return fh.read(MAX_NOTE * 4 + 1).decode("utf-8", "replace")
    except OSError:
        raise ExplainError("could not read the note file", 400, "explain.note") from None


def _write(args) -> int:
    portal = _portal(args)
    path = write_note(portal, args.kind, args.id, _read_text(args.file))
    json.dump({"ok": True, "kind": args.kind, "id": args.id, "note": str(path)}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="amauta.portal.wikiexplain", description="Process the wiki explanation requests (the portal itself never calls a model).")
    p.add_argument("--repo", action="append", default=[], help="a project the portal knows (repeatable); defaults to the configured ones")
    p.add_argument("--claude-home")
    sub = p.add_subparsers(dest="cmd", required=True)
    ls = sub.add_parser("list", help="pending requests with each component's source material, as JSON")
    w = sub.add_parser("write", help="store a note for a component and remove its request")
    w.add_argument("--kind", required=True)
    w.add_argument("--id", required=True)
    w.add_argument("--file", required=True, help="markdown file with the note, or - for standard input")
    for sp in (ls, w):  # the options may come before or after the subcommand
        sp.add_argument("--repo", action="append", default=argparse.SUPPRESS, help=argparse.SUPPRESS)
        sp.add_argument("--claude-home", default=argparse.SUPPRESS, help=argparse.SUPPRESS)
    args = p.parse_args(argv)
    try:
        return _list(args) if args.cmd == "list" else _write(args)
    except ExplainError as err:
        sys.stderr.write(json.dumps(err.body()) + "\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
