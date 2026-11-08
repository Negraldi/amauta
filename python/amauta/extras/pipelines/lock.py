"""One run of a pipeline at a time (review R2, ADR 0011): `<runs dir>/<pipeline>.lock` holds {pid, run, t, starting}.

Whoever starts a run takes the lock atomically (O_CREAT | O_EXCL): the portal before it launches the runner (marked
`starting`), the CLI and a scheduled run directly. The runner adopts a lock taken for its own run by writing its pid,
and removes it when the run ends. A lock whose process is gone, or a `starting` lock never adopted within a minute, is
stale and may be taken again; so is a lock nobody can read after a few seconds (a fresh one is being written).
"""

import json
import os
import sys
import time
from pathlib import Path

ADOPT_WITHIN = 60  # seconds a runner has to adopt the lock the portal took for it


class Busy(RuntimeError):
    """The pipeline is already running."""


def alive(pid):
    """Whether a process with this pid exists (never signals it: on Windows os.kill would terminate it)."""
    if not isinstance(pid, int) or pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        k32 = ctypes.windll.kernel32
        handle = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        k32.GetExitCodeProcess(handle, ctypes.byref(code))
        k32.CloseHandle(handle)
        return code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _read(f):
    try:
        data = json.loads(Path(f).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def _stale(data, f=None):
    if data is None:  # unreadable: being written right now (fresh), or damaged (old)
        try:
            return time.time() - Path(f).stat().st_mtime > 5 if f else True
        except OSError:
            return True
    if data.get("starting") and time.time() - float(data.get("t") or 0) > ADOPT_WITHIN:
        return True
    return not alive(data.get("pid"))


def _create(f, run, starting):
    f.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(f, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        json.dump({"pid": os.getpid(), "run": run, "t": time.time(), "starting": starting}, out)


def take(f, run, starting=False):
    """Take the lock file `f` for `run`; False when a live run holds it."""
    for _ in range(2):
        try:
            _create(Path(f), run, starting)
            return True
        except FileExistsError:
            if not _stale(_read(f), f):
                return False
            Path(f).unlink(missing_ok=True)  # a stale lock: one more try, the other taker may win it
    return False


def adopt(f, run):
    """The runner's side: keep a lock taken for this run (now with its own pid), or take it; Busy otherwise."""
    data = _read(f)
    if data is not None and data.get("run") == run:
        Path(f).write_text(json.dumps({"pid": os.getpid(), "run": run, "t": time.time(), "starting": False}), encoding="utf-8")
        return
    if not take(f, run):
        raise Busy(f"{Path(f).stem} is already running ({(data or {}).get('run', '?')})")


def drop(f, run):
    data = _read(f)
    if data is not None and data.get("run") == run:
        Path(f).unlink(missing_ok=True)


def held_by(f, run):
    data = _read(f)
    return data is not None and data.get("run") == run and not _stale(data, f)


def path(state_dir, repo, pipeline_id):
    from .store import runs_dir  # store reads locks too: imported here to keep the two modules independent
    return runs_dir(state_dir, repo) / f"{pipeline_id}.lock"


def acquire(state_dir, repo, pipeline_id, run, starting=False):
    return take(path(state_dir, repo, pipeline_id), run, starting)


def release(state_dir, repo, pipeline_id, run):
    drop(path(state_dir, repo, pipeline_id), run)


def holds(state_dir, repo, pipeline_id, run):
    return held_by(path(state_dir, repo, pipeline_id), run)
