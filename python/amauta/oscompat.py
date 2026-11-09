"""Platform layer, Python side (plan N8, ADR 0003): the few process facts that differ on Windows.

- `pid_alive(pid)`: POSIX probes with signal 0; Windows opens the process handle instead, because `os.kill(pid, 0)`
  there sends CTRL_C_EVENT to the process group rather than probing.
- `start_token(pid)`: boot id and start time from /proc on Linux, creation time on Windows, '' when unknown; a pid
  reused after a reboot or crash then no longer matches a recorded token.
- `exit_signals()`: the termination signals this platform has (no SIGHUP on Windows).

No side effects; every function fails closed to "unknown" (False or '').
"""
from __future__ import annotations

import ctypes
import os
import signal as _signal
import sys
from pathlib import Path

_SYNCHRONIZE_QUERY = 0x00100000 | 0x1000  # SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION
_STILL_ACTIVE = 259


def _kernel32():
    return ctypes.windll.kernel32  # type: ignore[attr-defined]  # only reached on Windows


def pid_alive(pid: int, platform: str = sys.platform, kernel32=None) -> bool:
    if pid <= 0:
        return False
    if platform == "win32":
        k = kernel32 or _kernel32()
        handle = k.OpenProcess(_SYNCHRONIZE_QUERY, False, pid)
        if not handle:
            return False
        try:
            code = ctypes.c_ulong(0)
            return bool(k.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == _STILL_ACTIVE
        finally:
            k.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _windows_creation_time(pid: int) -> str:
    k = _kernel32()
    handle = k.OpenProcess(_SYNCHRONIZE_QUERY, False, pid)
    if not handle:
        return ""
    try:
        times = [ctypes.c_ulonglong(0) for _ in range(4)]
        if not k.GetProcessTimes(handle, *[ctypes.byref(t) for t in times]):
            return ""
        return f"win:{times[0].value}"
    finally:
        k.CloseHandle(handle)


def start_token(pid: int, platform: str = sys.platform) -> str:
    if pid <= 0:
        return ""
    if platform == "win32":
        try:
            return _windows_creation_time(pid)
        except (OSError, AttributeError):
            return ""
    try:
        boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        stat = Path(f"/proc/{pid}/stat").read_text()
        return f"{boot}:{stat.rsplit(') ', 1)[1].split()[19]}"
    except (OSError, IndexError):
        return ""


def exit_signals(signal_module=_signal) -> list:
    """SIGTERM, plus SIGHUP where the platform has it."""
    return [getattr(signal_module, name) for name in ("SIGTERM", "SIGHUP") if hasattr(signal_module, name)]
