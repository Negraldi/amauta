"""A Windows job object for one step (plan M2, ADR 0011), through ctypes (stdlib only). Every process the step starts
belongs to its job, so `stop()` ends them all, including a child that outlived the step's main process; closing the
job does the same (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE). A process created in the moment before it is added to the job
can escape it; `taskkill /T` stays the fallback when a job cannot be created.
"""

import ctypes
from ctypes import wintypes

KILL_ON_JOB_CLOSE = 0x2000
EXTENDED_LIMIT_INFORMATION = 9


class _Basic(ctypes.Structure):
    _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]


class _Io(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in ("ReadOps", "WriteOps", "OtherOps", "ReadBytes", "WriteBytes", "OtherBytes")]


class _Extended(ctypes.Structure):
    _fields_ = [("BasicLimitInformation", _Basic), ("IoInfo", _Io), ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t)]


def _kernel32():
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateJobObjectW.restype = wintypes.HANDLE
    k32.CreateJobObjectW.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
    k32.SetInformationJobObject.argtypes = (wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD)
    k32.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
    k32.TerminateJobObject.argtypes = (wintypes.HANDLE, wintypes.UINT)
    k32.CloseHandle.argtypes = (wintypes.HANDLE,)
    return k32


class Job:
    """A job holding one step's processes. `add(popen)` right after starting it; `stop()`; `close()` when done."""

    def __init__(self):
        self.k32 = _kernel32()
        self.handle = self.k32.CreateJobObjectW(None, None)
        if not self.handle:
            raise OSError(ctypes.get_last_error(), "CreateJobObject failed")
        info = _Extended()
        info.BasicLimitInformation.LimitFlags = KILL_ON_JOB_CLOSE
        if not self.k32.SetInformationJobObject(self.handle, EXTENDED_LIMIT_INFORMATION, ctypes.byref(info), ctypes.sizeof(info)):
            self.close()  # without kill-on-close the job would not stop a step's processes if the runner died
            raise OSError(ctypes.get_last_error(), "SetInformationJobObject failed")

    def add(self, popen):
        """True once the process belongs to the job (Popen keeps its process handle in `_handle`)."""
        return bool(self.k32.AssignProcessToJobObject(self.handle, wintypes.HANDLE(int(popen._handle))))

    def stop(self):
        self.k32.TerminateJobObject(self.handle, 1)

    def close(self):
        if self.handle:
            self.k32.CloseHandle(self.handle)  # KILL_ON_JOB_CLOSE ends whatever is left
            self.handle = None
