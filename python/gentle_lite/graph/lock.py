"""The per-repo graphify lock, shared by every Python writer of graphify-out (plan, save-chunk, merge).

This module is the ONLY implementation of the protocol. The post-commit hook (src/graphify/hook.js, a shell block) and
`gentle-lite graphify semantic` (src/graphify/semantic.js) do not reimplement it: they run
`python3 -P -m gentle_lite.graph.lock acquire --lock PATH --pid OWNER_PID` (exit 0 acquired, 75 held) and release by removing
the directory. So all writers are mutually exclusive across languages, with one format:

  path   `git rev-parse --git-path gentle-lite-graphify.lock` (a directory; mkdir is the atomic acquire)
  owner  `<lock>/pid` holds `<pid> <start-token>\\n`; the token is `<boot_id>:<starttime>` read from /proc (Linux), absent
         without /proc. A pid file with only `<pid>` is honoured (no token check).
  pending `<lock>.pending` is the hook's "run again" marker (shell only; see hook.js).
  stale  only when the directory is older than 15 minutes AND its owner is gone: no readable pid, pid not running, or a
         recorded token that differs from the live process' token (a pid reused after SIGKILL or a reboot). A live
         owner is never taken over, however old the lock. Takeover is attempted at most 3 times and is atomic: the stale
         directory is renamed to a unique `<lock>.stale.*` tombstone, and only the taker whose rename succeeded removes it
         and creates the new lock. A taker whose rename moved a lock that proves not stale (a rival finished its own
         takeover between our verdict and our rename) puts it back and reports held. Residual window: a third writer
         creating the lock exactly while it is put back.

A held lock fails fast (LockHeld); nothing waits.
"""
from __future__ import annotations

import contextlib
import os
import shutil
import signal
import subprocess
import threading
import time
import uuid
from pathlib import Path

LOCK_NAME = "gentle-lite-graphify.lock"
STALE_SECONDS = 15 * 60
TAKEOVER_ATTEMPTS = 3
GIT_TIMEOUT = 20


class LockHeld(RuntimeError):
    pass


def lock_path(repo: Path) -> Path | None:
    """Absolute lock path for the repository containing `repo`, or None when it is not a git repository."""
    try:
        proc = subprocess.run(["git", "-C", str(repo), "rev-parse", "--git-path", LOCK_NAME], capture_output=True, text=True, timeout=GIT_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired):
        return None
    out = proc.stdout.strip()
    if proc.returncode != 0 or not out:
        return None
    return (Path(repo) / out).resolve()


def start_token(pid: int) -> str:
    """`<boot_id>:<starttime>` of a process from /proc, or '' when unavailable (same format as the hook's ptok)."""
    try:
        boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        stat = Path(f"/proc/{pid}/stat").read_text()
        fields = stat.rsplit(") ", 1)[1].split()
        return f"{boot}:{fields[19]}"
    except (OSError, IndexError):
        return ""


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _stale(lock: Path) -> bool:
    try:
        age = time.time() - lock.stat().st_mtime
    except OSError:
        return False
    if age <= STALE_SECONDS:
        return False
    try:
        parts = (lock / "pid").read_text().split()
    except OSError:
        return True
    try:
        owner = int(parts[0])
    except (IndexError, ValueError):
        return True
    if owner <= 0 or not _alive(owner):
        return True
    recorded = parts[1] if len(parts) > 1 else ""
    return bool(recorded) and start_token(owner) != recorded


def _remove(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path, ignore_errors=True)
    else:
        with contextlib.suppress(OSError):
            path.unlink()


def _take_over(lock: Path) -> bool:
    """Atomically retire a stale lock; True only for the one taker whose rename succeeded on a lock that is really stale."""
    tomb = lock.with_name(f"{lock.name}.stale.{os.getpid()}.{uuid.uuid4().hex}")
    try:
        os.rename(lock, tomb)
    except OSError:
        return False  # somebody else moved it first (ENOENT) or it cannot be moved: not our takeover
    if not _stale(tomb):
        # We moved a live lock: a rival completed its takeover after our verdict. Put it back untouched.
        with contextlib.suppress(OSError):
            os.rename(tomb, lock)
        return False
    _remove(tomb)
    return True


def _acquire(lock: Path, pid: int | None = None) -> bool:
    pid = os.getpid() if pid is None else pid
    for _ in range(TAKEOVER_ATTEMPTS):
        try:
            os.mkdir(lock)
        except FileExistsError:
            if _stale(lock) and _take_over(lock):
                continue
            return False
        try:
            (lock / "pid").write_text(f"{pid} {start_token(pid)}".rstrip() + "\n")
        except OSError:
            shutil.rmtree(lock, ignore_errors=True)  # never leave a lock without an owner record behind
            raise
        return True
    return False


@contextlib.contextmanager
def graphify_lock(repo: Path):
    """Hold the repo's graphify lock for the block; no-op outside a git repository. Raises LockHeld when taken."""
    lock = lock_path(repo)
    if lock is None:
        yield None
        return
    if not _acquire(lock):
        raise LockHeld(f"a graphify refresh is already running for this repository (lock {lock}); wait for it to finish and run this again")
    restore = {}
    if threading.current_thread() is threading.main_thread():
        def bail(signum, _frame):
            raise SystemExit(128 + signum)  # unwinds through `finally`, so the lock is released
        for sig in (signal.SIGTERM, signal.SIGHUP):
            restore[sig] = signal.signal(sig, bail)
    try:
        yield lock
    finally:
        for sig, old in restore.items():
            signal.signal(sig, old)
        shutil.rmtree(lock, ignore_errors=True)


EXIT_LOCKED = 75  # EX_TEMPFAIL


def main(argv: list[str] | None = None) -> int:
    import argparse
    import sys

    parser = argparse.ArgumentParser(prog="gentle_lite.graph.lock", description="Take the per-repo graphify lock for another process.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    acq = sub.add_parser("acquire", help="take the lock for --pid (the caller removes the directory to release it)")
    acq.add_argument("--lock", required=True, help="absolute lock path (git rev-parse --git-path gentle-lite-graphify.lock)")
    acq.add_argument("--pid", type=int, required=True, help="the owner process that will hold the lock")
    args = parser.parse_args(argv)
    lock = Path(args.lock)
    if _acquire(lock, args.pid):
        return 0
    print(f"a graphify refresh is already running for this repository (lock {lock}); wait for it to finish and run this again", file=sys.stderr)
    return EXIT_LOCKED


if __name__ == "__main__":
    raise SystemExit(main())
