"""One step's process (ADR 0010, review R4-R6): its argv (never a shell), environment and working folder; reading its
output line by line; stopping its whole process tree on timeout or cancel.

A step owns its processes: on POSIX its own process group, on Windows a job object (winjob.py). Timeout and cancel
stop them all, and once the main process exits the rest is stopped too, so a background child cannot hold the step
open past its end or its timeout.
Paths of scripts and notebooks are taken from the project root; `cwd` only sets the working folder.
"""

import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

WINDOWS = sys.platform == "win32"
AMAUTA_PYTHON = str(Path(__file__).resolve().parents[3])  # the folder amauta adds to PYTHONPATH for its own modules


class Escape(ValueError):
    """A path that leads outside the project."""


def inside(repo, rel):
    """The real path of `rel` under the project, refusing a symlink (or anything) that leads outside it."""
    root = Path(os.path.realpath(repo))
    real = Path(os.path.realpath(root / rel))
    if real != root and root not in real.parents:
        raise Escape(f"{rel} leads outside the project ({real})")
    return real


def argv_for(step, repo, python):
    if step["type"] == "command":
        return list(step["argv"])
    if step["type"] in ("python", "r"):
        default = python if step["type"] == "python" else "Rscript"
        return [step.get("interpreter") or default, str(inside(repo, step["script"])), *step["args"]]
    nb = inside(repo, step["path"])
    out = f"{nb.stem}.run.ipynb"  # the source notebook is never overwritten
    return ["jupyter", "nbconvert", "--to", "notebook", "--execute", "--output", out, str(nb)]


def step_env(extra):
    """The caller's environment for a step, with the user's own PYTHONPATH (amauta's module folder removed)."""
    env = dict(os.environ)
    given = env.pop("AMAUTA_USER_PYTHONPATH", None)
    given = env.get("PYTHONPATH", "") if given is None else given
    user = os.pathsep.join(p for p in given.split(os.pathsep) if p and os.path.realpath(p) != os.path.realpath(AMAUTA_PYTHON))
    if user:
        env["PYTHONPATH"] = user
    else:
        env.pop("PYTHONPATH", None)
    return {**env, **extra}


class _Tree:
    """A step's processes: its POSIX process group, or its Windows job (taskkill /T when no job could be made)."""

    def __init__(self, proc):
        self.proc, self.job = proc, None
        if WINDOWS:
            try:
                from . import winjob
                job = winjob.Job()
                self.job = job if job.add(proc) else job.close()
            except OSError:
                self.job = None

    def stop(self):
        """Stop every process of the step (timeout, cancel)."""
        try:
            if self.job:
                self.job.stop()
            elif WINDOWS:
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(self.proc.pid)], capture_output=True)
            else:
                os.killpg(self.proc.pid, signal.SIGTERM)
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    os.killpg(self.proc.pid, 0)  # raises once the whole group is gone
                    time.sleep(0.1)
                os.killpg(self.proc.pid, signal.SIGKILL)
        except (OSError, ProcessLookupError):
            pass

    def sweep(self):
        """Stop what the step left running once its main process ended."""
        try:
            if self.job:
                self.job.stop()
            elif not WINDOWS:
                os.killpg(self.proc.pid, signal.SIGKILL)
        except (OSError, ProcessLookupError):
            pass

    def close(self):
        self.sweep()
        if self.job:
            self.job.close()


def _watch(tree, timeout, cancel, done, stop):
    """Until the output closes: stop the tree on timeout or cancel; stop leftovers once the main process ends."""
    deadline, swept = time.monotonic() + timeout, False
    while not done.is_set():
        if cancel.exists() or time.monotonic() > deadline:
            stop["why"] = "cancelled" if cancel.exists() else "timeout"
            tree.stop()
            return
        if tree.proc.poll() is not None and not swept:
            swept = True
            tree.sweep()  # what the step left running in the background
        time.sleep(0.1)


def run(step, repo, python, env, cancel, on_line):
    """Run one attempt of a step; "ok", "failed", "timeout" or "cancelled". Each output line goes to `on_line`."""
    cwd = Path(repo) / step["cwd"]
    if not cwd.is_dir():
        on_line(f"cwd {step['cwd']} is not a folder")
        return "failed"
    try:
        argv = argv_for(step, repo, python)
        flags = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | 0x08000000} if WINDOWS else {"start_new_session": True}
        proc = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", **flags)
    except Escape as e:
        on_line(str(e))
        return "failed"
    except OSError as e:
        on_line(f"cannot start {argv[0]}: {e.strerror or e}")
        return "failed"
    tree = _Tree(proc)
    done, stop = threading.Event(), {"why": None}
    watcher = threading.Thread(target=_watch, args=(tree, step["timeout"], cancel, done, stop), daemon=True)
    watcher.start()
    try:
        with proc.stdout:
            for raw in proc.stdout:
                on_line(raw)
    finally:
        done.set()
        proc.wait()
        watcher.join(timeout=5)
        tree.close()  # a step owns its processes: stop what it left behind, with or without its output
    return stop["why"] or ("ok" if proc.returncode == 0 else "failed")
