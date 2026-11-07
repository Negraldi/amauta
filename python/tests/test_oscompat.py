"""Platform layer, Python side (plan N8): process liveness without os.kill on Windows, start tokens, exit signals."""
import os
import signal
import subprocess
import sys
import types
import unittest

from python.amauta import oscompat


class FakeKernel32:
    """Windows API stand-in: process 7 is running, 8 has exited, anything else cannot be opened."""

    def __init__(self):
        self.closed = []

    def OpenProcess(self, access, inherit, pid):
        return {7: 70, 8: 80}.get(pid, 0)

    def GetExitCodeProcess(self, handle, out):
        out._obj.value = 259 if handle == 70 else 0
        return 1

    def CloseHandle(self, handle):
        self.closed.append(handle)
        return 1


class LivenessTest(unittest.TestCase):
    def test_posix_liveness_of_this_process_and_of_a_reaped_child(self):
        self.assertTrue(oscompat.pid_alive(os.getpid()))
        child = subprocess.Popen([sys.executable, "-c", "pass"])
        child.wait()
        self.assertFalse(oscompat.pid_alive(child.pid))

    def test_windows_liveness_uses_the_process_handle_and_never_signals(self):
        k = FakeKernel32()
        self.assertTrue(oscompat.pid_alive(7, platform="win32", kernel32=k))
        self.assertFalse(oscompat.pid_alive(8, platform="win32", kernel32=k))
        self.assertFalse(oscompat.pid_alive(9, platform="win32", kernel32=k))
        self.assertEqual(sorted(k.closed), [70, 80])


class SignalsTest(unittest.TestCase):
    def test_exit_signals_are_the_ones_this_platform_has(self):
        self.assertIn(signal.SIGTERM, oscompat.exit_signals())
        windows_like = types.SimpleNamespace(SIGTERM=15)  # no SIGHUP on Windows
        self.assertEqual(oscompat.exit_signals(windows_like), [15])


class StartTokenTest(unittest.TestCase):
    def test_start_token_is_stable_for_a_live_process_and_empty_for_none(self):
        self.assertEqual(oscompat.start_token(os.getpid()), oscompat.start_token(os.getpid()))
        self.assertEqual(oscompat.start_token(-1), "")
