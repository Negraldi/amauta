"""Windows (plan M2, ADR 0011): a step runs in a job object, so its timeout, a cancel and its end stop every process
it started, even one that outlives its main process. Runs on the Windows CI job (test/portable.json); skipped
elsewhere, where process groups do the same (test_pipelines_dag.RobustRunTest)."""

import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

from python.amauta.extras.pipelines import pidinfo, runner

PY = sys.executable
SPAWN = ("import subprocess, sys; p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'], creationflags=0x08000000); "
         "open(sys.argv[1], 'w').write(str(p.pid))")


@unittest.skipUnless(sys.platform == "win32", "Windows job objects")
class WindowsJobTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name).resolve() / "repo"
        (self.repo / ".amauta").mkdir(parents=True)
        self.pidfile = Path(self.tmp.name) / "child.pid"

    def define(self, step):
        (self.repo / ".amauta" / "pipelines.json").write_text(json.dumps({"pipelines": [{"id": "p", "steps": [step]}]}))

    def run_step(self):
        events = Path(self.tmp.name) / f"{time.time_ns()}.jsonl"
        t0 = time.time()
        runner.run(self.repo, "p", events, python=PY)
        ends = [json.loads(x) for x in events.read_text().split("\n") if x]
        return time.time() - t0, next(e["status"] for e in ends if e["kind"] == "step-end")

    def child_alive(self):
        time.sleep(0.5)
        return pidinfo.alive(int(self.pidfile.read_text()))

    def test_a_child_that_outlives_its_step_is_stopped(self):
        self.define({"id": "a", "type": "command", "argv": [PY, "-c", SPAWN, str(self.pidfile)], "timeout": 20})
        took, status = self.run_step()
        self.assertEqual(status, "ok")
        self.assertLess(took, 10, "the child held the output open")
        self.assertFalse(self.child_alive())

    def test_a_timeout_stops_the_whole_tree(self):
        hold = SPAWN + "; import time; time.sleep(30)"
        self.define({"id": "a", "type": "command", "argv": [PY, "-c", hold, str(self.pidfile)], "timeout": 2})
        took, status = self.run_step()
        self.assertEqual(status, "timeout")
        self.assertLess(took, 10)
        self.assertFalse(self.child_alive())


if __name__ == "__main__":
    unittest.main()
