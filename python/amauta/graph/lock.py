"""The per-repo graphify lock, shared by every Python writer of graphify-out (plan, save-chunk, merge).

This module is the ONLY implementation of the protocol. The post-commit hook (src/graphify/hook.js, a shell block) and
`amauta graphify semantic` (src/graphify/semantic.js) do not reimplement it: they run
`python3 -P -m amauta.graph.lock acquire --lock PATH --pid OWNER_PID` (exit 0 acquired, 75 held) and release by removing
the directory. So all writers are mutually exclusive across languages, with one format:

  path   `git rev-parse --git-path amauta-graphify.lock` (a directory; mkdir is the atomic acquire)
  owner  `<lock>/pid` holds `<pid> <start-token>\\n`; the token is `<boot_id>:<starttime>` read from /proc (Linux), absent
         without /proc. A pid file with only `<pid>` is honoured (no token check).
  pending `<lock>.pending` is the hook's "run again" marker (shell only; see hook.js).
  stale  only when the directory is older than 15 minutes AND its owner is gone: no readable pid, pid not running, or a
         recorded token that differs from the live process' token (a pid reused after SIGKILL or a reboot). A live
         owner is never taken over, however old the lock.
  guard  `<lock>.takeover` (a directory) serialises takeovers: only the taker whose mkdir created it re-checks the
         verdict and retires the stale lock (renamed to a unique `<lock>.stale.*` tombstone, then removed). A lock that a
         rival created after our first verdict is fresh, so the re-check under the guard never moves a live lock (moving
         and putting back could replace a third writer's brand-new empty lock dir: two winners). A taker that finds the
         guard held reports held. A guard older than 10 minutes is abandoned (its taker died mid-takeover) and is
         removed. Takeover is attempted at most 3 times.

A held lock fails fast (LockHeld); nothing waits.
"""
from __future__ import annotations

import contextlib
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

LOCK_NAME = "amauta-graphify.lock"
STALE_SECONDS = 15 * 60
TAKEOVER_ATTEMPTS = 3
GUARD_STALE_SECONDS = 10 * 60
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


def _guard_path(lock: Path) -> Path:
    return lock.with_name(f"{lock.name}.takeover")


def _enter_guard(guard: Path) -> bool:
    """Create the takeover guard; clear it once first when a dead taker abandoned it."""
    for _ in range(2):
        try:
            os.mkdir(guard)
            return True
        except FileExistsError:
            try:
                abandoned = time.time() - guard.stat().st_mtime > GUARD_STALE_SECONDS
            except OSError:
                continue  # released meanwhile: try again
            if not abandoned:
                return False
            with contextlib.suppress(OSError):
                os.rmdir(guard)
        except OSError:
            return False
    return False


def _take_over(lock: Path) -> bool:
    """Retire a stale lock under the takeover guard; True only when this taker removed a lock that is stale right now."""
    guard = _guard_path(lock)
    if not _enter_guard(guard):
        return False  # another takeover is in progress: held
    try:
        if not _stale(lock):
            return False  # a rival already replaced it with a fresh lock: never move a live lock
        tomb = lock.with_name(f"{lock.name}.stale.{os.getpid()}.{uuid.uuid4().hex}")
        try:
            os.rename(lock, tomb)
        except OSError:
            return False  # cannot be moved (or vanished): not our takeover
        _remove(tomb)
        return True
    finally:
        with contextlib.suppress(OSError):
            os.rmdir(guard)


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
        except BaseException:  # incl. KeyboardInterrupt / SystemExit from a signal handler
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

    parser = argparse.ArgumentParser(prog="amauta.graph.lock", description="Take the per-repo graphify lock for another process.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    acq = sub.add_parser("acquire", help="take the lock for --pid (the caller removes the directory to release it)")
    acq.add_argument("--lock", required=True, help="absolute lock path (git rev-parse --git-path amauta-graphify.lock)")
    acq.add_argument("--pid", type=int, required=True, help="the owner process that will hold the lock")
    args = parser.parse_args(argv)
    lock = Path(args.lock)
    if _acquire(lock, args.pid):
        return 0
    print(f"a graphify refresh is already running for this repository (lock {lock}); wait for it to finish and run this again", file=sys.stderr)
    return EXIT_LOCKED


if __name__ == "__main__":
    raise SystemExit(main())
