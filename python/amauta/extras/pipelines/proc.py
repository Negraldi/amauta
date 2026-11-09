"""One attempt of one step (ADR 0010, 0011): its argv (never a shell), environment and working folder; its output
read line by line in a thread; its processes stopped on timeout, cancel and at its end.

A step owns its processes: a process group on POSIX, a job object on Windows (winjob.py), together `_Tree`. Once the
main process ends, what it left running in the tree is stopped. A process that left the tree (its own session) and
still holds the output is given up on after GRACE seconds, with a line saying so; it keeps running.
Scripts and notebooks resolve from the project root and may not lead outside it; `cwd` only sets the working folder.
Steps get the caller's environment with the user's own PYTHONPATH (amauta's module folder removed).
"""

import os
import shutil
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


def without_amauta(pythonpath):
    """A PYTHONPATH value without amauta's own module folder (amauta adds it for itself, never for a step)."""
    own = os.path.realpath(AMAUTA_PYTHON)
    return os.pathsep.join(p for p in (pythonpath or "").split(os.pathsep) if p and os.path.realpath(p) != own)


def default_python():
    """The interpreter for python steps without one: python3 or python on PATH, else the one running amauta."""
    return shutil.which("python3") or shutil.which("python") or sys.executable


def step_env(extra):
    """The caller's environment for a step, with the user's own PYTHONPATH (amauta's module folder removed)."""
    env = dict(os.environ)
    given = env.pop("AMAUTA_USER_PYTHONPATH", None)
    user = without_amauta(env.get("PYTHONPATH", "") if given is None else given)
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
        """The step is over: stop whatever is left (closing the job does it on Windows: kill-on-close)."""
        if self.job:
            self.job.close()
        else:
            self.sweep()


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
        done.wait(0.1)  # wakes as soon as the output closes: no tenth of a second added to every step


GRACE = 2  # seconds the output may stay open after the step's processes ended or were stopped


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
    done, stop, gone = threading.Event(), {"why": None}, threading.Event()
    reader = threading.Thread(target=_read, args=(proc, on_line, gone, done), daemon=True)
    watcher = threading.Thread(target=_watch, args=(tree, step["timeout"], cancel, done, stop), daemon=True)
    reader.start()
    watcher.start()
    try:
        proc.wait()  # the main process ended (by itself, or stopped by the watcher)
        reader.join(timeout=GRACE)
        if reader.is_alive():  # a leftover keeps the output open: stop the tree's rest, then wait a little more
            tree.sweep()
            reader.join(timeout=GRACE)
        if reader.is_alive():  # a process outside the tree (its own session) still holds it: leave it
            gone.set()
            on_line("a process the step started still holds its output; it was left running")
    finally:
        done.set()
        watcher.join(timeout=5)
        tree.close()  # a step owns its processes: stop what it left behind, with or without its output
    return stop["why"] or ("ok" if proc.returncode == 0 else "failed")


def _read(proc, on_line, gone, done):
    """Pass each output line on until the output closes, or until the step has been given up on (`gone`)."""
    try:
        for raw in proc.stdout:
            if gone.is_set():
                return
            on_line(raw)
    except (OSError, ValueError):
        pass
    finally:
        done.set()
