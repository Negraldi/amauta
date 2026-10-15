"""Stop/SubagentStop hook: ingest the transcripts named in the payload. Never fails, never prints."""
from __future__ import annotations

import json
import sys
import time

from pathlib import Path

from .. import paths
from ..memory import store as mstore
from . import ingest

BUSY_MS = 500
BUDGET_S = 3.0  # total time the hook may spend ingesting; the rest is picked up on the next run


def candidates(payload) -> list[Path]:
    if not isinstance(payload, dict):
        return []
    out = []
    for key in ("transcript_path", "agent_transcript_path"):
        v = payload.get(key)
        if isinstance(v, str) and v.endswith(".jsonl"):
            p = Path(v)
            if p.is_file() and not p.is_symlink():
                out.append(p)
    return out


def run(payload, env=None) -> None:
    files = candidates(payload)
    if not files:
        return
    deadline = time.monotonic() + BUDGET_S
    conn = mstore.connect(paths.db_path(env), busy_ms=BUSY_MS)
    try:
        for p in files:
            ingest.ingest_file(conn, p, deadline=deadline)
    finally:
        conn.close()


def main() -> int:
    try:
        run(json.loads(sys.stdin.buffer.read()))
    except Exception:  # fail open
        pass
    return 0
