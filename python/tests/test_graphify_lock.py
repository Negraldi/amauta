import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from python.gentle_lite.graph import lock as gl

from .test_semantic_plan import Base, run_main

HAS_PROC = Path("/proc/self/stat").exists()


def git_repo(base: Path) -> Path:
    repo = base / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    return repo


def dead_pid() -> int:
    p = subprocess.Popen([sys.executable, "-c", "pass"])
    p.wait()
    return p.pid


def age(path: Path, minutes: int) -> None:
    t = time.time() - minutes * 60
    os.utime(path, (t, t))


class LockModuleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = git_repo(Path(self.tmp.name))
        self.lock = gl.lock_path(self.repo)

    def test_lock_path_is_the_git_path_the_hook_uses(self):
        out = subprocess.run(["git", "-C", str(self.repo), "rev-parse", "--git-path", "gentle-lite-graphify.lock"], capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(self.lock, (self.repo / out).resolve())

    def test_not_a_git_repo_means_no_lock(self):
        plain = Path(self.tmp.name) / "plain"
        plain.mkdir()
        self.assertIsNone(gl.lock_path(plain))
        with gl.graphify_lock(plain):
            pass

    def test_acquire_writes_pid_and_start_token_and_release_removes_it(self):
        with gl.graphify_lock(self.repo):
            fields = (self.lock / "pid").read_text().split()
            self.assertEqual(fields[0], str(os.getpid()))
            if HAS_PROC:
                self.assertEqual(len(fields), 2)
                self.assertEqual(fields[1], gl.start_token(os.getpid()))
        self.assertFalse(self.lock.exists())

    def test_released_even_when_the_body_raises(self):
        with self.assertRaises(RuntimeError):
            with gl.graphify_lock(self.repo):
                raise RuntimeError("boom")
        self.assertFalse(self.lock.exists())

    def test_held_lock_fails_fast_with_a_clear_message(self):
        with gl.graphify_lock(self.repo):
            with self.assertRaises(gl.LockHeld) as ctx:
                with gl.graphify_lock(self.repo):
                    pass
        self.assertIn("already running", str(ctx.exception))
        self.assertIn(str(self.lock), str(ctx.exception))

    def held_by(self, pid_line: str, minutes: int):
        self.lock.mkdir()
        (self.lock / "pid").write_text(pid_line)
        age(self.lock, minutes)

    def test_young_lock_of_a_dead_owner_is_still_held(self):
        self.held_by(f"{dead_pid()}\n", 1)
        with self.assertRaises(gl.LockHeld):
            with gl.graphify_lock(self.repo):
                pass

    def test_old_lock_of_a_dead_owner_is_taken_over(self):
        self.held_by(f"{dead_pid()}\n", 20)
        with gl.graphify_lock(self.repo):
            self.assertEqual((self.lock / "pid").read_text().split()[0], str(os.getpid()))

    def test_old_lock_without_a_pid_file_is_taken_over(self):
        self.lock.mkdir()
        age(self.lock, 20)
        with gl.graphify_lock(self.repo):
            pass

    def test_old_lock_of_a_live_owner_is_never_taken_over(self):
        tok = gl.start_token(os.getpid())
        self.held_by(f"{os.getpid()} {tok}\n" if tok else f"{os.getpid()}\n", 20)
        with self.assertRaises(gl.LockHeld):
            with gl.graphify_lock(self.repo):
                pass

    @unittest.skipUnless(HAS_PROC, "needs /proc")
    def test_reused_pid_with_another_start_token_is_stale(self):
        self.held_by(f"{os.getpid()} some-other-boot:1\n", 20)
        with gl.graphify_lock(self.repo):
            pass


class LockedCommandsTest(Base):
    def setUp(self):
        super().setUp()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        self.lock = gl.lock_path(self.repo)
        self.lock.mkdir()
        (self.lock / "pid").write_text(f"{os.getpid()}\n")

    def test_merge_fails_fast_while_the_lock_is_held(self):
        code, out, err = run_main("merge", "--repo", str(self.repo))
        self.assertEqual(code, 75)  # EXIT_LOCKED
        self.assertIn("already running", err)
        self.assertEqual(out, "")

    def test_plan_fails_fast_while_the_lock_is_held(self):
        code, _, err = run_main("plan", "--repo", str(self.repo), "--graphify-bin", str(self.fake.exe), "--skip-update")
        self.assertEqual(code, 75)  # EXIT_LOCKED
        self.assertIn("already running", err)
        self.assertFalse((self.repo / "graphify-out").exists(), "nothing written while the lock is held")


if __name__ == "__main__":
    unittest.main()
