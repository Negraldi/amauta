"""The per-repo graphify lock, shared by every Python writer of graphify-out (plan, save-chunk, merge).

It is the same lock the post-commit hook (src/graphify/hook.js, a shell block) and `gentle-lite graphify semantic`
(src/graphify/semantic.js) take, so all writers are mutually exclusive across languages:

  path   `git rev-parse --git-path gentle-lite-graphify.lock` (a directory; mkdir is the atomic acquire)
  owner  `<lock>/pid` holds `<pid> <start-token>\\n`; the token is `<boot_id>:<starttime>` read from /proc (Linux), absent
         without /proc. Older writers (semantic.js) record only `<pid>\\n`.
  stale  only when the directory is older than 15 minutes AND its owner is gone: no readable pid, pid not running, or a
         recorded token that differs from the live process' token (a pid reused after SIGKILL or a reboot). A live
         owner is never taken over, however old the lock. Takeover is attempted at most 3 times.

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


def _acquire(lock: Path) -> bool:
    for _ in range(TAKEOVER_ATTEMPTS):
        try:
            os.mkdir(lock)
        except FileExistsError:
            if _stale(lock):
                shutil.rmtree(lock, ignore_errors=True)
                continue
            return False
        (lock / "pid").write_text(f"{os.getpid()} {start_token(os.getpid())}".rstrip() + "\n")
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
