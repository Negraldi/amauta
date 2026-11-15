"""Harness wiki, instruction blocks: the amauta marker blocks that the installer writes to CLAUDE.md (Claude Code) and AGENTS.md
(Codex) are catalog entries of the kind "instructions".

A block is the text between `<!-- amauta:ID -->` and `<!-- /amauta:ID -->` (both markers needed). Read-only and bounded:
only regular files (never a link) of the Claude home and of the Codex home the portal was given are read, so a sandboxed
portal never reads the real ones. The entry says what the block is for (its first paragraph of prose, when it has one),
which files and runtimes carry it and how many characters it has in each. A block that opens with a heading or a list has no
stated purpose.
"""
from __future__ import annotations

import os
import re
import stat
from pathlib import Path

from .wikibase import _meta

KINDS = (("instructions", "Instruction blocks"),)
WHEN = "At the start of every session, as part of the always-on instructions the agent reads."
MAX_BYTES = 2_000_000
MAX_BLOCKS = 100
MAX_DESCRIPTION = 400
FILES = (("claude", "CLAUDE.md"), ("codex", "AGENTS.md"))
_OPEN = re.compile(r"^<!-- amauta:(\S+) -->$")


def read_blocks(path: Path) -> list:
    """[(id, text)] of the complete marker blocks of one instruction file, in file order; [] for anything but a regular file."""
    try:
        if not stat.S_ISREG(os.lstat(path).st_mode):
            return []
        with path.open("rb") as fh:
            lines = fh.read(MAX_BYTES).decode("utf-8", "replace").splitlines()
    except OSError:
        return []
    out, seen = [], set()
    for i, line in enumerate(lines):
        m = _OPEN.match(line.strip())
        if not m or m.group(1) in seen:
            continue
        close = f"<!-- /amauta:{m.group(1)} -->"
        end = next((j for j in range(i + 1, len(lines)) if lines[j].strip() == close), None)
        if end is not None:
            seen.add(m.group(1))
            out.append((m.group(1), "\n".join(lines[i + 1:end]).strip("\n")))
    return out[:MAX_BLOCKS]


_LIST_ITEM = re.compile(r"^(?:[-*+]|\d+[.)])\s+")


def _first_paragraph(lines: list) -> tuple:
    """(start, end) of the first paragraph that is not a heading (end exclusive), or None."""
    start = None
    for i, line in enumerate([*lines, ""]):
        s = line.strip()
        if s.startswith("#"):
            continue
        if s and start is None:
            start = i
        elif not s and start is not None:
            return (start, i)
    return None


def purpose(text: str) -> str | None:
    """What the block is for: its first paragraph of prose. A heading or a list is not a description: a block that opens with
    one has none, and the page leaves the line out."""
    lines = text.splitlines()
    span = _first_paragraph(lines)
    if span is None or _LIST_ITEM.match(lines[span[0]].strip()):
        return None
    return " ".join(x.strip() for x in lines[span[0]:span[1]])[:MAX_DESCRIPTION] or None


def without_purpose(text: str, description: str | None) -> str:
    """The body minus its first paragraph when that paragraph is the description ("What it does" already says it)."""
    lines = text.splitlines()
    span = _first_paragraph(lines)
    if span is None or _LIST_ITEM.match(lines[span[0]].strip()):
        return text
    if " ".join(x.strip() for x in lines[span[0]:span[1]])[:MAX_DESCRIPTION] != description:
        return text
    rest = lines[:span[0]] + lines[span[1] + 1:]
    return "\n".join(rest).strip("\n")


def _entry(ident, text, label, path) -> dict:
    desc = purpose(text)
    return {"kind": "instructions", "id": ident, "title": ident, "description": desc, "when": WHEN, "source": label,
            "path": str(path), "body": without_purpose(text, desc), "configs": [], "runtimes": [], "sizes": [], "origins": []}


def collect(portal) -> list:
    """One entry per block id found in either instruction file."""
    from . import wikicodex
    from .wikiharness import USER_LABEL
    found = wikicodex.targets(portal)
    homes = [("claude", portal.cfg.claude_home, USER_LABEL)]
    if found is not None:
        homes.append(("codex", found[0], wikicodex.CODEX_LABEL))
    entries = {}
    for runtime, home, label in homes:
        name = dict(FILES)[runtime]
        for ident, text in read_blocks(home / name):
            e = entries.setdefault(ident, _entry(ident, text, label, home / name))
            e["configs"].append({"source": label, "path": str(home / name)})
            e["origins"].append({"source": label, "path": str(home / name)})
            e["runtimes"].append(runtime)
            e["sizes"].append((f"Size in {name} (characters)", len(text)))
    for e in entries.values():
        e["meta"] = _meta(*e.pop("sizes"))
    return list(entries.values())
