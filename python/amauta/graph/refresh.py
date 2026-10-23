"""One graph refresh for a project directory: lock, `graphify update .`, `graphify check-update .`, then mirror into memory.db.

This is the portal's "Sync graph now": the same steps as the git hook block (src/graphify/hook.js), for any directory, git or not.
A git repository takes the hook's lock (`git rev-parse --git-path amauta-graphify.lock`), so a refresh and a commit never overlap;
a plain directory takes `<dir>/graphify-out/.amauta-graphify.lock`. The lock protocol itself is lock.py. A refresh that finds the
lock held leaves `<lock>.pending` and exits 75; the holder reruns once when it sees the marker (same as the hook).

    python3 -P -m amauta.graph.refresh --repo DIR

Exit codes: 0 done, 75 another refresh is running (it will rerun), 2 nothing to mirror or a sync failure.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from .. import paths
from ..memory import store as mstore
from . import lock as gl, sync

LOG_MAX_BYTES = 262_144
UPDATE_TIMEOUT = 1800
PENDING_LINE = re.compile(r"^\[graphify check-update\] Pending non-code changes", re.M)
PLAIN_LOCK = ("graphify-out", ".amauta-graphify.lock")


def lock_for(repo: Path) -> Path:
    repo = Path(repo).resolve()
    return gl.lock_path(repo) or repo.joinpath(*PLAIN_LOCK)


def _note(message: str) -> None:
    log = paths.state_dir() / "graphify-hook.log"
    try:
        log.parent.mkdir(parents=True, exist_ok=True)
        if log.exists() and log.stat().st_size > LOG_MAX_BYTES:
            log.write_text("")
        with log.open("a") as fh:
            fh.write(f"{mstore.now()} {message}\n")
    except OSError:
        pass


def _graphify(repo: Path, *args: str) -> subprocess.CompletedProcess | None:
    exe = shutil.which("graphify")
    if exe is None:
        return None
    env = {**os.environ, "GRAPHIFY_QUERY_LOG_DISABLE": "1"}
    return subprocess.run([exe, *args], cwd=repo, env=env, capture_output=True, text=True, timeout=UPDATE_TIMEOUT)


def _once(repo: Path) -> bool:
    """One update + check + sync. True when the graph was mirrored."""
    pending = None
    try:
        done = _graphify(repo, "update", ".")
        if done is None:
            _note("graphify is not on PATH: mirroring the existing graph.json only")
        elif done.returncode != 0:
            _note(f"graphify update failed: {(done.stdout + done.stderr).strip()[:300]}")
        else:
            chk = _graphify(repo, "check-update", ".")
            if chk is not None and chk.returncode == 0:
                pending = bool(PENDING_LINE.search(chk.stdout + chk.stderr))
    except (OSError, subprocess.TimeoutExpired) as err:
        _note(f"graphify could not run: {err}")
    if not sync.graph_file(repo).is_file():
        _note(f"no graph.json in {repo}: nothing to mirror")
        return False
    conn = mstore.connect(paths.db_path())
    try:
        sync.sync_repo(conn, repo, pending)
    except sync.GraphError as err:
        _note(f"graph sync failed: {err}")
        return False
    finally:
        conn.close()
    return True


def refresh(repo) -> int:
    repo = Path(repo).resolve()
    lock = lock_for(repo)
    lock.parent.mkdir(parents=True, exist_ok=True)
    marker = Path(f"{lock}.pending")
    if not gl._acquire(lock):
        marker.touch()
        if not gl._acquire(lock):  # the holder may have released between our failed acquire and the marker
            return 75
    ok = True
    try:
        while True:
            marker.unlink(missing_ok=True)
            ok = _once(repo)
            if not marker.exists():
                break
    finally:
        shutil.rmtree(lock, ignore_errors=True)
    return 0 if ok else 2


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="amauta.graph.refresh", description="Refresh one project's graphify graph and mirror it into memory.db.")
    parser.add_argument("--repo", required=True)
    args = parser.parse_args(argv)
    repo = Path(args.repo)
    if not repo.is_dir():
        sys.stderr.write(f"amauta.graph.refresh: not a directory: {repo}\n")
        return 2
    return refresh(repo)


if __name__ == "__main__":
    raise SystemExit(main())
