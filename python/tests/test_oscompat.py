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


class FakeProc:
    pid = 4321

    def __init__(self):
        self.killed = 0

    def kill(self):
        self.killed += 1


class KillTreeTest(unittest.TestCase):
    def test_windows_kills_the_child_without_process_groups(self):
        proc, groups = FakeProc(), []
        oscompat.kill_tree(proc, platform="win32", killpg=lambda pid, sig: groups.append(pid))
        self.assertEqual((proc.killed, groups), (1, []))

    def test_posix_kills_the_whole_group(self):
        proc, groups = FakeProc(), []
        oscompat.kill_tree(proc, platform="linux", killpg=lambda pid, sig: groups.append((pid, sig)))
        self.assertEqual(groups, [(4321, getattr(signal, "SIGKILL", signal.SIGTERM))])  # Windows has no SIGKILL
        self.assertEqual(proc.killed, 0)

    def test_posix_falls_back_to_the_child_when_the_group_is_gone(self):
        proc = FakeProc()

        def gone(pid, sig):
            raise ProcessLookupError

        oscompat.kill_tree(proc, platform="linux", killpg=gone)
        self.assertEqual(proc.killed, 1)


class ChildEnvTest(unittest.TestCase):
    ENV = {"PATH": "/bin", "USERPROFILE": "C:\\Users\\dev", "SYSTEMROOT": "C:\\Windows", "APPDATA": "C:\\AppData", "SECRET": "x"}

    def test_windows_keeps_the_variables_node_and_npm_need(self):
        env = oscompat.child_env(self.ENV, ("PATH", "HOME"), platform="win32")
        self.assertEqual(env, {"PATH": "/bin", "USERPROFILE": "C:\\Users\\dev", "SYSTEMROOT": "C:\\Windows", "APPDATA": "C:\\AppData"})

    def test_posix_keeps_only_the_listed_names(self):
        self.assertEqual(oscompat.child_env(self.ENV, ("PATH", "HOME"), platform="linux"), {"PATH": "/bin"})
