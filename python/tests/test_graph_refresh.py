import json
import os
import sqlite3
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from python.amauta.graph import lock as gl, refresh

GRAPH = {"nodes": [{"id": "a", "label": "A", "file_type": "code", "source_file": "a.py"}], "links": []}


class RefreshBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / "state"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "graphify.log"
        self.proj = self.root / "proj"
        (self.proj / "graphify-out").mkdir(parents=True)
        (self.proj / "graphify-out" / "graph.json").write_text(json.dumps(GRAPH))
        self.fake("")
        patcher = mock.patch.dict(os.environ, {"PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}", "AMAUTA_STATE_DIR": str(self.state)})
        patcher.start()
        self.addCleanup(patcher.stop)

    def fake(self, body):
        exe = self.bin / "graphify"
        exe.write_text(f'#!/bin/sh\necho "args=$* cwd=$(pwd) log_disable=$GRAPHIFY_QUERY_LOG_DISABLE" >> "{self.log}"\n{body}\n')
        exe.chmod(exe.stat().st_mode | stat.S_IXUSR)

    def calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def mirrored(self):
        try:
            return sqlite3.connect(self.state / "memory.db").execute("select nodes, semantic_pending from graph_sync").fetchone()
        except sqlite3.Error:
            return None

    def git_init(self):
        subprocess.run(["git", "init", "-q", str(self.proj)], check=True)


class RefreshTest(RefreshBase):
    def test_a_non_git_directory_is_updated_and_mirrored_under_a_lock_inside_graphify_out(self):
        self.assertEqual(refresh.refresh(self.proj), 0)
        self.assertIn(f"args=update . cwd={self.proj.resolve()} log_disable=1", self.calls())
        self.assertEqual(self.mirrored(), (1, 0))
        self.assertFalse(refresh.lock_for(self.proj).exists(), "released")
        self.assertEqual(refresh.lock_for(self.proj), self.proj / "graphify-out" / ".amauta-graphify.lock")

    def test_a_git_repository_shares_the_hook_lock(self):
        self.git_init()
        self.assertEqual(refresh.lock_for(self.proj), (self.proj / ".git" / gl.LOCK_NAME).resolve())
        self.assertEqual(refresh.refresh(self.proj), 0)
        self.assertEqual(self.mirrored(), (1, 0))

    def test_a_held_lock_leaves_a_pending_marker_and_runs_nothing(self):
        lock = refresh.lock_for(self.proj)
        lock.mkdir(parents=True)
        (lock / "pid").write_text(f"{os.getpid()}\n")
        self.assertEqual(refresh.refresh(self.proj), 75)
        self.assertEqual(self.calls(), [])
        self.assertTrue(Path(f"{lock}.pending").exists())

    def test_a_pending_marker_left_while_running_reruns_once(self):
        lock = refresh.lock_for(self.proj)
        self.fake(f'[ -e "{self.root}/ran" ] || {{ : > "{self.root}/ran"; : > "{lock}.pending"; }}')
        self.assertEqual(refresh.refresh(self.proj), 0)
        self.assertEqual(len([c for c in self.calls() if c.startswith("args=update")]), 2)
        self.assertFalse(Path(f"{lock}.pending").exists())

    def test_check_update_verdict_is_recorded(self):
        self.fake('case "$1" in check-update) echo "[graphify check-update] Pending non-code changes in x." ;; esac')
        self.assertEqual(refresh.refresh(self.proj), 0)
        self.assertEqual(self.mirrored(), (1, 1))

    def test_a_failing_update_is_logged_and_the_existing_graph_is_still_mirrored(self):
        self.fake('echo boom >&2; exit 3')
        self.assertEqual(refresh.refresh(self.proj), 0)
        self.assertIn("graphify update failed", (self.state / "graphify-hook.log").read_text())
        self.assertEqual(self.mirrored()[0], 1)

    def test_without_a_graph_nothing_is_mirrored_and_the_exit_is_an_error(self):
        (self.proj / "graphify-out" / "graph.json").unlink()
        self.fake("")
        self.assertEqual(refresh.refresh(self.proj), 2)
        self.assertIsNone(self.mirrored())
        self.assertFalse(refresh.lock_for(self.proj).exists())

    def test_cli_entrypoint(self):
        env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[2] / "python")}
        r = subprocess.run(["python3", "-P", "-m", "amauta.graph.refresh", "--repo", str(self.proj)], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.mirrored(), (1, 0))


if __name__ == "__main__":
    unittest.main()
