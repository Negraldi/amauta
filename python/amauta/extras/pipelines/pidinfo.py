"""Who a process id is (ADR 0011): whether it is alive and when it started, so a lock can tell its own runner from a
later process that was given the same pid. Never signals a process (on Windows os.kill would terminate it).

`started_at` returns an opaque value that is equal for one process and differs for another one with the same pid:
the start tick from /proc on Linux, `ps -o lstart` elsewhere on POSIX, the creation time on Windows; None when the
system does not say (then only liveness counts).
"""

import os
import subprocess
import sys


def _win_process(pid, query):
    """Open the process for a query; (kernel32, handle, error code)."""
    import ctypes

    from . import winjob
    k32 = winjob.kernel32()
    handle = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return k32, None, ctypes.get_last_error()
    try:
        return k32, query(k32, handle), 0
    finally:
        k32.CloseHandle(handle)


def alive(pid):
    if type(pid) is not int or pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        def code(k32, handle):
            out = ctypes.wintypes.DWORD()
            k32.GetExitCodeProcess(handle, ctypes.byref(out))
            return out.value
        _, value, err = _win_process(pid, code)
        return err == 5 if value is None else value == 259  # access denied: someone else's; 259: STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return not _zombie(pid)  # an exited child nobody waited for still answers signal 0


def _zombie(pid):
    try:
        with open(f"/proc/{pid}/stat", encoding="utf-8") as f:
            return f.read().rsplit(")", 1)[1].split()[0] == "Z"
    except (OSError, IndexError):
        pass
    r = _ps(pid, "stat=")
    return r is not None and r.startswith("Z")


def _ps(pid, field):
    """One `ps` field in a fixed locale and time zone (its dates depend on both), or None."""
    env = {"LC_ALL": "C", "TZ": "UTC0", "PATH": os.environ.get("PATH", "/bin:/usr/bin")}
    try:
        r = subprocess.run(["ps", "-o", field, "-p", str(pid)], capture_output=True, text=True, timeout=5, env=env)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None


def started_at(pid):
    if type(pid) is not int or pid <= 0:
        return None
    if sys.platform == "win32":
        import ctypes

        def created(k32, handle):
            times = [ctypes.wintypes.FILETIME() for _ in range(4)]
            ok = k32.GetProcessTimes(handle, *(ctypes.byref(t) for t in times))
            return f"win:{(times[0].dwHighDateTime << 32) | times[0].dwLowDateTime}" if ok else None
        return _win_process(pid, created)[1]
    try:
        with open(f"/proc/{pid}/stat", encoding="utf-8") as f:
            return "linux:" + f.read().rsplit(")", 1)[1].split()[19]  # field 22: start time in clock ticks after boot
    except (OSError, IndexError):
        pass
    r = _ps(pid, "lstart=")
    return f"ps:{r}" if r else None
