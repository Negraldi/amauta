"""One run of a pipeline at a time (review R2, ADR 0011): `<runs dir>/<pipeline>.lock` holds {pid, run, t, starting}.

Whoever starts a run takes the lock atomically (O_CREAT | O_EXCL): the portal before it launches the runner (marked
`starting`), the CLI and a scheduled run directly. The runner adopts a lock taken for its own run by writing its pid,
and removes it when the run ends. A lock whose process is gone, or a `starting` lock never adopted within a minute, is
stale and may be taken again; so is a lock nobody can read after a few seconds (a fresh one is being written).
Replacing a stale lock happens under `<lock>.guard` (an OS file lock), so of many takers exactly one wins; adopting
writes a new file and renames it over the lock, so a reader never sees it empty. The lock records when its process
started (pidinfo.py): a pid given to another process later does not keep it held.
"""

import json
import os
import sys
import time
from pathlib import Path

from . import pidinfo

ADOPT_WITHIN = 60  # seconds a runner has to adopt the lock the portal took for it


class Busy(RuntimeError):
    """The pipeline is already running."""


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
    try:
        age = time.time() - float(data.get("t") or 0)
    except (TypeError, ValueError):
        return True  # damaged
    if data.get("starting") and age > ADOPT_WITHIN:
        return True
    pid, recorded = data.get("pid"), data.get("pid_start")
    if not pidinfo.alive(pid):
        return True
    now = pidinfo.started_at(pid) if isinstance(recorded, str) else None
    same_way = now is not None and now.split(":", 1)[0] == recorded.split(":", 1)[0]  # /proc, ps and Windows differ
    return same_way and now != recorded  # the pid was given to another process


def _record(run, starting):
    return {"pid": os.getpid(), "pid_start": pidinfo.started_at(os.getpid()), "run": run, "t": time.time(), "starting": starting}


def _create(f, run, starting):
    f.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(f, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        json.dump(_record(run, starting), out)


class _Guard:
    """An exclusive OS lock on `<lock>.guard` while a stale lock is checked and replaced."""

    def __init__(self, f):
        self.path = Path(f"{f}.guard")

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        if sys.platform == "win32":
            import msvcrt
            while True:
                try:
                    msvcrt.locking(self.fd, msvcrt.LK_LOCK, 1)
                    break
                except OSError:
                    continue  # LK_LOCK gives up after ten seconds; keep waiting
        else:
            import fcntl
            fcntl.flock(self.fd, fcntl.LOCK_EX)
        return self

    def __exit__(self, *_):
        os.close(self.fd)  # closing releases the OS lock on every platform


def take(f, run, starting=False):
    """Take the lock file `f` for `run`; False when a live run holds it."""
    f = Path(f)
    try:
        _create(f, run, starting)
        return True
    except FileExistsError:
        pass
    with _Guard(f):  # only a stale lock is removed, and only here, one taker at a time
        if not _stale(_read(f), f):
            return False
        f.unlink(missing_ok=True)
        try:
            _create(f, run, starting)
            return True
        except FileExistsError:
            return False  # a taker on the fast path won in between


def adopt(f, run):
    """The runner's side: keep a lock taken for this run (now with its own pid), or take it; Busy otherwise."""
    with _Guard(f):  # no taker replaces a stale lock between this read and the rename
        data = _read(f)
        if data is not None and data.get("run") == run:
            tmp = Path(f"{f}.{os.getpid()}.tmp")
            tmp.write_text(json.dumps(_record(run, False)), encoding="utf-8")
            os.replace(tmp, f)  # atomic: readers see the old or the new content, never an empty file
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
